import { SECONDARY_BUTTON } from '../../app/buttons';
import { cardClasses } from '../../ui';

import { type LetterResult } from './jobSessions';
import { LETTER_WORD_LIMIT } from './model';

export interface TailorLetterProps {
  readonly letter: LetterResult;
  /** A run or a save is going: the save buttons wait. */
  readonly busy: boolean;
  readonly onSaveText: () => void;
  readonly onSaveDocument: (format: 'docx' | 'pdf') => void;
}

/** The cover letter: figures to check, the text, its length, and its saves. */
export function TailorLetter({ letter, busy, onSaveText, onSaveDocument }: TailorLetterProps) {
  return (
    <div className="space-y-2">
      {letter.claims.length === 0 ? null : (
        <div
          data-testid="tailor-letter-claims"
          className="rounded-control bg-gold/10 px-3 py-2 text-gold-ink"
        >
          <p className="font-medium">Check these figures — they are not in your original CV:</p>
          <ul className="mt-1">
            {letter.claims.map((flag) => (
              <li key={flag.text} className="font-medium">
                {flag.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      <pre
        data-testid="tailor-letter"
        className={`${cardClasses({ padding: 'none' })} px-4 py-3 font-sans text-ink whitespace-pre-wrap`}
      >
        {letter.text}
      </pre>
      <p data-testid="tailor-letter-words" className="text-xs text-ink-faint">
        <span className="font-mono tabular-nums">{letter.words}</span> words
      </p>
      {letter.words > LETTER_WORD_LIMIT ? (
        <p
          data-testid="tailor-letter-long"
          className="rounded-control bg-gold/10 px-3 py-2 text-gold-ink"
        >
          Over {LETTER_WORD_LIMIT} words. A letter this long is a second page most readers skip —
          cut a paragraph.
        </p>
      ) : null}
      <button
        type="button"
        data-testid="tailor-save-letter-text"
        disabled={busy}
        onClick={onSaveText}
        className={SECONDARY_BUTTON}
      >
        Save letter as text…
      </button>
      <button
        type="button"
        data-testid="tailor-save-docx-letter"
        disabled={busy}
        onClick={() => onSaveDocument('docx')}
        className={SECONDARY_BUTTON}
      >
        Save letter as Word…
      </button>
      <button
        type="button"
        data-testid="tailor-save-pdf-letter"
        disabled={busy}
        onClick={() => onSaveDocument('pdf')}
        className={SECONDARY_BUTTON}
      >
        Save letter as PDF…
      </button>
    </div>
  );
}
