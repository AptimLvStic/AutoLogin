!macro AutoLoginPreserveManagedData
  ${If} ${FileExists} "$INSTDIR\vault.enc"
    ${IfNot} ${FileExists} "$APPDATA\AutoLogin\Data\vault.enc"
      CreateDirectory "$APPDATA\AutoLogin\Data"
      nsExec::ExecToLog '"$SYSDIR\robocopy.exe" "$INSTDIR" "$APPDATA\AutoLogin\Data" vault.enc vault.enc.bak backups session-index.json BrowserProfiles Partitions logs /E /COPY:DAT /R:2 /W:1 /XJ /NFL /NDL /NJH /NJS /NP'
      Pop $0
    ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  !insertmacro AutoLoginPreserveManagedData
!macroend

!macro customUnInstall
  !insertmacro AutoLoginPreserveManagedData
!macroend
