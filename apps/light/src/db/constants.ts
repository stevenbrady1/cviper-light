/**
 * The database URL — the one string both sides of the FFI boundary must agree
 * on.
 *
 * ============================================================================
 * THIS MUST BYTE-MATCH `DB_URL` IN `src-tauri/src/db.rs`.
 * ============================================================================
 * tauri-plugin-sql keys its registered migrations by the exact `db_url` string
 * passed to `add_migrations`, and looks them up with the exact string passed to
 * `Database.load()`:
 *
 *     migrations.0.lock().await.remove(&db)      // commands.rs::load
 *
 * A `HashMap::remove` on a key that does not match returns `None`, and the
 * plugin treats that as "this database has no migrations". So a one-character
 * difference — `sqlite:cviper.db` vs `sqlite://cviper.db`, or a stray space —
 * does not raise an error anywhere. The app starts, connects to an EMPTY
 * database, and the first query fails with "no such table". There is a test in
 * `src-tauri/src/db.rs` asserting the two strings are equal.
 *
 * `sqlite:` paths are resolved by the plugin against `app_config_dir()`, which
 * it creates if missing, so this lands at:
 *
 *     Windows  %APPDATA%\com.cviper.light\cviper.db
 *     macOS    ~/Library/Application Support/com.cviper.light/cviper.db
 *     Linux    ~/.config/com.cviper.light/cviper.db
 */
export const DB_URL = 'sqlite:cviper.db';
