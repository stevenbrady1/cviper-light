import { useCallback, useEffect, useRef, useState } from 'react';

import { wordCount, type Cv } from '@cviper/core-types';

import { toLocalIsoDate } from '../../lib/dates';
import { cardClasses, ErrorBox, SectionHeading } from '../../ui';
import { type FilePort } from '../../platform/files';

import { CvUpload } from '../cv/CvUpload';
import { formatPolicyDate } from '../settings/privacy/policyDocument';

import { type ProfileCvPort } from './port';
import { ConfirmDeleteCv, CvRow } from './ProfileCvRow';

// --- Your CV (L-240) --------------------------------------------------------
//
// Which CV the app has, and the same upload as Analysis and Tailor. Its own
// load, separate from the profile's: a CV list that will not read must not
// stop the profile form from opening, and the reverse.

/**
 * "540 words. Added 3 November 2026." (L-403). Each half is left out when it
 * would be untrue: no "0 words" for a CV whose text was never read, no date
 * for a timestamp that will not read. `''` when neither can be said.
 */
function cvFacts(cv: Cv): string {
  // The text and the counter Tailor uses, so the two screens cannot disagree.
  const words = wordCount(cv.extracted_text ?? '');
  // The user's own calendar day. The formatter takes four-digit years only.
  const day = toLocalIsoDate(new Date(cv.created_at));
  return [
    words === 0 ? '' : `${words.toLocaleString('en-GB')} ${words === 1 ? 'word' : 'words'}.`,
    day === null || !/^\d{4}-/.test(day) ? '' : `Added ${formatPolicyDate(day)}.`,
  ]
    .filter((part) => part !== '')
    .join(' ');
}

interface YourCvProps {
  readonly store: ProfileCvPort;
  readonly files: FilePort;
  readonly now: Date | undefined;
}

export function YourCv({ store, files, now }: YourCvProps) {
  const [cvs, setCvs] = useState<readonly Cv[]>([]);
  const [cvsLoaded, setCvsLoaded] = useState(false);
  const [cvError, setCvError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void store.loadCvs().then((loaded) => {
      if (cancelled) return;
      setCvsLoaded(true);
      if (!loaded.ok) {
        setCvError(
          `Your CVs could not be read: ${loaded.error.message} They are still on this machine.`,
        );
        return;
      }
      setCvs(loaded.value);
    });
    return () => {
      cancelled = true;
    };
  }, [store]);

  const onUploaded = useCallback((cv: Cv) => {
    setCvs((current) => [cv, ...current.filter((existing) => existing.id !== cv.id)]);
  }, []);

  // --- Rename and Delete (L-408) --------------------------------------------

  /** The CV the delete question is about, and what deleting it takes too. */
  const [asking, setAsking] = useState<{ readonly cv: Cv; readonly checks: number } | null>(null);
  /** True while the count is being read: a second press must not ask twice. */
  const counting = useRef(false);
  const currentRef = useRef<HTMLParagraphElement>(null);

  const onRename = useCallback(
    async (cv: Cv, name: string): Promise<string | null> => {
      const renamed = { ...cv, name };
      const saved = await store.saveCv(renamed);
      if (!saved.ok) return `That CV could not be saved: ${saved.error.message} Try again.`;
      // In place: the date did not change, so neither does the row's position.
      setCvs((current) => current.map((existing) => (existing.id === cv.id ? renamed : existing)));
      return null;
    },
    [store],
  );

  const onAskDelete = useCallback(
    async (cv: Cv) => {
      if (counting.current) return;
      counting.current = true;
      setCvError(null);
      // Read now, not when the screen opened: a check saved since then counts.
      const checks = await store.loadHistory(cv.id);
      counting.current = false;
      if (!checks.ok) {
        // No count, no question: the warning must be true before anything is deleted.
        setCvError(`${checks.error.message} Your data is still on this machine.`);
        return;
      }
      setAsking({ cv, checks: checks.value.length });
    },
    [store],
  );

  const onConfirmDelete = useCallback(
    async (cv: Cv) => {
      setAsking(null);
      const deleted = await store.deleteCv(cv.id);
      if (!deleted.ok) {
        setCvError(`${deleted.error.message} Your data is still on this machine.`);
        return;
      }
      setCvs((current) => current.filter((existing) => existing.id !== cv.id));
      // The row and its buttons are gone; land on the line that says what is true
      // now. It sits just above where the row was, so nothing needs to scroll.
      currentRef.current?.focus({ preventScroll: true });
    },
    [store],
  );

  // Newest first, as every screen lists them: the one Analysis and Tailor start
  // on unless told otherwise, so "by default" (L-320).
  const newest = cvs[0] ?? null;

  return (
    <section data-testid="profile-cv" className={`mb-5 ${cardClasses()}`}>
      <SectionHeading title="Your CV" />
      <p className="mt-1 text-ink-muted">
        Upload it once and every screen can use it. The file is read on this computer. Its text only
        goes to an AI you choose, and only when you ask it to read your CV.
      </p>

      {/* `break-words`: a name with no spaces, now that one can be typed (L-408),
          ran this line 130px off the side of the page at 1000px wide. */}
      <p
        ref={currentRef}
        tabIndex={-1}
        data-testid="profile-cv-current"
        className="mt-3 break-words text-ink"
      >
        {!cvsLoaded ? (
          'Reading your CVs…'
        ) : newest === null ? (
          'No CV uploaded yet.'
        ) : (
          <>
            Used by default: <span className="font-medium">{newest.name}</span>
            {cvs.length > 1 ? `, the newest of your ${cvs.length} CVs.` : '.'}
          </>
        )}
      </p>

      {cvs.length === 0 ? null : (
        <ul data-testid="profile-cv-list" className="mt-2 space-y-2">
          {cvs.map((cv) => (
            <CvRow
              key={cv.id}
              cv={cv}
              facts={cvFacts(cv)}
              onRename={onRename}
              onDelete={(target) => void onAskDelete(target)}
            />
          ))}
        </ul>
      )}

      {cvError === null ? null : (
        <ErrorBox variant="box" gapAbove="mt-2" testId="profile-cv-error">
          {cvError}
        </ErrorBox>
      )}

      {asking === null ? null : (
        <ConfirmDeleteCv
          name={asking.cv.name}
          checks={asking.checks}
          onCancel={() => setAsking(null)}
          onConfirm={() => void onConfirmDelete(asking.cv)}
        />
      )}

      <div className="mt-3">
        <CvUpload
          idPrefix="profile"
          files={files}
          saveCv={(cv) => store.saveCv(cv)}
          now={now}
          onUploaded={onUploaded}
        />
      </div>
    </section>
  );
}
