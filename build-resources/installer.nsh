!ifndef BUILD_UNINSTALLER
  Var desktopShortcutWasPresent
!endif

!macro repairDesktopShortcut
  CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
!macroend

!macro customInit
  ${if} ${isUpdated}
    ; Remember the user's actual shortcut state before the previous version is
    ; replaced. This also repairs upgrades from versions whose saved NSIS
    ; shortcut preference no longer matches what is present on the desktop.
    StrCpy $desktopShortcutWasPresent "0"
    IfFileExists "$DESKTOP\${SHORTCUT_NAME}.lnk" 0 +2
      StrCpy $desktopShortcutWasPresent "1"

    ; Older clients started the installer before Electron had fully exited.
    ; The installer is elevated for per-machine updates. Terminate the app and
    ; only helper processes whose executable lives inside Messs' bundled tools
    ; directory. Matching by path avoids closing the user's own LibreOffice.
    nsExec::ExecToLog `"$SYSDIR\taskkill.exe" /F /IM "${APP_EXECUTABLE_FILENAME}"`
    nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object -Property ExecutablePath -Like -Value '$INSTDIR\resources\tools\*' | Invoke-CimMethod -MethodName Terminate"`
    Sleep 1500
  ${endif}
!macroend

!macro customInstall
  ${if} ${isUpdated}
    ; electron-builder keeps shortcuts when upgrading, but an older
    ; uninstaller or interrupted update may already have removed them. Always
    ; repair both launch entries after the new application files are in place.
    CreateDirectory "$SMPROGRAMS"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"

    ${if} $desktopShortcutWasPresent == "1"
      !insertmacro repairDesktopShortcut
    ${else}
      ${ifNot} ${isNoDesktopShortcut}
        !insertmacro repairDesktopShortcut
      ${endif}
    ${endif}
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${endif}
!macroend
