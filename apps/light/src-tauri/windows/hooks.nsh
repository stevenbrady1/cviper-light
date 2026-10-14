; CViper Light — NSIS installer hooks (Tauri 2, `bundle.windows.nsis.installerHooks`).
;
; Uninstall with "Delete the application data" ticked also removes the API and
; job-board keys the app saved in Windows Credential Manager. Those live outside
; the app's folders, so Tauri's own app-data step never reached them.
;
; Exact names only. `keyring`'s Windows store files each secret as a GENERIC
; credential named `<account>.cviper-light` (see `SERVICE` and `account()` in
; src/secrets.rs). CredDeleteW is given each name and type 1 (CRED_TYPE_GENERIC),
; so it cannot touch another program's credential. A name that is not there is
; simply not found, and that is fine.
;
; Never during an update: the updater runs this uninstaller with /UPDATE, and an
; update must not cost anybody their keys. Never when the box is unticked, and
; never in a silent or passive uninstall, where the box is not shown and stays 0.
;
; src/packaging/uninstallCredentials.contract.test.ts fails if a secret Rust can
; write is missing here, or if anything else is added.

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    System::Call 'advapi32::CredDeleteW(w "adzuna_app_id.cviper-light", i 1, i 0)'
    System::Call 'advapi32::CredDeleteW(w "adzuna_app_key.cviper-light", i 1, i 0)'
    System::Call 'advapi32::CredDeleteW(w "reed_api_key.cviper-light", i 1, i 0)'
    System::Call 'advapi32::CredDeleteW(w "anthropic_api_key.cviper-light", i 1, i 0)'
    System::Call 'advapi32::CredDeleteW(w "openai_api_key.cviper-light", i 1, i 0)'
    System::Call 'advapi32::CredDeleteW(w "google_api_key.cviper-light", i 1, i 0)'
    System::Call 'advapi32::CredDeleteW(w "mistral_api_key.cviper-light", i 1, i 0)'
    System::Call 'advapi32::CredDeleteW(w "grok_api_key.cviper-light", i 1, i 0)'
    System::Call 'advapi32::CredDeleteW(w "openrouter_api_key.cviper-light", i 1, i 0)'
    System::Call 'advapi32::CredDeleteW(w "custom_provider.cviper-light", i 1, i 0)'
  ${EndIf}
!macroend
