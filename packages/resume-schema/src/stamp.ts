/**
 * Stamp a résumé with who wrote it out, and touch nothing else.
 *
 * `meta.cviper` is the one block CViper owns in a JSON Resume file. On export
 * it says which app wrote the file, when, and which stored CV it came from, so
 * a re-import can be recognised. Every other key — including any `meta` the
 * file already had, in the order it had it — is left exactly as it was: the
 * L-20 promise is that a file goes out as it came in, and this is the only
 * place that promise is deliberately bent, by one named block.
 */
import type { CviperMeta, JsonResume } from './schema';

export function stampCviperMeta(resume: JsonResume, cviper: CviperMeta): JsonResume {
  const meta = { ...(resume.meta ?? {}), cviper };
  // Spreading `resume` first keeps its key order; assigning `meta` afterwards
  // keeps `meta` where it was if the file had one, and appends it if not.
  return { ...resume, meta };
}
