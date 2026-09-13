/**
 * The two AI-provider credential names, spelled exactly as the `SecretKey`
 * enum serialises them in `src-tauri/src/secrets.rs`.
 *
 * ============================================================================
 * WHY THIS IS ITS OWN, DEPENDENCY-FREE FILE
 * ============================================================================
 * Three places needed the same two strings — `keys/aiKeyModel.ts` (the key
 * cards), `analysis/availability.ts` (the analysis picker's own probe) and
 * `status/environment.ts` (`SECRET_KEYS`, the rail's full five-credential
 * list) — and coordinator review of PR #96 (C2) found each had its own copy.
 * A typo in any one of them is not a type error: `secret_status`, `secret_set`
 * and `secret_delete` all take a bare string, so a copy that drifted from the
 * other two would silently read or write the WRONG credential rather than
 * fail to compile — see C2's own finding: an untyped `AiKeyProvider.secret`
 * paired with the wrong provider id would test against one provider and write
 * into the other's key, destroying it.
 *
 * A single leaf module with no imports of its own, used by all three, turns
 * "the same two strings" into a fact the compiler enforces (`AiKeySecret`,
 * `aiKeyModel.ts`) rather than something three files have to remember to keep
 * in sync by hand. It has no imports so that importing it can never be the
 * thing that closes a cycle — see `aiKeyProviders.ts`'s own docblock for why
 * that risk is real in this exact neighbourhood of the module graph.
 */
export const OPENAI_SECRET_KEY = 'openai_api_key';
export const ANTHROPIC_SECRET_KEY = 'anthropic_api_key';
