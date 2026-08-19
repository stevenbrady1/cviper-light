# Feature Matrix — Light vs Cloud

Where each feature lives. **As of Phase 0 (Scaffold), nothing in this table is
built.** The Light column records the _intent_; the Phase-0 State column records
the truth.

`apps/cloud` is an empty stub directory. There is no cloud code of any kind.

| Feature                      | Light                                   | Cloud (future)                     | Phase-0 State |
| ---------------------------- | --------------------------------------- | ---------------------------------- | ------------- |
| Job search (Adzuna/Reed)     | Yes — user's own API keys, direct calls | Yes — server-side, shared keys     | Not built     |
| Keyless browser search links | Yes — no key needed, opens in browser   | Not applicable                     | Not built     |
| Application tracker          | Yes — local SQLite                      | Yes — synced                       | Not built     |
| CV parsing                   | Yes — fully local                       | Yes — server-side                  | Not built     |
| CV analysis (BYO key)        | Yes — user's own provider key           | Not applicable                     | Not built     |
| CV analysis (local Ollama)   | Yes — offline, no key, no network       | No                                 | Not built     |
| Keyword-only analysis        | Yes — no AI, no key, always available   | Yes                                | Not built     |
| Data export/import           | Yes — user-initiated file in/out        | Yes — plus migration to/from Light | Not built     |
| Accounts                     | No — no login, no identity              | Yes                                | Not built     |
| Sync                         | No — single device by design            | Yes                                | Not built     |
| Telemetry                    | No — none, ever                         | Opt-in                             | Not built     |

## Notes

- **Light is local-first.** Data lives in SQLite on the user's machine. Secrets
  go to the OS credential store via the `keyring` crate, never to a file.
- **Keyless first.** Every capability that can work without an API key has a
  keyless path, so the app is useful before the user configures anything.
- **"No" in the Light column is a product decision, not a gap** — accounts,
  sync, and telemetry are deliberately absent.
