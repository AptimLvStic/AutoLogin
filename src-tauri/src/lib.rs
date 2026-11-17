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
use tauri::{
    Emitter, LogicalPosition, LogicalSize, Manager, Position, Rect, RunEvent, Size, State,
    WebviewBuilder, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tokio::sync::oneshot;
use tokio::time::{Duration, timeout};

type BackendResult = Result<Value, String>;

#[cfg(windows)]
fn is_private_network_url(value: &str) -> bool {
    use std::net::IpAddr;

    let Ok(url) = tauri::Url::parse(value) else {
        return false;
    };
    if url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if let Ok(address) = host.parse::<IpAddr>() {
        return match address {
            IpAddr::V4(address) => {
                address.is_private() || address.is_loopback() || address.is_link_local()
            }
            IpAddr::V6(address) => {
                address.is_loopback()
                    || (address.segments()[0] & 0xfe00) == 0xfc00
                    || (address.segments()[0] & 0xffc0) == 0xfe80
            }
        };
    }
    host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".lan")
        || host.ends_with(".internal")
        || host.ends_with(".corp")
        || host.ends_with(".home.arpa")
        || !host.contains('.')
}

#[cfg(all(test, windows))]
mod tests {
    use super::is_private_network_url;

    #[test]
    fn private_network_certificate_errors_are_limited_to_intranet_hosts() {
        for url in [
            "https://10.111.4.5:4430/login",
            "https://127.0.0.1/login",
            "https://172.16.10.4/login",
            "https://192.168.1.1/login",
            "https://[fd00::10]/login",
            "https://firewall.local/login",
            "https://intranet/login",
        ] {
            assert!(is_private_network_url(url), "{url} should be treated as intranet");
        }

        for url in [
            "http://10.111.4.5/login",
            "https://8.8.8.8/login",
            "https://example.com/login",
            "https://company.example.com/login",
        ] {
            assert!(!is_private_network_url(url), "{url} must keep strict TLS checks");
        }
    }
}

#[cfg(windows)]
fn install_private_network_certificate_policy(webview: &tauri::Webview) -> tauri::Result<()> {
    webview.with_webview(|platform| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW, ICoreWebView2_14,
        };
        use webview2_com::{ServerCertificateErrorDetectedEventHandler, take_pwstr};
        use windows_core::{Interface, PWSTR};

        unsafe {
            let Ok(core) = platform.controller().CoreWebView2() else {
                return;
            };
            let Ok(core) = core.cast::<ICoreWebView2_14>() else {
                return;
            };
            let handler = ServerCertificateErrorDetectedEventHandler::create(Box::new(
                |_sender, arguments| {
                    let Some(arguments) = arguments else {
                        return Ok(());
                    };
                    let mut request_uri = PWSTR::null();
                    if arguments.RequestUri(&mut request_uri).is_err() {
                        return Ok(());
                    }
                    let request_uri = take_pwstr(request_uri);
                    if is_private_network_url(&request_uri) {
                        arguments.SetAction(
                            COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW,
                        )?;
                    }
                    Ok(())
                },
            ));
            let mut token = 0;
            let _ = core.add_ServerCertificateErrorDetected(&handler, &mut token);
        }
    })
}

fn simplified_path(path: PathBuf) -> PathBuf {
    dunce::simplified(&path).to_path_buf()
}

struct BackendClient {
    stdin: Arc<Mutex<ChildStdin>>,
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
        let stdin = Arc::new(Mutex::new(stdin));

        let response_pending = Arc::clone(&pending);
        let response_app = app.clone();
        let response_stdin = Arc::clone(&stdin);
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
                handle_backend_message(
                    &response_app,
                    &response_pending,
                    &response_stdin,
                    message,
                );
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
            stdin,
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
    stdin: &Arc<Mutex<ChildStdin>>,
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
        handle_backend_control(app, stdin, &message);
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

fn write_backend_message(stdin: &Arc<Mutex<ChildStdin>>, message: &Value) {
    if let Ok(mut stdin) = stdin.lock() {
        let _ = writeln!(stdin, "{message}");
        let _ = stdin.flush();
    }
}

fn handle_backend_control(
    app: &tauri::AppHandle,
    stdin: &Arc<Mutex<ChildStdin>>,
    message: &Value,
) {
    let action = message
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if let Some(request_id) = message.get("requestId").and_then(Value::as_u64) {
        let payload = message.get("payload").cloned().unwrap_or(Value::Null);
        let app = app.clone();
        let stdin = Arc::clone(stdin);
        let action = action.to_string();
        std::thread::spawn(move || {
            let result = match action.as_str() {
                // These functions dispatch their native window operations to
                // the main thread internally. Wrapping them in
                // run_on_main_thread would make the dispatch wait on the same
                // blocked event loop.
                "embedded-browser-open" => open_embedded_browser(&app, &payload),
                "embedded-browser-control" => control_embedded_browser(&app, &payload),
                "open-path" => payload
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "缺少文件路径".to_string())
                    .and_then(|path| open_path(path.to_string()))
                    .map(|_| Value::Null),
                _ => Err(format!("未知的本地窗口操作：{action}")),
            };
            let response = match result {
                Ok(value) => json!({
                    "type": "native-response",
                    "requestId": request_id,
                    "ok": true,
                    "result": value
                }),
                Err(error) => json!({
                    "type": "native-response",
                    "requestId": request_id,
                    "ok": false,
                    "error": error
                }),
            };
            write_backend_message(&stdin, &response);
        });
        return;
    }
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

fn available_debug_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("无法分配本地浏览器端口：{error}"))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| format!("无法读取本地浏览器端口：{error}"))
}

fn embedded_label(value: &str) -> Result<String, String> {
    if value.is_empty()
        || value.len() > 96
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("无效的浏览器标签标识".to_string());
    }
    Ok(value.to_string())
}

fn open_embedded_browser(app: &tauri::AppHandle, payload: &Value) -> Result<Value, String> {
    let label = payload
        .get("label")
        .and_then(Value::as_str)
        .ok_or_else(|| "缺少浏览器标签标识".to_string())
        .and_then(embedded_label)?;
    let url = payload
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| "缺少页面地址".to_string())?
        .parse::<tauri::Url>()
        .map_err(|error| format!("页面地址无效：{error}"))?;
    let profile_directory = payload
        .get("profileDirectory")
        .and_then(Value::as_str)
        .ok_or_else(|| "缺少页面配置目录".to_string())?;
    let profile_directory = PathBuf::from(profile_directory);
    std::fs::create_dir_all(&profile_directory)
        .map_err(|error| format!("无法创建页面配置目录：{error}"))?;
    let debug_port = available_debug_port()?;
    let browser_args = format!(
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
         --disable-background-timer-throttling \
         --remote-debugging-port={debug_port} \
         --remote-allow-origins=*"
    );
    let window = app
        .get_window("main")
        .ok_or_else(|| "主窗口尚未准备好".to_string())?;
    let new_window_app = app.clone();
    #[cfg(windows)]
    let initial_url = tauri::Url::parse("about:blank").expect("about:blank is a valid URL");
    #[cfg(not(windows))]
    let initial_url = url.clone();
    let webview = window
        .add_child(
            WebviewBuilder::new(&label, WebviewUrl::External(initial_url))
                .data_directory(profile_directory)
                .additional_browser_args(&browser_args)
                .on_new_window(move |url, _features| {
                    if matches!(url.scheme(), "http" | "https") {
                        let _ = new_window_app.emit(
                            "autologin://backend-event",
                            json!({
                                "channel": "browser:new-window",
                                "payload": { "url": url.as_str() }
                            }),
                        );
                    }
                    tauri::webview::NewWindowResponse::Deny
                })
                .focused(false),
            LogicalPosition::new(0.0, 0.0),
            LogicalSize::new(1.0, 1.0),
        )
        .map_err(|error| format!("无法创建页面标签：{error}"))?;
    webview
        .hide()
        .map_err(|error| format!("无法初始化页面标签：{error}"))?;
    #[cfg(windows)]
    {
        install_private_network_certificate_policy(&webview)
            .map_err(|error| format!("无法初始化页面安全策略：{error}"))?;
        webview
            .navigate(url)
            .map_err(|error| format!("无法打开页面：{error}"))?;
    }
    Ok(json!({ "label": label, "debugPort": debug_port }))
}

fn control_embedded_browser(app: &tauri::AppHandle, payload: &Value) -> Result<Value, String> {
    let label = payload
        .get("label")
        .and_then(Value::as_str)
        .ok_or_else(|| "缺少浏览器标签标识".to_string())
        .and_then(embedded_label)?;
    let action = payload
        .get("action")
        .and_then(Value::as_str)
        .ok_or_else(|| "缺少浏览器标签操作".to_string())?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "浏览器标签不存在".to_string())?;
    match action {
        "show" => webview.show().map_err(|error| error.to_string())?,
        "hide" => webview.hide().map_err(|error| error.to_string())?,
        "focus" => webview.set_focus().map_err(|error| error.to_string())?,
        "close" => webview.close().map_err(|error| error.to_string())?,
        "navigate" => {
            let url = payload
                .get("url")
                .and_then(Value::as_str)
                .ok_or_else(|| "缺少页面地址".to_string())?
                .parse::<tauri::Url>()
                .map_err(|error| format!("页面地址无效：{error}"))?;
            webview
                .navigate(url)
                .map_err(|error| format!("无法打开页面：{error}"))?;
        }
        "back" => webview
            .eval("history.back()")
            .map_err(|error| format!("无法返回上一页：{error}"))?,
        "reload" => webview
            .reload()
            .map_err(|error| format!("无法刷新页面：{error}"))?,
        "set-bounds" => {
            let bounds = payload
                .get("bounds")
                .ok_or_else(|| "缺少页面尺寸".to_string())?;
            let number = |name: &str| {
                bounds
                    .get(name)
                    .and_then(Value::as_f64)
                    .ok_or_else(|| format!("缺少页面尺寸字段：{name}"))
            };
            webview
                .set_bounds(Rect {
                    position: Position::Logical(LogicalPosition::new(number("x")?, number("y")?)),
                    size: Size::Logical(LogicalSize::new(
                        number("width")?.max(1.0),
                        number("height")?.max(1.0),
                    )),
                })
                .map_err(|error| error.to_string())?;
        }
        _ => return Err(format!("未知的浏览器标签操作：{action}")),
    }
    Ok(Value::Null)
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
        "focus" => {
            window.unminimize().map_err(|error| error.to_string())?;
            window.show().map_err(|error| error.to_string())?;
            window.set_focus().map_err(|error| error.to_string())
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

#[cfg(windows)]
fn apply_hud_window_style(window: &WebviewWindow) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GetWindowLongPtrW, HWND_TOPMOST, SWP_FRAMECHANGED, SWP_NOACTIVATE,
        SWP_NOMOVE, SWP_NOSIZE, SetWindowLongPtrW, SetWindowPos, WS_EX_APPWINDOW,
        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };

    let hwnd = window
        .hwnd()
        .map_err(|error| error.to_string())?
        .0;
    unsafe {
        let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let next = ((current as u32) | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW)
            & !WS_EX_APPWINDOW;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next as isize);
        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }
    Ok(())
}

#[cfg(windows)]
fn show_hud_window(window: &WebviewWindow) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SW_SHOWNOACTIVATE, ShowWindow};

    let hwnd = window
        .hwnd()
        .map_err(|error| error.to_string())?
        .0;
    unsafe {
        ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    }
    Ok(())
}

#[cfg(windows)]
fn hide_hud_window(window: &WebviewWindow) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SW_HIDE, ShowWindow};

    let hwnd = window
        .hwnd()
        .map_err(|error| error.to_string())?
        .0;
    unsafe {
        ShowWindow(hwnd, SW_HIDE);
    }
    Ok(())
}

fn position_hud_window(window: &WebviewWindow) -> Result<(), String> {
    let Some(monitor) = window
        .primary_monitor()
        .map_err(|error| error.to_string())?
    else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    let monitor_size = monitor.size();
    let logical_width = monitor_size.width as f64 / scale;
    let x = ((logical_width - 640.0) / 2.0).max(0.0);
    window
        .set_position(LogicalPosition::new(x, 12.0))
        .map_err(|error| error.to_string())
}

// Creating a webview dispatches back to the main event loop. Running this
// command on the main thread would make that dispatch wait on itself.
#[tauri::command(async)]
fn set_recording_hud_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    let existing = app.get_webview_window("recording-hud");
    if !visible {
        if let Some(window) = existing {
            #[cfg(windows)]
            hide_hud_window(&window)?;
            #[cfg(not(windows))]
            window.hide().map_err(|error| error.to_string())?;
        }
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.unminimize();
            let _ = main.show();
            let _ = main.set_focus();
        }
        return Ok(());
    }

    let window = match existing {
        Some(window) => window,
        None => {
            let window = WebviewWindowBuilder::new(
                &app,
                "recording-hud",
                WebviewUrl::App("index.html".into()),
            )
            .title("AutoLogin")
            .inner_size(640.0, 48.0)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .focused(false)
            .build()
            .map_err(|error| format!("无法创建录制浮条：{error}"))?;
            #[cfg(windows)]
            apply_hud_window_style(&window)?;
            position_hud_window(&window)?;
            window
        }
    };

    position_hud_window(&window)?;
    #[cfg(windows)]
    {
        apply_hud_window_style(&window)?;
        show_hud_window(&window)?;
    }
    #[cfg(not(windows))]
    {
        window.show().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn request_recording_finish(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
        let _ = app.emit_to(
            "main",
            "autologin://recording-shortcut",
            json!({ "action": "finish-recording" }),
        );
    }
    Ok(())
}

#[cfg(windows)]
fn install_recording_hotkeys(app: tauri::AppHandle) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        RegisterHotKey, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, VK_P, VK_RETURN, VK_U,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetMessageW, MSG, WM_HOTKEY,
    };

    std::thread::spawn(move || {
        const COPY_USERNAME_ID: i32 = 0xA101;
        const COPY_PASSWORD_ID: i32 = 0xA102;
        const FINISH_ID: i32 = 0xA103;
        let modifiers = MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT;
        unsafe {
            RegisterHotKey(std::ptr::null_mut(), COPY_USERNAME_ID, modifiers, VK_U as u32);
            RegisterHotKey(std::ptr::null_mut(), COPY_PASSWORD_ID, modifiers, VK_P as u32);
            RegisterHotKey(std::ptr::null_mut(), FINISH_ID, modifiers, VK_RETURN as u32);
            let mut message: MSG = std::mem::zeroed();
            while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
                if message.message != WM_HOTKEY {
                    continue;
                }
                let action = match message.wParam as i32 {
                    COPY_USERNAME_ID => "copy-username",
                    COPY_PASSWORD_ID => "copy-password",
                    FINISH_ID => "finish-recording",
                    _ => continue,
                };
                let target = if action == "finish-recording"
                    || app.get_webview_window("recording-hud").is_none()
                {
                    "main"
                } else {
                    "recording-hud"
                };
                let _ = app.emit_to(
                    target,
                    "autologin://recording-shortcut",
                    json!({ "action": action }),
                );
            }
        }
    });
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
            open_devtools,
            set_recording_hud_visible,
            request_recording_finish
        ])
        .setup(|app| {
            let backend = BackendClient::start(app.handle().clone())
                .map_err(|error| -> Box<dyn std::error::Error> { error.into() })?;
            app.manage(BackendState(Arc::new(backend)));
            #[cfg(windows)]
            install_recording_hotkeys(app.handle().clone());
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
