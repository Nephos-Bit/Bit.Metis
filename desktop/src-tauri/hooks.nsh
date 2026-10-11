; Hooks for Tauri's NSIS installer (bundle.windows.nsis.installerHooks).
; The backend (mtgdeck-backend.exe, plus the MCP server and Claude it starts) keeps files in resources\backend
; open. The installer only closes the main window's process, so an update or a manual install over a running
; app failed with "cannot open file for writing". End the whole tree before files are copied or removed.

!macro NSIS_HOOK_PREINSTALL
  nsExec::ExecToLog 'taskkill /F /T /IM mtgdeck-backend.exe'
  Pop $0
  Sleep 800
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'taskkill /F /T /IM mtgdeck-backend.exe'
  Pop $0
  Sleep 800
!macroend
