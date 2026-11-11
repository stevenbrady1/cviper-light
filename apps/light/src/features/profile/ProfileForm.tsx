import {
  type Profile as CandidateProfile,
  type ProfileLanguage,
  type StarExample,
} from '@cviper/core-types';

import { QUIET_BUTTON, SECONDARY_BUTTON } from '../../app/buttons';
import { cardClasses, SectionHeading } from '../../ui';
import { useDebouncedField } from '../../lib/useDebouncedField';

import { linesToList, listToLines, textOrNull } from './model';

/** How long after the last keystroke a field saves itself. Same as the tracker. */
export const AUTOSAVE_DELAY_MS = 600;

/** The loaded profile plus the stable keys for its two lists of rows. */
export interface Loaded {
  readonly profile: CandidateProfile;
  readonly languageKeys: readonly number[];
  readonly starKeys: readonly number[];
}

const FIELD = 'mt-1 w-full rounded-control border border-field-line bg-card px-2.5 py-1.5 text-ink';
const LABEL = 'block text-xs font-medium text-ink-muted';

// --- The form ---------------------------------------------------------------
//
// Split from the shell above so every `useDebouncedField` mounts ONCE, with
// the loaded value as its initial draft. Mounted before the load lands, the
// boxes would start empty and stay empty.

interface ProfileFormProps {
  readonly loaded: Loaded;
  readonly onEdit: (changes: Partial<CandidateProfile>) => void;
  readonly onAddLanguage: () => void;
  readonly onLanguageChange: (key: number, patch: Partial<ProfileLanguage>) => void;
  readonly onRemoveLanguage: (key: number) => void;
  readonly onAddStar: () => void;
  readonly onStarChange: (key: number, patch: Partial<StarExample>) => void;
  readonly onRemoveStar: (key: number) => void;
}

export function ProfileForm({
  loaded,
  onEdit,
  onAddLanguage,
  onLanguageChange,
  onRemoveLanguage,
  onAddStar,
  onStarChange,
  onRemoveStar,
}: ProfileFormProps) {
  const { profile, languageKeys, starKeys } = loaded;

  const headline = useDebouncedField(
    profile.headline ?? '',
    (value) => onEdit({ headline: textOrNull(value) }),
    AUTOSAVE_DELAY_MS,
  );
  const workRights = useDebouncedField(
    profile.work_rights ?? '',
    (value) => onEdit({ work_rights: textOrNull(value) }),
    AUTOSAVE_DELAY_MS,
  );
  const writingStyle = useDebouncedField(
    profile.writing_style ?? '',
    (value) => onEdit({ writing_style: textOrNull(value) }),
    AUTOSAVE_DELAY_MS,
  );
  const dealBreakers = useDebouncedField(
    listToLines(profile.deal_breakers),
    (value) => onEdit({ deal_breakers: linesToList(value) }),
    AUTOSAVE_DELAY_MS,
  );
  const targetSectors = useDebouncedField(
    listToLines(profile.target_sectors),
    (value) => onEdit({ target_sectors: linesToList(value) }),
    AUTOSAVE_DELAY_MS,
  );
  const careerGoals = useDebouncedField(
    listToLines(profile.career_goals),
    (value) => onEdit({ career_goals: linesToList(value) }),
    AUTOSAVE_DELAY_MS,
  );
  const energising = useDebouncedField(
    listToLines(profile.energising),
    (value) => onEdit({ energising: linesToList(value) }),
    AUTOSAVE_DELAY_MS,
  );
  const draining = useDebouncedField(
    listToLines(profile.draining),
    (value) => onEdit({ draining: linesToList(value) }),
    AUTOSAVE_DELAY_MS,
  );

  return (
    <div className="space-y-5">
      <section data-testid="profile-about" className={cardClasses()}>
        <SectionHeading title="About you" />
        <p className="mt-1 text-ink-muted">
          The short version of who you are. Everything written for you starts from here.
        </p>

        <div className="mt-3 space-y-4">
          <div>
            <label htmlFor="profile-headline" className={LABEL}>
              Headline
            </label>
            <input
              id="profile-headline"
              data-testid="profile-headline"
              value={headline.draft}
              placeholder="e.g. Credit risk analyst moving into quant development"
              onChange={(event) => headline.setDraft(event.currentTarget.value)}
              onBlur={headline.flush}
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor="profile-work-rights" className={LABEL}>
              Right to work
            </label>
            <input
              id="profile-work-rights"
              data-testid="profile-work-rights"
              value={workRights.draft}
              placeholder="e.g. UK citizen, no sponsorship needed"
              onChange={(event) => workRights.setDraft(event.currentTarget.value)}
              onBlur={workRights.flush}
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor="profile-writing-style" className={LABEL}>
              How you write
            </label>
            <textarea
              id="profile-writing-style"
              data-testid="profile-writing-style"
              rows={3}
              value={writingStyle.draft}
              placeholder="e.g. Plain, short sentences. No buzzwords. British spelling."
              onChange={(event) => writingStyle.setDraft(event.currentTarget.value)}
              onBlur={writingStyle.flush}
              className={FIELD}
            />
            <p className="mt-1 text-xs text-ink-faint">Saved as you type.</p>
          </div>
        </div>
      </section>

      <section data-testid="profile-languages" className={cardClasses()}>
        <SectionHeading title="Languages" />
        <p className="mt-1 text-ink-muted">Each one, and how well you speak it.</p>

        {languageKeys.length === 0 ? (
          <p data-testid="profile-languages-empty" className="mt-2 text-xs text-ink-faint">
            None added yet.
          </p>
        ) : null}

        <ul className="mt-3 space-y-2">
          {languageKeys.map((key, index) => {
            const language = profile.languages[index];
            if (language === undefined) return null;
            return (
              <LanguageRow
                key={key}
                index={index}
                language={language}
                onChange={(patch) => onLanguageChange(key, patch)}
                onRemove={() => onRemoveLanguage(key)}
              />
            );
          })}
        </ul>

        <button
          type="button"
          data-testid="profile-language-add"
          onClick={onAddLanguage}
          className={`mt-3 ${SECONDARY_BUTTON}`}
        >
          Add a language
        </button>
      </section>

      <section data-testid="profile-wants" className={cardClasses()}>
        <SectionHeading title="What you are looking for" />
        <p className="mt-1 text-ink-muted">One per line.</p>

        <div className="mt-3 space-y-4">
          <div>
            <label htmlFor="profile-deal-breakers" className={LABEL}>
              Deal breakers
            </label>
            <textarea
              id="profile-deal-breakers"
              data-testid="profile-deal-breakers"
              rows={3}
              value={dealBreakers.draft}
              placeholder={'e.g. Fully on-site\nBelow GBP 70k'}
              onChange={(event) => dealBreakers.setDraft(event.currentTarget.value)}
              onBlur={dealBreakers.flush}
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor="profile-target-sectors" className={LABEL}>
              Target sectors
            </label>
            <textarea
              id="profile-target-sectors"
              data-testid="profile-target-sectors"
              rows={3}
              value={targetSectors.draft}
              placeholder={'e.g. Banking\nHedge funds'}
              onChange={(event) => targetSectors.setDraft(event.currentTarget.value)}
              onBlur={targetSectors.flush}
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor="profile-career-goals" className={LABEL}>
              Career goals
            </label>
            <textarea
              id="profile-career-goals"
              data-testid="profile-career-goals"
              rows={3}
              value={careerGoals.draft}
              placeholder="e.g. Lead a small modelling team within three years"
              onChange={(event) => careerGoals.setDraft(event.currentTarget.value)}
              onBlur={careerGoals.flush}
              className={FIELD}
            />
          </div>
        </div>
      </section>

      <section data-testid="profile-energy" className={cardClasses()}>
        <SectionHeading title="What energises you, what drains you" />
        <p className="mt-1 text-ink-muted">
          One per line. Honest answers here keep you out of jobs you would hate.
        </p>

        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="profile-energising" className={LABEL}>
              Energising
            </label>
            <textarea
              id="profile-energising"
              data-testid="profile-energising"
              rows={4}
              value={energising.draft}
              placeholder="e.g. Hard technical problems"
              onChange={(event) => energising.setDraft(event.currentTarget.value)}
              onBlur={energising.flush}
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor="profile-draining" className={LABEL}>
              Draining
            </label>
            <textarea
              id="profile-draining"
              data-testid="profile-draining"
              rows={4}
              value={draining.draft}
              placeholder="e.g. Status meetings"
              onChange={(event) => draining.setDraft(event.currentTarget.value)}
              onBlur={draining.flush}
              className={FIELD}
            />
          </div>
        </div>
      </section>

      <section data-testid="profile-star" className={cardClasses()}>
        <SectionHeading title="STAR examples" />
        <p className="mt-1 text-ink-muted">
          Worked examples in the shape interviewers ask for them: the situation, the task, what you
          did, and what came of it.
        </p>

        {starKeys.length === 0 ? (
          <p data-testid="profile-star-empty" className="mt-2 text-xs text-ink-faint">
            None added yet.
          </p>
        ) : null}

        <ul className="mt-3 space-y-3">
          {starKeys.map((key, index) => {
            const example = profile.star_examples[index];
            if (example === undefined) return null;
            return (
              <StarCard
                key={key}
                index={index}
                example={example}
                onChange={(patch) => onStarChange(key, patch)}
                onRemove={() => onRemoveStar(key)}
              />
            );
          })}
        </ul>

        <button
          type="button"
          data-testid="profile-star-add"
          onClick={onAddStar}
          className={`mt-3 ${SECONDARY_BUTTON}`}
        >
          Add an example
        </button>
      </section>
    </div>
  );
}

// --- Rows -------------------------------------------------------------------

interface LanguageRowProps {
  readonly index: number;
  readonly language: ProfileLanguage;
  readonly onChange: (patch: Partial<ProfileLanguage>) => void;
  readonly onRemove: () => void;
}

function LanguageRow({ index, language, onChange, onRemove }: LanguageRowProps) {
  const name = useDebouncedField(
    language.name,
    (value) => onChange({ name: value }),
    AUTOSAVE_DELAY_MS,
  );
  const level = useDebouncedField(
    language.level,
    (value) => onChange({ level: value }),
    AUTOSAVE_DELAY_MS,
  );

  return (
    <li data-testid={`profile-language-${index}`} className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1">
        <label htmlFor={`profile-language-name-${index}`} className={LABEL}>
          Language
        </label>
        <input
          id={`profile-language-name-${index}`}
          data-testid={`profile-language-name-${index}`}
          value={name.draft}
          placeholder="e.g. French"
          onChange={(event) => name.setDraft(event.currentTarget.value)}
          onBlur={name.flush}
          className={FIELD}
        />
      </div>
      <div className="min-w-0 flex-1">
        <label htmlFor={`profile-language-level-${index}`} className={LABEL}>
          Level
        </label>
        <input
          id={`profile-language-level-${index}`}
          data-testid={`profile-language-level-${index}`}
          value={level.draft}
          placeholder="e.g. Conversational"
          onChange={(event) => level.setDraft(event.currentTarget.value)}
          onBlur={level.flush}
          className={FIELD}
        />
      </div>
      <button
        type="button"
        data-testid={`profile-language-remove-${index}`}
        onClick={onRemove}
        className={QUIET_BUTTON}
      >
        Remove
      </button>
    </li>
  );
}

interface StarCardProps {
  readonly index: number;
  readonly example: StarExample;
  readonly onChange: (patch: Partial<StarExample>) => void;
  readonly onRemove: () => void;
}

/** The five parts, in the order they are told. */
const STAR_PARTS: ReadonlyArray<{
  readonly key: keyof StarExample;
  readonly label: string;
  readonly rows: number;
}> = [
  { key: 'title', label: 'Title', rows: 1 },
  { key: 'situation', label: 'Situation', rows: 2 },
  { key: 'task', label: 'Task', rows: 2 },
  { key: 'action', label: 'Action', rows: 3 },
  { key: 'result', label: 'Result', rows: 2 },
];

function StarCard({ index, example, onChange, onRemove }: StarCardProps) {
  return (
    <li
      data-testid={`profile-star-${index}`}
      className="rounded-card border border-line bg-canvas p-4"
    >
      <div className="space-y-3">
        {STAR_PARTS.map((part) => (
          <StarField
            key={part.key}
            index={index}
            part={part.key}
            label={part.label}
            rows={part.rows}
            value={example[part.key]}
            onCommit={(value) => onChange({ [part.key]: value })}
          />
        ))}
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <button
          type="button"
          data-testid={`profile-star-remove-${index}`}
          onClick={onRemove}
          className={QUIET_BUTTON}
        >
          Remove this example
        </button>
      </div>
    </li>
  );
}

interface StarFieldProps {
  readonly index: number;
  readonly part: keyof StarExample;
  readonly label: string;
  readonly rows: number;
  readonly value: string;
  readonly onCommit: (value: string) => void;
}

function StarField({ index, part, label, rows, value, onCommit }: StarFieldProps) {
  const field = useDebouncedField(value, onCommit, AUTOSAVE_DELAY_MS);
  const id = `profile-star-${part}-${index}`;

  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <textarea
        id={id}
        data-testid={id}
        rows={rows}
        value={field.draft}
        onChange={(event) => field.setDraft(event.currentTarget.value)}
        onBlur={field.flush}
        className={FIELD}
      />
    </div>
  );
}
