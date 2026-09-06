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
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
