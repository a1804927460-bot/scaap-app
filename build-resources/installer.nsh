!macro customInit
  ${if} ${isUpdated}
    ; Older clients started the installer before Electron had fully exited.
    ; The installer is elevated for per-machine updates, so terminate only the
    ; app executable here and let electron-builder's normal check clean up any
    ; remaining helper processes from the installation directory.
    nsExec::ExecToLog `"$SYSDIR\taskkill.exe" /F /IM "${APP_EXECUTABLE_FILENAME}"`
    Sleep 1200
  ${endif}
!macroend
