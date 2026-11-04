!ifndef BUILD_UNINSTALLER
  !include MUI2.nsh
  !include nsDialogs.nsh

  Var AutoLoginCreateDesktopShortcut
  Var AutoLoginCreateStartMenuShortcut
  Var AutoLoginDesktopShortcutCheckbox
  Var AutoLoginStartMenuShortcutCheckbox

  !macro customPageAfterChangeDir
    Page custom AutoLoginShortcutOptionsPageCreate AutoLoginShortcutOptionsPageLeave
  !macroend

  Function AutoLoginShortcutOptionsPageCreate
    ${If} ${Silent}
      Abort
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "选择快捷方式" "选择 AutoLogin 安装完成后要创建的快捷方式。"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0u 0u 300u 24u "请选择安装后需要创建的快捷方式："
    Pop $0

    ${NSD_CreateCheckbox} 0u 34u 300u 14u "创建桌面快捷方式"
    Pop $AutoLoginDesktopShortcutCheckbox
    ${If} $AutoLoginCreateDesktopShortcut == "1"
      ${NSD_Check} $AutoLoginDesktopShortcutCheckbox
    ${EndIf}

    ${NSD_CreateCheckbox} 0u 58u 300u 14u "添加至开始菜单"
    Pop $AutoLoginStartMenuShortcutCheckbox
    ${If} $AutoLoginCreateStartMenuShortcut == "1"
      ${NSD_Check} $AutoLoginStartMenuShortcutCheckbox
    ${EndIf}

    nsDialogs::Show
  FunctionEnd

  Function AutoLoginShortcutOptionsPageLeave
    ${NSD_GetState} $AutoLoginDesktopShortcutCheckbox $AutoLoginCreateDesktopShortcut
    ${NSD_GetState} $AutoLoginStartMenuShortcutCheckbox $AutoLoginCreateStartMenuShortcut
  FunctionEnd
!endif

!macro AutoLoginPreserveManagedData
  ${If} ${FileExists} "$INSTDIR\vault.enc"
    ${IfNot} ${FileExists} "$APPDATA\AutoLogin\Data\vault.enc"
      CreateDirectory "$APPDATA\AutoLogin\Data"
      nsExec::ExecToLog '"$SYSDIR\robocopy.exe" "$INSTDIR" "$APPDATA\AutoLogin\Data" vault.enc vault.enc.bak backups session-index.json BrowserProfiles Partitions logs /E /COPY:DAT /R:2 /W:1 /XJ /NFL /NDL /NJH /NJS /NP'
      Pop $0
    ${EndIf}
  ${EndIf}
!macroend

!macro AutoLoginRefreshShortcutIcon shortcutPath
  ${If} ${FileExists} "${shortcutPath}"
    CreateShortCut "${shortcutPath}" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\resources\icon.ico" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "${shortcutPath}" "${APP_ID}"
  ${EndIf}
!macroend

!macro customInit
  StrCpy $AutoLoginCreateDesktopShortcut "1"
  StrCpy $AutoLoginCreateStartMenuShortcut "1"
  ReadRegStr $AutoLoginCreateDesktopShortcut SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" AutoLoginCreateDesktopShortcut
  ${If} $AutoLoginCreateDesktopShortcut == ""
    StrCpy $AutoLoginCreateDesktopShortcut "1"
  ${EndIf}
  ReadRegStr $AutoLoginCreateStartMenuShortcut SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" AutoLoginCreateStartMenuShortcut
  ${If} $AutoLoginCreateStartMenuShortcut == ""
    StrCpy $AutoLoginCreateStartMenuShortcut "1"
  ${EndIf}
  !insertmacro AutoLoginPreserveManagedData
!macroend

!macro customInstall
  ${If} $AutoLoginCreateDesktopShortcut != "1"
    Delete "$newDesktopLink"
    ${If} $oldDesktopLink != $newDesktopLink
      Delete "$oldDesktopLink"
    ${EndIf}
  ${Else}
    !insertmacro AutoLoginRefreshShortcutIcon "$newDesktopLink"
  ${EndIf}
  ${If} $AutoLoginCreateStartMenuShortcut != "1"
    Delete "$newStartMenuLink"
    ${If} $oldStartMenuLink != $newStartMenuLink
      Delete "$oldStartMenuLink"
    ${EndIf}
    StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${Else}
    !insertmacro AutoLoginRefreshShortcutIcon "$newStartMenuLink"
  ${EndIf}
  # Recreate existing pins so an upgrade cannot keep the previous taskbar icon cache.
  !insertmacro AutoLoginRefreshShortcutIcon "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${SHORTCUT_NAME}.lnk"
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ExecWait '"$SYSDIR\ie4uinit.exe" -show' $0
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" AutoLoginCreateDesktopShortcut "$AutoLoginCreateDesktopShortcut"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" AutoLoginCreateStartMenuShortcut "$AutoLoginCreateStartMenuShortcut"
!macroend

!macro customUnInstall
  !insertmacro AutoLoginPreserveManagedData
!macroend
