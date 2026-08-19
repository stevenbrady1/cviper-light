/**
 * Telemetry: the switch that is off, and the promise it makes checkable.
 *
 * ============================================================================
 * WHY A DISABLED SWITCH EXISTS AT ALL.
 * ============================================================================
 * The obvious alternative is nothing — no switch, no flag, no mention. That is
 * what most local-first apps do, and it leaves the user with a claim they have
 * to take on trust: an app that says nothing about telemetry looks exactly like
 * an app that has some.
 *
 * A visible, disabled, off switch says the opposite, and says it in the one
 * place a suspicious person goes looking. It also gives the promise a shape a
 * machine can check: `telemetry.contract.test.ts` asserts this flag is the
 * literal `false` and that no branch anywhere in the source does anything when
 * it is true. The day somebody writes `if (TELEMETRY_ENABLED) send(...)`, the
 * build goes red rather than the Settings screen going quietly dishonest.
 *
 * ============================================================================
 * THE TYPE IS PART OF THE GUARD.
 * ============================================================================
 * `false`, not `boolean`. Flipping it is a compile error, so switching
 * telemetry on cannot be a one-character change somebody makes without a
 * conversation — it has to be a deliberate widening of this type, in a diff
 * that also has to delete a test named for the promise it protects.
 */

/**
 * The only value telemetry is allowed to have.
 *
 * A named alias rather than a bare `: false` annotation, for two reasons. The
 * lint rule `prefer-as-const` rewrites the bare form to `false as const`, which
 * INFERS the type and therefore quietly accepts `true as const` — the exact
 * one-character change this is here to prevent. And a name gives the constraint
 * somewhere to be read.
 */
export type TelemetryEnabled = false;

/** Off. Widening `TelemetryEnabled` is the only way to change this. */
export const TELEMETRY_ENABLED: TelemetryEnabled = false;

/**
 * What the switch says.
 *
 * Three facts in one line, in this order: what it would be, that it does not
 * exist, and what the app does today. "Not implemented" on its own would leave
 * the reader wondering whether something else is collecting instead.
 */
export const TELEMETRY_NOTE =
  'Anonymous usage statistics — not implemented. CViper Light sends no data.';
