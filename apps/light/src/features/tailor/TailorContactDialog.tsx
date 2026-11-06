import { useEffect, useRef, useState } from 'react';

import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { useFocusTrap } from '../../lib/useFocusTrap';

import { contactLine, type CvContact } from './cvContact';
import { layoutBlocks } from './pdf';
import { type ContactQuestion } from './useCvContact';

const FIELD = 'mt-1 w-full rounded-control border border-field-line bg-card px-2.5 py-1.5 text-ink';
const LABEL = 'block text-xs font-medium text-ink-muted';

const FIELDS = [
  { key: 'name', label: 'Name', type: 'text', autoComplete: 'name' },
  { key: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel' },
] as const;

/** Whether the PDF's built-in font would turn any of these letters into `?`. */
function pdfCannotShow(contact: CvContact): boolean {
  const missing = new Set<string>();
  layoutBlocks(
    [
      { kind: 'name', text: contact.name },
      { kind: 'line', text: contactLine(contact) ?? '' },
    ],
    missing,
  );
  return missing.size > 0;
}

interface TailorContactDialogProps {
  readonly question: ContactQuestion;
  readonly onConfirm: (contact: CvContact) => void;
  readonly onCancel: () => void;
}

/**
 * "Check your details" (L-346): the name, email and phone that go at the top
 * of a saved CV, read from the CV the user uploaded and editable here.
 *
 * Built like `ConsentGate`: a modal the save waits on, Tab kept inside,
 * Escape the same answer as "Not now", which writes nothing. Nothing is
 * required and no format is enforced — a blank field is simply left out.
 */
export function TailorContactDialog({ question, onConfirm, onCancel }: TailorContactDialogProps) {
  const [draft, setDraft] = useState<CvContact>(question.initial);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  // Before the focus effect below, so the opener is read first (L-236).
  useFocusTrap(dialogRef);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCancel();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const warnPdf = question.format !== 'docx' && question.format !== 'txt' && pdfCannotShow(draft);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tailor-contact-title"
        aria-describedby="tailor-contact-body"
        data-testid="tailor-contact-dialog"
        className="w-full max-w-sm rounded-card bg-card p-5 shadow-overlay"
      >
        <h2 id="tailor-contact-title" className="font-semibold text-ink">
          Check your details
        </h2>
        <p id="tailor-contact-body" className="mt-1 text-ink-muted">
          These go at the top of your CV. We read them from the CV you uploaded, so please change
          anything that isn&apos;t right.
        </p>

        <form
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm(draft);
          }}
        >
          {FIELDS.map((field, index) => {
            const id = `tailor-contact-${field.key}`;
            const notFound = question.found[field.key] === '' && draft[field.key].trim() === '';
            return (
              <div key={field.key}>
                <label htmlFor={id} className={LABEL}>
                  {field.label}
                </label>
                <input
                  ref={index === 0 ? firstRef : undefined}
                  id={id}
                  data-testid={id}
                  type={field.type}
                  autoComplete={field.autoComplete}
                  value={draft[field.key]}
                  aria-describedby={notFound ? `${id}-missing` : undefined}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setDraft((current) => ({ ...current, [field.key]: value }));
                  }}
                  className={FIELD}
                />
                {notFound ? (
                  <p
                    id={`${id}-missing`}
                    data-testid={`${id}-missing`}
                    className="mt-1 text-xs text-ink-muted"
                  >
                    We couldn&apos;t find this in your CV. Add it here, or leave it empty.
                  </p>
                ) : null}
              </div>
            );
          })}

          {warnPdf ? (
            <p data-testid="tailor-contact-pdf-warning" className="text-xs text-ink-muted">
              A PDF can&apos;t show some letters in your details, so they would appear as ?. Save as
              Word to keep them exactly.
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              data-testid="tailor-contact-cancel"
              className={SECONDARY_BUTTON}
            >
              Not now
            </button>
            <button type="submit" data-testid="tailor-contact-confirm" className={PRIMARY_BUTTON}>
              Save with these details
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
