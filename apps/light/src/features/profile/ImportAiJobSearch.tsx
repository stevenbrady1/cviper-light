import { useCallback, useState } from 'react';

import { PRIMARY_BUTTON, QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { type FilePort } from '../../platform/files';

import {
  hasAnythingToImport,
  parseAiJobSearchWorkspace,
  type ImportedProfile,
} from './importAiJobSearch';

/**
 * "Bring a profile in": the bottom of the Profile view (L-167).
 *
 * One button opens a FOLDER dialog (in Rust — see `pick_and_read_profile_
 * workspace` in files.rs), the four files come back as text, the parser says
 * what it found, and the user reads that before anything touches the
 * profile. Nothing is written until "Add to my profile", and what is written
 * is a merge that never overwrites typed text (`mergeImportedProfile`).
 *
 * The panel owns its own three states — reading, a review, a problem — and
 * nothing else. The merge and the save are the view's, through `onApply`,
 * because the view is the only thing that holds the loaded profile and the
 * row keys that go with it.
 *
 * A refusal from Rust ("That folder does not look like an ai-job-search
 * workspace.") is shown on the panel's own line, not the view's red bar: it
 * is an answer to the button just pressed, and the profile itself is fine.
 */

export interface ImportAiJobSearchProps {
  readonly filePort: FilePort;
  /** Merge and save. The view does it; the panel only asks. */
  readonly onApply: (imported: ImportedProfile) => void;
}

/** What the review shows for each field, in the order the form shows them. */
const REVIEW_ROWS: ReadonlyArray<{
  readonly field: Exclude<keyof ImportedProfile, 'notes'>;
  readonly label: string;
}> = [
  { field: 'headline', label: 'Headline' },
  { field: 'work_rights', label: 'Right to work' },
  { field: 'writing_style', label: 'How you write' },
  { field: 'languages', label: 'Languages' },
  { field: 'deal_breakers', label: 'Deal breakers' },
  { field: 'target_sectors', label: 'Target sectors' },
  { field: 'career_goals', label: 'Career goals' },
  { field: 'energising', label: 'Energising' },
  { field: 'draining', label: 'Draining' },
  { field: 'star_examples', label: 'STAR examples' },
];

/** One line of the review: the value for a scalar, the count for a list. */
function describe(value: ImportedProfile[Exclude<keyof ImportedProfile, 'notes'>]): string {
  if (typeof value === 'string') return `"${value}"`;
  if (Array.isArray(value)) return `${value.length} to add`;
  return '';
}

type Panel =
  | { readonly kind: 'idle' }
  | { readonly kind: 'reading' }
  | { readonly kind: 'review'; readonly imported: ImportedProfile }
  | { readonly kind: 'problem'; readonly message: string }
  | { readonly kind: 'done'; readonly added: number };

export function ImportAiJobSearch({ filePort, onApply }: ImportAiJobSearchProps) {
  const [panel, setPanel] = useState<Panel>({ kind: 'idle' });

  const pick = useCallback(async () => {
    setPanel({ kind: 'reading' });
    const picked = await filePort.pickProfileWorkspace();
    if (!picked.ok) {
      setPanel({ kind: 'problem', message: picked.error.message });
      return;
    }
    // Cancelled. Nothing is read and nothing is said — see platform/files.ts.
    if (picked.value === null) {
      setPanel({ kind: 'idle' });
      return;
    }
    setPanel({ kind: 'review', imported: parseAiJobSearchWorkspace(picked.value) });
  }, [filePort]);

  const apply = useCallback(() => {
    if (panel.kind !== 'review' || !hasAnythingToImport(panel.imported)) return;
    const { notes: _notes, ...fields } = panel.imported;
    onApply(panel.imported);
    setPanel({ kind: 'done', added: Object.values(fields).filter((v) => v !== undefined).length });
  }, [panel, onApply]);

  const cancel = useCallback(() => setPanel({ kind: 'idle' }), []);

  return (
    <section data-testid="profile-import" className="max-w-2xl border-t border-line pt-6">
      <h2 className="font-medium text-ink">Bring a profile in</h2>
      <p className="mt-1 text-ink-muted">
        If you already keep a candidate profile in an ai-job-search folder, the parts this view has
        a box for can be read in and added to what is here.
      </p>

      <button
        type="button"
        data-testid="profile-import-ajs"
        onClick={() => void pick()}
        disabled={panel.kind === 'reading'}
        className={`mt-3 ${SECONDARY_BUTTON}`}
      >
        Import from an ai-job-search folder…
      </button>
      <p className="mt-1 text-xs text-ink-faint">
        Reads four Markdown files from that folder, on this computer. Nothing is uploaded.
      </p>

      {panel.kind === 'problem' ? (
        <p role="alert" data-testid="profile-import-problem" className="mt-2 text-sm text-danger">
          {panel.message}
        </p>
      ) : null}

      {panel.kind === 'done' ? (
        <p data-testid="profile-import-done" className="mt-2 text-sm text-ink-muted">
          Added to your profile above. Everything is saved.
        </p>
      ) : null}

      {panel.kind === 'review' ? (
        <ReviewPanel imported={panel.imported} onApply={apply} onCancel={cancel} />
      ) : null}
    </section>
  );
}

interface ReviewPanelProps {
  readonly imported: ImportedProfile;
  readonly onApply: () => void;
  readonly onCancel: () => void;
}

function ReviewPanel({ imported, onApply, onCancel }: ReviewPanelProps) {
  const anything = hasAnythingToImport(imported);
  const rows = REVIEW_ROWS.filter((row) => imported[row.field] !== undefined);

  return (
    <div
      data-testid="profile-import-review"
      className="mt-3 rounded-card border border-line bg-card p-4 shadow-raised"
    >
      <h3 className="font-medium text-ink">Found in that folder</h3>

      {anything ? (
        <ul className="mt-2 space-y-1 text-sm">
          {rows.map((row) => (
            <li key={row.field} data-testid={`profile-import-found-${row.field}`}>
              <span className="text-ink-muted">{row.label}:</span>{' '}
              <span className="text-ink">{describe(imported[row.field])}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p data-testid="profile-import-nothing" className="mt-2 text-sm text-ink-muted">
          Nothing to import: every part of that profile is still the template's placeholder.
        </p>
      )}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-ink-muted">What was read, and what was not</summary>
        <ul
          data-testid="profile-import-notes"
          className="mt-1 list-disc space-y-0.5 pl-5 text-ink-faint"
        >
          {imported.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </details>

      <p className="mt-3 text-xs text-ink-faint">
        Lists are added to what you have; a box you have already filled in is left as it is.
      </p>

      <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
        <button
          type="button"
          data-testid="profile-import-apply"
          onClick={onApply}
          disabled={!anything}
          className={PRIMARY_BUTTON}
        >
          Add to my profile
        </button>
        <button
          type="button"
          data-testid="profile-import-cancel"
          onClick={onCancel}
          className={QUIET_BUTTON}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
