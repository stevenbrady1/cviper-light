mod db;
mod fetch_page;
mod files;
mod jobs;
mod providers;
mod secrets;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        // The migrations are registered against `db::DB_URL`, and the frontend
        // opens the database with the same string from `src/db/constants.ts`.
        // A mismatch does not error — it silently skips every migration. See
        // the note on `db::DB_URL`.
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(db::DB_URL, db::migrations())
                .build(),
        )
        .plugin(tauri_plugin_opener::init());

    // `tauri add updater` declares tauri-plugin-updater as a desktop-only Cargo
    // dependency but emits an unconditional `.plugin(...)` call. Guard it so the
    // Rust matches the manifest. The matching capability lives in
    // `capabilities/desktop.json`, scoped to desktop platforms for the same
    // reason: on iOS the plugin is not compiled in, and a capability naming
    // `updater:default` there fails the build (L-80).
    //
    // The second attribute is the Microsoft Store flavour (L-93). An installed
    // MSIX's files are read-only, so an in-place update cannot succeed there —
    // the Store replaces the package instead. `--no-default-features` drops the
    // `updater` feature, and with it this registration and the crate itself.
    // Both attributes apply: `cfg` attributes stack as an AND.
    #[cfg(desktop)]
    #[cfg(feature = "updater")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    // ========================================================================
    // THE SECOND TRIPWIRE. A STORE BUILD CARRYING THE UPDATER WILL NOT COMPILE.
    // ========================================================================
    // The Store flavour is built with `--features microsoft-store` AND
    // `--no-default-features`, and the second half is the one that actually
    // removes the plugin. If it were ever dropped — a reworded script, a `--`
    // swallowed by a shell, a copied command line — the build would succeed and
    // produce a Store package whose "Check for updates" button downloads an
    // installer it cannot write over a read-only install.
    //
    // That failure would appear on a user's machine and nowhere else. So the
    // two flags are not a convention anybody has to remember: arriving with one
    // and not the other is a hard compile error, and nothing ships.
    #[cfg(all(feature = "updater", feature = "microsoft-store"))]
    compile_error!(
        "a `microsoft-store` build must not carry the updater: an installed MSIX is read-only, so \
         tauri-plugin-updater can only fail there, and the Microsoft Store delivers updates \
         instead. The Store build is `tauri build --features microsoft-store -- \
         --no-default-features`; if you reached this, the `--no-default-features` half did not \
         arrive. Fix the build command, not this guard."
    );

    // ========================================================================
    // THE TRIPWIRE. A RELEASE BUILD CARRYING THE AUTOMATION SERVER WILL NOT
    // COMPILE.
    // ========================================================================
    // `wdio` (see Cargo.toml) compiles in an embedded WebDriver server that
    // listens on a local HTTP port and can drive this window. CI turns it on to
    // smoke-test the real binary; anything a user runs must not have it.
    //
    // A convention would be "remember not to pass --features wdio to a
    // release". This is not a convention: enabling the feature in a build
    // without debug assertions is a hard compile error, so the release path
    // cannot acquire an automation server by anyone forgetting anything.
    #[cfg(all(feature = "wdio", not(debug_assertions)))]
    compile_error!(
        "the `wdio` feature compiles an HTTP automation server into the app and must never be \
         enabled for a release build. It exists only for .github/workflows/smoke.yml, which \
         builds with --debug. If you reached this from release.yml, the answer is to remove the \
         feature flag, not to relax this guard."
    );

    // Registered ONLY under the feature. `cfg` rather than a runtime `if`, so
    // with the feature off there is no server, no port and no code path to it —
    // the same shape as the `#[cfg(desktop)]` updater above.
    #[cfg(feature = "wdio")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    builder
        // Custom commands are allow-by-default: only PLUGIN commands are
        // gated by capabilities/default.json, so the secret commands need no
        // entry there. They do need to be listed here.
        //
        // There is no read command. See the module comment in secrets.rs: the
        // only way to read a saved key is from Rust, and adding one here
        // would undo that.
        .invoke_handler(tauri::generate_handler![
            greet,
            secrets::secret_set,
            secrets::secret_delete,
            secrets::secret_status,
            // The provider transport. Rust owns every base URL and injects the
            // API key from the keyring, so a compromised frontend can still
            // only reach the three APIs named in providers.rs.
            providers::provider_chat,
            providers::provider_list_models,
            providers::ollama_probe,
            // Testing an AI key the user has just typed and has NOT saved: one
            // cheap metadata request, the candidate key passed straight in, the
            // response body never read, nothing written anywhere. Same
            // test-before-save shape as jobs::job_test_credentials.
            providers::provider_test_key,
            // The job-board transport. Same shape: Rust owns both base URLs,
            // reads Adzuna's two keys and Reed's one from the keyring, and
            // enforces the minimum gap between submits — a disabled button
            // cannot, and Reed's free tier is 100 requests a day.
            jobs::job_search,
            // Testing a key the user has just typed and has NOT saved: one
            // result, the candidate credentials passed straight in, nothing
            // written anywhere. See the command's own comment for why a key is
            // proved before it is stored rather than after.
            jobs::job_test_credentials,
            // Reading a CV the user picked, and reading or writing a backup.
            // Each one opens the dialog ITSELF and touches only what came back
            // out of it: there is no command here that takes a path, so there
            // is no path for a compromised frontend to name. Same principle as
            // secrets::secret_get above. See the module comment in files.rs.
            files::pick_and_read_cv,
            files::pick_and_read_backup,
            files::pick_and_write_backup,
            files::pick_and_write_cv_json,
            // Fetching the ONE page whose address the user pasted, so the same
            // extraction that reads a paste can read an advert from a link.
            //
            // This is the only command in the app that takes a URL from
            // JavaScript, and `fetch_page.rs` opens with the full account of
            // why that is not the SSRF hole the other two transports refuse to
            // become: the scheme, the host and every resolved address are
            // vetted before each connection, the connection is pinned to the
            // address that was vetted, redirects are walked by hand and cannot
            // leave the site, and nothing that identifies the user goes with it.
            fetch_page::fetch_job_page,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // A file the OS asked us to open — the iPhone share sheet's "Open
            // in CViper Light" (L-83, `Info.ios.plist`). Read in Rust under
            // the picker's guards and handed to the frontend as an event; the
            // URL never passes through JavaScript. See `files::on_opened`.
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            if let tauri::RunEvent::Opened { urls } = &event {
                files::on_opened(app, urls);
            }
            #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
            let _ = (app, event);
        });
}
