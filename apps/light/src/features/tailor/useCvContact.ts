import { useCallback, useState } from 'react';

import { type Cv } from '@cviper/core-types';

import { NO_CONTACT, detectCvContact, type CvContact } from './cvContact';
import { contactKey, type JobSessions, type TailorResult } from './jobSessions';

/** Which file the details are being checked for, or `null` for "Change". */
export type ContactFormat = 'txt' | 'docx' | 'pdf';

/** The open "Check your details" dialog. */
export interface ContactQuestion {
  /** What the fields start with: the confirmed details, else what the CV says. */
  readonly initial: CvContact;
  /** What the CV itself says. A blank here is a field the CV did not have. */
  readonly found: CvContact;
  readonly format: ContactFormat | null;
  /** The save waiting on the answer, or `null` when the user pressed Change. */
  readonly then: ((contact: CvContact) => void) | null;
}

export interface CvContactInput {
  readonly sessions: JobSessions;
  readonly result: TailorResult | null;
  readonly cvs: readonly Cv[];
  /** The job's confirmed details, by CV id. */
  readonly contacts: Readonly<Record<string, CvContact>>;
}

function trimmed(contact: CvContact): CvContact {
  return {
    name: contact.name.trim(),
    email: contact.email.trim(),
    phone: contact.phone.trim(),
  };
}

/**
 * The name and contact details at the top of a saved CV (L-346).
 *
 * The first Save CV for a draft's CV asks — "Check your details" — and the
 * save goes ahead with the answer. After that the confirmed details are used
 * without asking, and "Change" reopens the dialog. "Not now" writes nothing:
 * no file, no details.
 *
 * The CV is the one the DRAFT was written from (`TailorResult.cvId`), not the
 * one now picked: a draft whose CV is unknown or deleted offers blank fields,
 * never the newest CV's details.
 */
export function useCvContact({ sessions, result, cvs, contacts }: CvContactInput) {
  const [asking, setAsking] = useState<ContactQuestion | null>(null);

  const confirmed = result === null ? null : (contacts[contactKey(result)] ?? null);

  const ask = useCallback(
    (format: ContactFormat | null, then: ContactQuestion['then']) => {
      if (result === null) return;
      const cvId = result.cvId ?? null;
      const cv = cvId === null ? null : (cvs.find((candidate) => candidate.id === cvId) ?? null);
      const found = cv === null ? NO_CONTACT : detectCvContact(cv);
      setAsking({ initial: confirmed ?? found, found, format, then });
    },
    [confirmed, cvs, result],
  );

  /** Run `save` with the confirmed details, asking first when this CV has none. */
  const withContact = useCallback(
    (format: ContactFormat, save: (contact: CvContact) => void) => {
      if (result === null) return;
      if (confirmed !== null) save(confirmed);
      else ask(format, save);
    },
    [ask, confirmed, result],
  );

  const onChangeContact = useCallback(() => ask(null, null), [ask]);

  const onConfirmContact = useCallback(
    (contact: CvContact) => {
      const question = asking;
      setAsking(null);
      if (question === null || result === null) return;
      const key = contactKey(result);
      const kept = trimmed(contact);
      sessions.patch(sessions.get().activeJobId, (current) => ({
        contact: { ...current.contact, [key]: kept },
      }));
      question.then?.(kept);
    },
    [asking, result, sessions],
  );

  const onCancelContact = useCallback(() => setAsking(null), []);

  return { confirmed, asking, withContact, onChangeContact, onConfirmContact, onCancelContact };
}
