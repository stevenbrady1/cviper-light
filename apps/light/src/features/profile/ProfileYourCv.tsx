import { useCallback, useEffect, useState } from 'react';

import { type Cv } from '@cviper/core-types';

import { cardClasses, SectionHeading } from '../../ui';
import { type FilePort } from '../../platform/files';

import { CvUpload } from '../cv/CvUpload';
import { type CvStorePort } from '../cv/ingestCv';

// --- Your CV (L-240) --------------------------------------------------------
//
// Which CV the app has, and the same upload as Analysis and Tailor. Its own
// load, separate from the profile's: a CV list that will not read must not
// stop the profile form from opening, and the reverse.

interface YourCvProps {
  readonly store: CvStorePort;
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

  // Newest first, as every screen lists them — the one Tailor and Analysis
  // start on.
  const newest = cvs[0] ?? null;

  return (
    <section data-testid="profile-cv" className={`mb-5 ${cardClasses()}`}>
      <SectionHeading title="Your CV" />
      <p className="mt-1 text-ink-muted">
        Upload it once — here, on Analysis or on Tailor — and every screen can use it. The file is
        read on this computer. Its text only goes to an AI you choose, and only when you ask it to
        read your CV.
      </p>

      <p data-testid="profile-cv-current" className="mt-3 text-ink">
        {!cvsLoaded ? (
          'Reading your CVs…'
        ) : newest === null ? (
          'No CV uploaded yet.'
        ) : (
          <>
            Newest: <span className="font-medium">{newest.name}</span>
          </>
        )}
      </p>

      {cvError === null ? null : (
        <p
          role="alert"
          data-testid="profile-cv-error"
          className="mt-2 rounded-control bg-danger/5 px-3 py-2 text-danger"
        >
          {cvError}
        </p>
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
