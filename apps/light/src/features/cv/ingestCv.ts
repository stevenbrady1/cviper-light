/**
 * A CV file becomes a CV row — the one way in, whichever screen the button is
 * on (L-240).
 *
 * ============================================================================
 * ONE PARSER, ONE STORE, EVERY SCREEN
 * ============================================================================
 * Analysis, Tailor and Profile all offer "Upload a CV". They share this code
 * rather than three copies of it, so a file one screen refuses is refused by
 * all three in the same words, and a CV saved on any of them lands in the same
 * `cvs` table every other screen reads. Uploading on Profile and then opening
 * Tailor shows the CV; there is nothing to sync because there is nothing else.
 *
 * Extracted from `Analysis.tsx` (where it lived until L-240) without changing
 * what it does: the parser's message is passed through VERBATIM — every one of
 * them says what happened and what to do, and "upload failed" would throw that
 * away — and a CV that read but could not be stored says so separately.
 */
import { extractText } from '@cviper/cv-parsing';
import { err, ok, type Cv, type Result } from '@cviper/core-types';

import { type DbError } from '../../db';
import { type FilePort, type PickedCv } from '../../platform/files';

import { newCvRecord, originalJsonResume } from '../analysis/model';

/**
 * The two CV calls every screen with an upload needs. The same shape as the
 * CV half of `AnalysisPort` and `TailorPort`, so either of those satisfies it.
 */
export interface CvStorePort {
  /** Every CV the user has uploaded, newest first. */
  loadCvs(): Promise<Result<Cv[], DbError>>;
  saveCv(cv: Cv): Promise<Result<void, DbError>>;
}

export interface IngestedCv {
  readonly cv: Cv;
  /**
   * Set when the file DID read but some of it could not — pages that are
   * images. The CV is stored; the user is told what is missing from it.
   */
  readonly warnings: readonly string[];
}

export interface IngestProblem {
  /**
   * `unreadable`: the file was refused (the dialog layer or the parser) and
   * nothing was stored. `not-saved`: it read, but the database refused it.
   */
  readonly kind: 'unreadable' | 'not-saved';
  /** Legible as it stands — shown to the user with nothing added. */
  readonly message: string;
}

export interface IngestDeps {
  readonly saveCv: CvStorePort['saveCv'];
  readonly now: Date;
  /** Injected by tests. Defaults to `crypto.randomUUID`. */
  readonly newId?: (() => string) | undefined;
}

/** Read the bytes, store the CV, and return it — or say why not. */
export async function ingestCv(
  picked: PickedCv,
  deps: IngestDeps,
): Promise<Result<IngestedCv, IngestProblem>> {
  const extracted = await extractText(picked.name, picked.bytes);
  if (!extracted.ok) {
    return err({ kind: 'unreadable', message: extracted.error.message });
  }

  const cv = newCvRecord({
    id: (deps.newId ?? (() => crypto.randomUUID()))(),
    name: picked.name,
    text: extracted.value.text,
    now: deps.now.toISOString(),
    // Kept verbatim when the file WAS a JSON Resume, so "Save as JSON
    // Resume" can return exactly it (L-20b). `null` for everything else.
    jsonResume: originalJsonResume(picked.name, picked.bytes),
  });

  const saved = await deps.saveCv(cv);
  if (!saved.ok) {
    return err({
      kind: 'not-saved',
      message: `That CV could not be saved: ${saved.error.message} Try again.`,
    });
  }

  return ok({ cv, warnings: extracted.value.warnings });
}

/**
 * Open the file dialog, then `ingestCv` whatever was chosen.
 *
 * `ok(null)` is a cancelled dialog: somebody changed their mind, nothing
 * happened, and nothing should be said about it.
 */
export async function uploadCv(
  files: Pick<FilePort, 'pickCv'>,
  deps: IngestDeps,
): Promise<Result<IngestedCv | null, IngestProblem>> {
  const picked = await files.pickCv();
  if (!picked.ok) return err({ kind: 'unreadable', message: picked.error.message });
  if (picked.value === null) return ok(null);
  return ingestCv(picked.value, deps);
}
