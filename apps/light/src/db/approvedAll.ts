/**
 * The COMPLETE approved list: every database module loaded, then read (L-243).
 *
 * `approved()` registers a statement when its module is first imported, so
 * the list is only whole once all of `src/db` has been. `index.ts` imports
 * every module that sends SQL; importing it here is what makes the list
 * complete rather than whatever happened to be loaded already.
 */
import { registeredSql } from './approved.ts';

export async function allApprovedSql(): Promise<string[]> {
  await import('./index.ts');
  return registeredSql();
}
