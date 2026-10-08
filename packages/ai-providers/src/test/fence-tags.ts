/**
 * A prompt with its per-prompt fence tag taken out (L-210), for tests that
 * compare two prompts or cut a section out by its marker text.
 *
 * Every builder draws a fresh random tag, so two prompts built from the same
 * input differ in that tag and nowhere else. Removing it lets an existing
 * assertion about the TEXT stay exactly as strict as it was.
 * `fence-shape.contract.test.ts` separately proves that every fence line in
 * every prompt carries the tag the rule names, so nothing here can hide a
 * fence that lost its tag.
 */
import { fenceTagOf } from '../prompt/fence';

export function untagged(text: string): string {
  const tag = fenceTagOf(text);
  if (tag === null) return text;
  return text.replaceAll(` #${tag}`, '').replaceAll(tag, 'TAG');
}
