/**
 * Result<T, E> — the error channel for @cviper/core-types.
 *
 * NOTHING IN THIS PACKAGE THROWS ACROSS A BOUNDARY. Every operation that can
 * fail returns a `Result`. Callers must narrow on `.ok` before touching the
 * payload, which means a forgotten failure path is a compile error rather than
 * a crash in front of the user.
 */

/** A successful outcome carrying `value`. */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/** A failed outcome carrying `error`. Never carries a partial value. */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}
