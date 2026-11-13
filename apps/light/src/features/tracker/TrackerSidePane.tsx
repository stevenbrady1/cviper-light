import { type RefObject } from 'react';

import {
  ok,
  type ApplicationStatus,
  type InterviewSubstage,
  type Result,
} from '@cviper/core-types';

import { type ChatTransport } from '@cviper/ai-providers';

import { SECONDARY_BUTTON } from '../../app/buttons';
import { DetailPane } from '../../app/DetailPane';
import { LiveStatus } from '../../app/LiveStatus';
import { type BrowserPort } from '../../platform/browser';

import { type ConsentPort } from '../analysis/consent';
import { type Availability } from '../analysis/providers';

import { ApplicationDetail } from './ApplicationDetail';
import { addSubstage, moveSubstage, removeSubstage, renameSubstage } from './interviewSubstages';
import { NewApplicationForm } from './NewApplicationForm';
import { type PageFetchTransport } from './pageFetch';
import { PasteJobForm } from './PasteJobForm';
import { SubstageEditor } from './SubstageEditor';
import { type ApplicationDraft, type TrackerEntry, type withEdit } from './model';
import { type TrackerPort } from './port';

/**
 * What the side pane is showing.
 *
 * `new` carries an optional starting draft and an optional notice, which is how
 * the paste flow hands its result over: on success the draft is the extraction,
 * on failure it is a blank form still holding everything the user pasted, and
 * the notice explains which happened. ONE destination for both outcomes, so
 * there is no failure path that leads somewhere nobody thought about.
 */
export type Pane =
  | { kind: 'closed' }
  | { kind: 'new'; initial?: ApplicationDraft; notice?: string; fromPaste?: true }
  | { kind: 'paste' }
  | { kind: 'substages' }
  | { kind: 'entry'; applicationId: string };

/**
 * The pane beside or over the board: paste a job, the interview-stage editor, a new
 * application, or the card that is open. Every value and handler belongs to
 * `Tracker`, which passes them down.
 */
export interface TrackerSidePaneProps {
  /** Float over the board on a desktop instead of sitting beside it (L-401). */
  readonly over: boolean;
  readonly pane: Pane;
  readonly setPane: (pane: Pane) => void;
  readonly onOpenSettings: (() => void) | undefined;
  readonly createTransport: (() => ChatTransport) | undefined;
  readonly createPageTransport: (() => PageFetchTransport) | undefined;
  readonly readAvailability: (() => Promise<Availability>) | undefined;
  readonly consentPort: ConsentPort | undefined;
  readonly substagesLoaded: boolean;
  readonly loadSubstages: () => Promise<void>;
  readonly substages: readonly InterviewSubstage[];
  readonly savingSubstages: boolean;
  readonly entries: readonly TrackerEntry[];
  readonly applySubstages: (
    change: Result<InterviewSubstage[], string>,
    removedId?: string | null,
  ) => Promise<string | null>;
  readonly substagesRef: RefObject<readonly InterviewSubstage[]>;
  readonly onCreate: (draft: ApplicationDraft) => Promise<void>;
  readonly selected: TrackerEntry | null;
  readonly today: string;
  readonly clock: Date;
  readonly browserPort: BrowserPort;
  readonly onEdit: (applicationId: string, changes: Parameters<typeof withEdit>[1]) => void;
  readonly onStatusChange: (applicationId: string, status: ApplicationStatus) => void;
  readonly onSubstageChange: (applicationId: string, substageId: string | null) => void;
  readonly openSubstageEditor: (trigger: HTMLElement | null) => void;
  readonly substagesFailed: string | null;
  readonly onDelete: (entry: TrackerEntry) => Promise<void>;
  readonly trackerPort: TrackerPort;
  readonly availability: Availability | null;
  readonly onAnalyse: ((entry: TrackerEntry) => void) | undefined;
  readonly onTailor: ((entry: TrackerEntry) => void) | undefined;
}

export function TrackerSidePane({
  over,
  pane,
  setPane,
  onOpenSettings,
  createTransport,
  createPageTransport,
  readAvailability,
  consentPort,
  substagesLoaded,
  loadSubstages,
  substages,
  savingSubstages,
  entries,
  applySubstages,
  substagesRef,
  onCreate,
  selected,
  today,
  clock,
  browserPort,
  onEdit,
  onStatusChange,
  onSubstageChange,
  openSubstageEditor,
  substagesFailed,
  onDelete,
  trackerPort,
  availability,
  onAnalyse,
  onTailor,
}: TrackerSidePaneProps) {
  return pane.kind === 'paste' ? (
    <DetailPane
      over={over}
      title="Paste a job"
      subtitle="An AI reads the advert. You check every field before it is saved."
      onClose={() => setPane({ kind: 'closed' })}
    >
      <PasteJobForm
        onExtracted={(initial, notice) =>
          setPane({
            kind: 'new',
            initial,
            fromPaste: true,
            // `exactOptionalPropertyTypes` is on: an absent notice and a
            // notice that is `undefined` are different types.
            ...(notice === null ? {} : { notice }),
          })
        }
        onCancel={() => setPane({ kind: 'closed' })}
        onOpenSettings={onOpenSettings}
        createTransport={createTransport}
        createPageTransport={createPageTransport}
        readAvailability={readAvailability}
        consentPort={consentPort}
      />
    </DetailPane>
  ) : pane.kind === 'substages' ? (
    <DetailPane
      over={over}
      title="Interview stages"
      subtitle="Your own stages inside Interviewing, such as HR Screen or Final."
      onClose={() => setPane({ kind: 'closed' })}
    >
      {!substagesLoaded ? (
        <div data-testid="substage-blocked" className="space-y-3 text-ink-muted">
          <p>
            Your interview stages need to load again before you can edit them, so nothing you change
            here can overwrite what is saved.
          </p>
          <button type="button" className={SECONDARY_BUTTON} onClick={() => void loadSubstages()}>
            Retry
          </button>
        </div>
      ) : (
        <SubstageEditor
          substages={substages}
          busy={savingSubstages}
          usage={(id) =>
            entries.filter((entry) => entry.application.interview_substage_id === id).length
          }
          onAdd={(name) =>
            applySubstages(addSubstage(substagesRef.current, name, crypto.randomUUID()))
          }
          onRename={(id, name) => applySubstages(renameSubstage(substagesRef.current, id, name))}
          onMove={(id, direction) =>
            applySubstages(ok(moveSubstage(substagesRef.current, id, direction)))
          }
          onRemove={(id) => applySubstages(ok(removeSubstage(substagesRef.current, id)), id)}
        />
      )}
    </DetailPane>
  ) : pane.kind === 'new' ? (
    <DetailPane
      over={over}
      title={pane.fromPaste === true ? 'Check the details' : 'New application'}
      subtitle={
        pane.fromPaste === true
          ? 'Nothing has been saved yet. Correct anything that is wrong, then save.'
          : 'Anything you have applied to, typed in by hand.'
      }
      onClose={() => setPane({ kind: 'closed' })}
    >
      <LiveStatus
        text={
          pane.notice === undefined
            ? null
            : `${pane.notice} Your paste is in the description below.`
        }
      />
      {pane.notice === undefined ? null : (
        <p
          data-testid="tracker-extract-notice"
          className="mb-3 rounded-control bg-sunken px-3 py-2 text-ink-muted"
        >
          {pane.notice} Your paste is in the description below.
        </p>
      )}
      {/*
        Keyed so a second paste replaces the boxes instead of leaving the
        first extraction's values sitting in a form the user thinks is new.
        `initial` is read once, as initial state, by design.
      */}
      <NewApplicationForm
        key={pane.initial === undefined ? 'blank' : pane.initial.description}
        initial={pane.initial}
        onCreate={(draft) => void onCreate(draft)}
        onCancel={() => setPane({ kind: 'closed' })}
      />
    </DetailPane>
  ) : selected === null ? null : (
    <DetailPane
      over={over}
      title={selected.job.title}
      subtitle={[selected.job.company, selected.job.location]
        .filter((part) => part !== null && part !== '')
        .join(' · ')}
      onClose={() => setPane({ kind: 'closed' })}
    >
      {/*
        Keyed by the application id so every field resets when the
        selection changes. Without it, a debounced note from the last card
        could land on this one.
      */}
      <ApplicationDetail
        key={selected.application.id}
        entry={selected}
        today={today}
        now={clock}
        browser={browserPort}
        onEdit={(changes) => onEdit(selected.application.id, changes)}
        onStatusChange={(status) => onStatusChange(selected.application.id, status)}
        substages={substages}
        onSubstageChange={
          substagesLoaded
            ? (substageId) => onSubstageChange(selected.application.id, substageId)
            : undefined
        }
        onEditSubstages={substagesLoaded ? openSubstageEditor : undefined}
        substagesFailed={substagesFailed !== null}
        onRetrySubstages={() => void loadSubstages()}
        onDelete={() => void onDelete(selected)}
        port={trackerPort}
        availability={availability ?? undefined}
        readAvailability={readAvailability}
        createTransport={createTransport}
        consentPort={consentPort}
        onAnalyse={onAnalyse === undefined ? undefined : () => onAnalyse(selected)}
        onTailor={onTailor === undefined ? undefined : () => onTailor(selected)}
      />
    </DetailPane>
  );
}
