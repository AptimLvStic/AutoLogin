use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tauri::{Emitter, Manager, RunEvent, State, WebviewWindow};
use tokio::sync::oneshot;
use tokio::time::{Duration, timeout};

type BackendResult = Result<Value, String>;

fn simplified_path(path: PathBuf) -> PathBuf {
    dunce::simplified(&path).to_path_buf()
}

struct BackendClient {
    stdin: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<BackendResult>>>>,
    next_id: AtomicU64,
}

impl BackendClient {
    fn start(app: tauri::AppHandle) -> Result<Self, String> {
        let (node_path, script_path, resource_root) = backend_paths(&app)?;
        let default_user_data_dir = simplified_path(
            app.path()
                .data_dir()
                .map_err(|error| format!("无法读取应用数据目录：{error}"))?
                .join("AutoLogin"),
        );
        let user_data_dir = if cfg!(debug_assertions) {
            std::env::var_os("AUTOLOGIN_USER_DATA_DIR")
                .map(PathBuf::from)
                .map(simplified_path)
                .unwrap_or_else(|| default_user_data_dir.clone())
        } else {
            default_user_data_dir
        };
        let pointer_dir = if cfg!(debug_assertions) {
            std::env::var_os("AUTOLOGIN_DATA_LOCATION_POINTER_DIR")
                .map(PathBuf::from)
                .map(simplified_path)
                .unwrap_or_else(|| user_data_dir.clone())
        } else {
            user_data_dir.clone()
        };
        let executable = simplified_path(
            std::env::current_exe()
                .map_err(|error| format!("无法读取应用可执行文件路径：{error}"))?,
        );
        let app_version = app.package_info().version.to_string();

        let mut command = Command::new(&node_path);
        command
            .arg(&script_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("AUTOLOGIN_RESOURCE_DIR", &resource_root)
            .env("AUTOLOGIN_APP_VERSION", app_version)
            .env(
                "AUTOLOGIN_IS_PACKAGED",
                if cfg!(debug_assertions) { "0" } else { "1" },
            )
            .env("AUTOLOGIN_EXE_PATH", executable)
            .env("AUTOLOGIN_USER_DATA_DIR", &user_data_dir)
            .env("AUTOLOGIN_DATA_LOCATION_POINTER_DIR", &pointer_dir)
            .env(
                "AUTOLOGIN_REPOSITORY_URL",
                std::env::var("AUTOLOGIN_REPOSITORY_URL")
                    .unwrap_or_else(|_| "https://github.com/AptimLvStic/AutoLogin".into()),
            )
            .env(
                "AUTOLOGIN_UPDATE_OWNER",
                std::env::var("AUTOLOGIN_UPDATE_OWNER").unwrap_or_else(|_| "AptimLvStic".into()),
            )
            .env(
                "AUTOLOGIN_UPDATE_REPO",
                std::env::var("AUTOLOGIN_UPDATE_REPO").unwrap_or_else(|_| "AutoLogin".into()),
            );

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command
            .spawn()
            .map_err(|error| format!("无法启动本地服务：{error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "本地服务输入通道不可用".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "本地服务输出通道不可用".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "本地服务错误通道不可用".to_string())?;
        let pending = Arc::new(Mutex::new(
            HashMap::<u64, oneshot::Sender<BackendResult>>::new(),
        ));

        let response_pending = Arc::clone(&pending);
        let response_app = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else {
                    break;
                };
                let Ok(message) = serde_json::from_str::<Value>(&line) else {
                    eprintln!("[local-service] {line}");
                    continue;
                };
                handle_backend_message(&response_app, &response_pending, message);
            }
            fail_pending(&response_pending, "本地服务已退出，请重新启动应用");
        });

        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                eprintln!("[local-service] {line}");
            }
        });

        Ok(Self {
            stdin: Mutex::new(stdin),
            child: Mutex::new(child),
            pending,
            next_id: AtomicU64::new(1),
        })
    }

    async fn request(&self, channel: String, args: Vec<Value>) -> BackendResult {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .map_err(|_| "本地服务请求状态不可用".to_string())?
            .insert(id, sender);

        let payload = json!({
            "id": id,
            "type": "call",
            "channel": channel,
            "args": args
        });
        {
            let mut stdin = self
                .stdin
                .lock()
                .map_err(|_| "本地服务输入通道不可用".to_string())?;
            writeln!(stdin, "{payload}")
                .and_then(|_| stdin.flush())
                .map_err(|error| {
                    eprintln!("[local-service] write failed: {error}");
                    if let Ok(mut pending) = self.pending.lock() {
                        pending.remove(&id);
                    }
                    "本地服务连接已断开，请重新启动应用".to_string()
                })?;
        }

        let wait_for = backend_timeout(&channel);
        match timeout(wait_for, receiver).await {
            Ok(result) => {
                result.map_err(|_| "本地服务响应通道已关闭".to_string())?
            }
            Err(_) => {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&id);
                }
                Err(format!(
                    "本地操作超时（{} 秒），请重试或重新启动应用",
                    wait_for.as_secs()
                ))
            }
        }
    }

    fn shutdown(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

struct BackendState(Arc<BackendClient>);

fn backend_timeout(channel: &str) -> Duration {
    if channel.contains(":choose-")
        || matches!(
            channel,
            "data:export-vault"
                | "data:export-csv-template"
                | "data:import-csv"
                | "data:import-database"
                | "data:import-kdbx"
                | "data:import-autologin"
                | "data:import-bookmarks"
        )
    {
        Duration::from_secs(10 * 60)
    } else {
        Duration::from_secs(30)
    }
}

fn backend_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    if cfg!(debug_assertions) {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let project_root = manifest
            .parent()
            .ok_or_else(|| "无法定位 AutoLogin 项目目录".to_string())?;
        return Ok((
            simplified_path(manifest.join("resources/bin/node.exe")),
            simplified_path(project_root.join("dist-backend/backend.cjs")),
            simplified_path(project_root.join("resources")),
        ));
    }

    let resource_root = simplified_path(
        app.path()
            .resource_dir()
            .map_err(|error| format!("无法读取应用资源目录：{error}"))?,
    );
    Ok((
        resource_root.join("bin/node.exe"),
        resource_root.join("backend/backend.cjs"),
        resource_root,
    ))
}

fn handle_backend_message(
    app: &tauri::AppHandle,
    pending: &Arc<Mutex<HashMap<u64, oneshot::Sender<BackendResult>>>>,
    message: Value,
) {
    if message.get("type").and_then(Value::as_str) == Some("event") {
        let channel = message
            .get("channel")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let payload = message.get("payload").cloned().unwrap_or(Value::Null);
        let _ = app.emit(
            "autologin://backend-event",
            json!({ "channel": channel, "payload": payload }),
        );
        return;
    }

    if message.get("type").and_then(Value::as_str) == Some("control") {
        handle_backend_control(app, &message);
        return;
    }

    let Some(id) = message.get("id").and_then(Value::as_u64) else {
        return;
    };
    let Some(sender) = pending.lock().ok().and_then(|mut map| map.remove(&id)) else {
        return;
    };
    let result = if message.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        Ok(message.get("result").cloned().unwrap_or(Value::Null))
    } else {
        Err(message
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("本地服务操作失败")
            .to_string())
    };
    let _ = sender.send(result);
}

fn handle_backend_control(app: &tauri::AppHandle, message: &Value) {
    let action = message
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match action {
        "exit" => app.exit(0),
        "relaunch" => {
            if let Ok(executable) = std::env::current_exe() {
                let _ = Command::new(executable).spawn();
            }
            app.exit(0);
        }
        "toggle-devtools" => {
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }
        }
        "focus-window" | "restore-window" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        "install-update" => {
            if let Some(path) = message
                .get("payload")
                .and_then(|payload| payload.get("path"))
                .and_then(Value::as_str)
            {
                let mut command = Command::new(path);
                command.arg("/S");
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
                    command.creation_flags(CREATE_NO_WINDOW);
                }
                let _ = command.spawn();
            }
            app.exit(0);
        }
        _ => {}
    }
}

fn fail_pending(pending: &Arc<Mutex<HashMap<u64, oneshot::Sender<BackendResult>>>>, message: &str) {
    if let Ok(mut pending) = pending.lock() {
        for (_, sender) in pending.drain() {
            let _ = sender.send(Err(message.to_string()));
        }
    }
}

#[tauri::command]
async fn backend_call(
    state: State<'_, BackendState>,
    channel: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    state.0.request(channel, args).await
}

#[cfg(windows)]
fn open_path_native(path: &std::path::Path) -> Result<(), String> {
    use std::{ffi::c_void, os::windows::ffi::OsStrExt, ptr::null_mut};

    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(
            hwnd: *mut c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show_command: i32,
        ) -> *mut c_void;
    }

    let operation: Vec<u16> = "open\0".encode_utf16().collect();
    let file: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let result = unsafe {
        ShellExecuteW(
            null_mut(),
            operation.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        )
    };
    let result_code = result as isize;
    if result_code <= 32 {
        return Err(format!("无法调用系统资源管理器（错误码 {result_code}）"));
    }
    Ok(())
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err("文件不存在".to_string());
    }
    #[cfg(windows)]
    {
        open_path_native(&path)
    }
    #[cfg(not(windows))]
    {
        Err("当前平台不支持打开本地文件夹".to_string())
    }
}

#[tauri::command]
fn window_action(window: WebviewWindow, action: String) -> Result<(), String> {
    match action.as_str() {
        "minimize" => window.minimize().map_err(|error| error.to_string()),
        "toggle-maximize" => {
            if window.is_maximized().map_err(|error| error.to_string())? {
                window.unmaximize().map_err(|error| error.to_string())
            } else {
                window.maximize().map_err(|error| error.to_string())
            }
        }
        "close" => window.close().map_err(|error| error.to_string()),
        _ => Err(format!("未知窗口操作：{action}")),
    }
}

#[tauri::command]
fn open_devtools(window: WebviewWindow) -> Result<(), String> {
    window.open_devtools();
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            backend_call,
            open_path,
            window_action,
            open_devtools
        ])
        .setup(|app| {
            let backend = BackendClient::start(app.handle().clone())
                .map_err(|error| -> Box<dyn std::error::Error> { error.into() })?;
            app.manage(BackendState(Arc::new(backend)));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start AutoLogin");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            if let Some(state) = app_handle.try_state::<BackendState>() {
                state.0.shutdown();
            }
        }
    });
}
