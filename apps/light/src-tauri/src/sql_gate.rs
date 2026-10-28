//! The only way the page reaches the database (L-243).
//!
//! ============================================================================
//! WHY THIS EXISTS
//! ============================================================================
//! `tauri-plugin-sql`'s own `execute` and `select` commands run whatever SQL
//! the page sends. `select` is `fetch_all` on the raw text, so even without
//! `sql:allow-execute` it will run `ATTACH DATABASE '<path>' AS x`, which
//! creates a file anywhere the user can write — the Windows Startup folder,
//! for instance. If script ever got into the page, that is a step to code
//! execution. The defence until now was only that injecting script is hard.
//!
//! So the page holds no `sql:` permission at all (see
//! `capabilities/default.json`): Rust opens the file and runs the migrations
//! at startup (`lib.rs`, after the safety copy). The page calls these
//! two commands instead, and they run a statement ONLY when its exact text is
//! in `APPROVED_SQL` — generated from the `approved()` calls in `src/db/`,
//! and checked against them by `approved-sql.contract.test.ts`. Anything else
//! is refused before the database is touched.
//!
//! ============================================================================
//! THE SAME RESULTS AS THE PLUGIN, ON PURPOSE
//! ============================================================================
//! The connection is the plugin's own pool (its `DbInstances` state), so the
//! file, the migrations and the one-connection serialisation in
//! `src/db/client.ts` are unchanged. Values are bound exactly as the plugin
//! binds them, rows are decoded exactly as it decodes them (`to_json`, after
//! its `decode/sqlite.rs`, Apache-2.0 OR MIT), and an error is the database's
//! own message, as the plugin passed it — `src/db/errors.ts` reads "constraint
//! failed" out of that text.

use indexmap::IndexMap;
use serde_json::Value as JsonValue;
use sqlx::sqlite::{SqliteArguments, SqliteValueRef};
use sqlx::{Column, Executor, Pool, Row, Sqlite, TypeInfo, Value, ValueRef};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};
use time::{Date, PrimitiveDateTime, Time};

use crate::approved_sql::APPROVED_SQL;
use crate::db::DB_URL;

type Query<'q> = sqlx::query::Query<'q, Sqlite, SqliteArguments<'q>>;

/// True only for a statement whose text is EXACTLY one the app was built with.
pub(crate) fn is_approved(sql: &str) -> bool {
    APPROVED_SQL.contains(&sql)
}

fn refusal(sql: &str) -> String {
    let shown: String = sql.chars().take(120).collect();
    format!("Not an approved statement (L-243): {shown}")
}

/// Bind the values exactly as `tauri-plugin-sql` 2.6 does.
fn bind(sql: &str, values: Vec<JsonValue>) -> Query<'_> {
    let mut query = sqlx::query(sql);
    for value in values {
        if value.is_null() {
            query = query.bind(None::<JsonValue>);
        } else if value.is_string() {
            query = query.bind(value.as_str().unwrap_or_default().to_owned());
        } else if let Some(number) = value.as_number() {
            query = query.bind(number.as_f64().unwrap_or_default());
        } else {
            query = query.bind(value);
        }
    }
    query
}

/// A column value as JSON, exactly as `tauri-plugin-sql` 2.6 decodes it.
fn to_json(value: SqliteValueRef) -> Result<JsonValue, String> {
    if value.is_null() {
        return Ok(JsonValue::Null);
    }
    let owned = value.to_owned();
    Ok(match value.type_info().name() {
        "TEXT" => owned
            .try_decode::<String>()
            .map(JsonValue::String)
            .unwrap_or(JsonValue::Null),
        "REAL" => owned
            .try_decode::<f64>()
            .map(JsonValue::from)
            .unwrap_or(JsonValue::Null),
        "INTEGER" | "NUMERIC" => owned
            .try_decode::<i64>()
            .map(|n| JsonValue::Number(n.into()))
            .unwrap_or(JsonValue::Null),
        "BOOLEAN" => owned
            .try_decode::<bool>()
            .map(JsonValue::Bool)
            .unwrap_or(JsonValue::Null),
        "DATE" => owned
            .try_decode::<Date>()
            .map(|d| JsonValue::String(d.to_string()))
            .unwrap_or(JsonValue::Null),
        "TIME" => owned
            .try_decode::<Time>()
            .map(|t| JsonValue::String(t.to_string()))
            .unwrap_or(JsonValue::Null),
        "DATETIME" => owned
            .try_decode::<PrimitiveDateTime>()
            .map(|t| JsonValue::String(t.to_string()))
            .unwrap_or(JsonValue::Null),
        "BLOB" => owned
            .try_decode::<Vec<u8>>()
            .map(|bytes| {
                JsonValue::Array(
                    bytes
                        .into_iter()
                        .map(|n| JsonValue::Number(n.into()))
                        .collect(),
                )
            })
            .unwrap_or(JsonValue::Null),
        "NULL" => JsonValue::Null,
        other => return Err(format!("unsupported datatype: {other}")),
    })
}

/// Run an approved statement on `pool`: `(rows affected, last insert row id)`.
pub(crate) async fn execute_on(
    pool: &Pool<Sqlite>,
    sql: &str,
    values: Vec<JsonValue>,
) -> Result<(u64, i64), String> {
    if !is_approved(sql) {
        return Err(refusal(sql));
    }
    let result = pool
        .execute(bind(sql, values))
        .await
        .map_err(|e| e.to_string())?;
    Ok((result.rows_affected(), result.last_insert_rowid()))
}

/// Run an approved query on `pool`: one map per row, columns in order.
pub(crate) async fn select_on(
    pool: &Pool<Sqlite>,
    sql: &str,
    values: Vec<JsonValue>,
) -> Result<Vec<IndexMap<String, JsonValue>>, String> {
    if !is_approved(sql) {
        return Err(refusal(sql));
    }
    let rows = pool
        .fetch_all(bind(sql, values))
        .await
        .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let mut map = IndexMap::default();
        for (index, column) in row.columns().iter().enumerate() {
            let raw = row.try_get_raw(index).map_err(|e| e.to_string())?;
            map.insert(column.name().to_string(), to_json(raw)?);
        }
        out.push(map);
    }
    Ok(out)
}

/// Why the database did not open at startup, when it did not (L-243, part 2).
///
/// Managed by `lib.rs` only when registering the SQL plugin failed — a full
/// disk, a locked file, a migration that would not apply. Every query then
/// returns this reason rather than a bare "not loaded", so the screen can say
/// what is actually wrong.
pub(crate) struct DbOpenFailed(pub(crate) String);

/// What a query hears when there is no database to run on.
fn not_open(failed: Option<&str>) -> String {
    match failed {
        Some(reason) => format!("the database could not be opened when CViper started: {reason}"),
        None => format!("database {DB_URL} not loaded"),
    }
}

/// The plugin's pool for the app's own database. Errors read as the plugin's.
async fn app_pool(app: &AppHandle) -> Result<Pool<Sqlite>, String> {
    let Some(instances) = app.try_state::<DbInstances>() else {
        let failed = app.try_state::<DbOpenFailed>();
        return Err(not_open(failed.as_deref().map(|f| f.0.as_str())));
    };
    let instances = instances.0.read().await;
    // `DbPool::sqlite()` is commented out in the published 2.6.0, so match
    // the public variant. The app builds the plugin with `sqlite` only.
    match instances.get(DB_URL) {
        Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
        #[allow(unreachable_patterns)]
        _ => Err(format!("database {DB_URL} not loaded")),
    }
}

#[tauri::command]
pub(crate) async fn db_execute(
    app: AppHandle,
    sql: String,
    values: Vec<JsonValue>,
) -> Result<(u64, i64), String> {
    // Refused BEFORE the pool is looked up: an unapproved statement learns
    // nothing about the database, not even whether it is open.
    if !is_approved(&sql) {
        return Err(refusal(&sql));
    }
    execute_on(&app_pool(&app).await?, &sql, values).await
}

#[tauri::command]
pub(crate) async fn db_select(
    app: AppHandle,
    sql: String,
    values: Vec<JsonValue>,
) -> Result<Vec<IndexMap<String, JsonValue>>, String> {
    if !is_approved(&sql) {
        return Err(refusal(&sql));
    }
    select_on(&app_pool(&app).await?, &sql, values).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;

    fn block_on<F: std::future::Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    /// A one-connection in-memory database with the real `interview_substages`
    /// and `jobs` shape — enough to run approved statements for real.
    fn memory_db() -> Pool<Sqlite> {
        block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            for migration in crate::db::migrations() {
                pool.execute(migration.sql).await.unwrap();
            }
            pool
        })
    }

    #[test]
    fn a_database_that_did_not_open_says_why() {
        assert_eq!(
            not_open(Some("disk full")),
            "the database could not be opened when CViper started: disk full"
        );
        assert_eq!(not_open(None), format!("database {DB_URL} not loaded"));
    }

    #[test]
    fn approval_is_exact_text_only() {
        assert!(is_approved("COMMIT;"));
        assert!(
            !is_approved("COMMIT; "),
            "a trailing space is a different statement"
        );
        assert!(!is_approved("commit;"), "case is part of the text");
        assert!(!is_approved("COMMIT;; ATTACH DATABASE 'x' AS y"));
        assert!(!is_approved(""));
    }

    #[test]
    fn attach_and_pragma_tricks_are_refused_before_the_database_is_touched() {
        let pool = memory_db();
        for sql in [
            "ATTACH DATABASE '/tmp/evil.db' AS evil",
            "SELECT load_extension('x')",
            "PRAGMA writable_schema = ON",
            "SELECT name FROM sqlite_master",
        ] {
            let ran = block_on(execute_on(&pool, sql, vec![]));
            assert!(
                ran.unwrap_err()
                    .starts_with("Not an approved statement (L-243)"),
                "{sql}"
            );
            let read = block_on(select_on(&pool, sql, vec![]));
            assert!(
                read.unwrap_err()
                    .starts_with("Not an approved statement (L-243)"),
                "{sql}"
            );
        }
        // Nothing was attached: still exactly one database on the connection.
        let databases: Vec<(i64, String, String)> =
            block_on(sqlx::query_as("PRAGMA database_list").fetch_all(&pool)).unwrap();
        assert_eq!(databases.len(), 1);
    }

    #[test]
    fn nothing_on_the_approved_list_attaches_or_loads_anything() {
        for sql in APPROVED_SQL {
            let upper = sql.to_uppercase();
            assert!(!upper.contains("ATTACH"), "{sql}");
            assert!(!upper.contains("LOAD_EXTENSION"), "{sql}");
        }
    }

    #[test]
    fn an_approved_write_and_read_come_back_as_the_plugin_returned_them() {
        let pool = memory_db();
        let upsert = APPROVED_SQL
            .iter()
            .find(|sql| sql.starts_with("INSERT INTO interview_substages"))
            .unwrap();
        let (affected, _) = block_on(execute_on(
            &pool,
            upsert,
            vec![json!("sub-a"), json!("HR Screen"), json!(0)],
        ))
        .unwrap();
        assert_eq!(affected, 1);

        let rows = block_on(select_on(
            &pool,
            "SELECT id, name, position FROM interview_substages ORDER BY position, id",
            vec![],
        ))
        .unwrap();
        assert_eq!(rows.len(), 1);
        // Columns in order, a number bound from JSON reads back as an integer
        // in an INTEGER column, text as text.
        assert_eq!(
            rows[0].keys().collect::<Vec<_>>(),
            ["id", "name", "position"]
        );
        assert_eq!(rows[0]["id"], json!("sub-a"));
        assert_eq!(rows[0]["position"], json!(0));
    }

    #[test]
    fn the_keep_only_delete_binds_one_json_array() {
        let pool = memory_db();
        let upsert = APPROVED_SQL
            .iter()
            .find(|sql| sql.starts_with("INSERT INTO interview_substages"))
            .unwrap();
        for (index, id) in ["a", "b", "c"].iter().enumerate() {
            block_on(execute_on(
                &pool,
                upsert,
                vec![json!(id), json!(id), json!(index)],
            ))
            .unwrap();
        }
        let keep_only =
            "DELETE FROM interview_substages WHERE id NOT IN (SELECT value FROM json_each($1))";
        let (affected, _) = block_on(execute_on(&pool, keep_only, vec![json!("[\"b\"]")])).unwrap();
        assert_eq!(affected, 2);
    }

    #[test]
    fn a_constraint_failure_keeps_the_database_s_own_words() {
        let pool = memory_db();
        let upsert_job = APPROVED_SQL
            .iter()
            .find(|sql| sql.starts_with("INSERT INTO jobs"))
            .unwrap();
        // Every column NULL: `id` is the primary key and the rest are NOT NULL
        // in places, so SQLite rejects it with its own constraint message.
        let columns = upsert_job.matches('$').count();
        let error = block_on(execute_on(
            &pool,
            upsert_job,
            vec![JsonValue::Null; columns],
        ))
        .unwrap_err();
        assert!(error.contains("constraint failed"), "{error}");
    }
}
