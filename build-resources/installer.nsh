!macro customInit
  ${if} ${isUpdated}
    ; Older clients started the installer before Electron had fully exited.
    ; The installer is elevated for per-machine updates. Terminate the app and
    ; only helper processes whose executable lives inside Messs' bundled tools
    ; directory. Matching by path avoids closing the user's own LibreOffice.
    nsExec::ExecToLog `"$SYSDIR\taskkill.exe" /F /IM "${APP_EXECUTABLE_FILENAME}"`
    nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object -Property ExecutablePath -Like -Value '$INSTDIR\resources\tools\*' | Invoke-CimMethod -MethodName Terminate"`
    Sleep 1500
  ${endif}
!macroend
