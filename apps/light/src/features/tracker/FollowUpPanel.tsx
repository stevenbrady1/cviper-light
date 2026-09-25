import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  type ChatTransport,
  type FollowUpKind,
  type FollowUpMaterials,
} from '@cviper/ai-providers';
import { type Application, type Document, type IsoDate } from '@cviper/core-types';

import { SECONDARY_BUTTON } from '../../app/buttons';

import { readAvailability as readRealAvailability } from '../analysis/availability';
import { ConsentGate } from '../analysis/ConsentGate';
import {
  createTauriConsentPort,
  isCloudKind,
  type ConsentPort,
  type ConsentProviderKind,
} from '../analysis/consent';
import { optionByKey, type Availability, type ProviderOption } from '../analysis/providers';

import { extractionOptions } from './extraction';
import {
  describeFollowUpState,
  followUpState,
  quietDays,
  thankYouOffered,
  withFollowUpLogged,
  withThankYouLogged,
} from './followUp';
import { type TrackerEntry } from './model';
import { type TrackerPort } from './port';
import { runFollowUp } from './runFollowUp';

/**
 * Follow-up and thank-you DRAFTS, in the detail pane (L-162).
 *
 * ============================================================================
 * THIS PANEL NEVER SENDS ANYTHING. IT HAS NO ADDRESS AND NO MAIL CLIENT.
 * ============================================================================
 * A draft is a subject box and a body box. "Copy" puts their text on the
 * clipboard; "Mark as sent" is the user telling the tracker what THEY did in
 * whatever they send from. There is no other button, and
 * `followUp.noSend.contract.test.ts` reads this file's shipped text to keep it
 * that way.
 *
 * ============================================================================
 * THE SENTENCE COMES FIRST, THE BUTTON SECOND
 * ============================================================================
 * The line under "Follow-up" is the feature. It says, per application, the one
 * thing a board of forty cards cannot: whether silence has gone on long enough
 * to be worth a line, or whether the honest next step is a different column.
 * The button is only enabled when that sentence says "worth a nudge" — a
 * follow-up sent on day three is the thing this panel exists to talk people
 * out of. See `followUp.ts` for the rules.
 *
 * ============================================================================
 * THE THANK-YOU IS OFFERED ONCE, ON THE MOVE INTO INTERVIEWING
 * ============================================================================
 * Not a permanent button: a thank-you note is a same-day thing, and a control
 * that sits there for a month is a control the user learns to ignore. The
 * offer appears when the status select moves INTO interviewing and goes away
 * when it moves out. No quiet rule and no cap — it is not a nudge.
 *
 * ============================================================================
 * MATERIALS, AND THE ONE RULE THE PROMPT ENFORCES
 * ============================================================================
 * The advert, the CV and the cover letter archived against this application
 * are what the model may write from — nothing else — with `job.description`
 * standing in for the advert when none was archived. A follow-up that invents
 * a certification is worse than none; the prompt says so, and the boxes are
 * editable because the user is the last reader before anything goes anywhere.
 *
 * ============================================================================
 * THE PANEL ASKS FOR CONSENT ITSELF (L-171)
 * ============================================================================
 * `runFollowUp` refuses a cloud draft until the per-provider consent exists.
 * Until L-171 the only place that consent could be GIVEN was the Analysis
 * screen — the same dead end L-141 closed for paste-a-job. So this panel
 * raises the SAME `ConsentGate`, recorded in the SAME store, read at PRESS
 * time (a consent withdrawn elsewhere while this card was open is honoured
 * here), and drafts the note that was pending the moment the user says yes.
 * `runFollowUp` keeps its own gate underneath regardless.
 *
 * ============================================================================
 * THE PICKER IS `PasteJobForm`'s, FOR THE SAME REASON
 * ============================================================================
 * `extractionOptions` — every configured option minus the keyword match, which
 * cannot write prose — probed the same way, defaulted the same way (local
 * first), and only shown as a select when there is a choice to make.
 */

/** Why the buttons will not go when no model is configured. */
export const NO_AI_NOTE = 'Needs a local model or your own key.';

export const THANK_YOU_OFFER = 'Want a short thank-you note for the interviewer?';

/** The document kinds that count as materials, and the field each one fills. */
const MATERIAL_KINDS: ReadonlyArray<readonly [Document['kind'], keyof FollowUpMaterials]> = [
  ['advert', 'advert'],
  ['cv', 'cv'],
  ['cover_letter', 'coverLetter'],
];

/** The newest document of each material kind, whichever order they arrived in. */
export function materialsFrom(
  documents: readonly Document[],
  advertFallback: string | null,
): FollowUpMaterials {
  const materials: { -readonly [K in keyof FollowUpMaterials]: FollowUpMaterials[K] } = {
    advert: null,
    cv: null,
    coverLetter: null,
  };
  const newest = new Map<Document['kind'], Document>();
  for (const document of documents) {
    const current = newest.get(document.kind);
    if (current === undefined || document.created_at > current.created_at) {
      newest.set(document.kind, document);
    }
  }
  for (const [kind, field] of MATERIAL_KINDS) {
    materials[field] = newest.get(kind)?.text ?? null;
  }
  if (materials.advert === null) materials.advert = advertFallback;
  return materials;
}

export interface FollowUpPanelProps {
  readonly entry: TrackerEntry;
  readonly today: IsoDate;
  readonly port: TrackerPort;
  /** Injected by tests so the machine's real credentials are never consulted. */
  readonly readAvailability?: (() => Promise<Availability>) | undefined;
  /** Injected by tests so a fake provider can answer without a socket. */
  readonly createTransport?: (() => ChatTransport) | undefined;
  /**
   * Injected by tests. Defaults to the real `tauri-plugin-store`-backed port —
   * the one store every consent screen in the app shares (L-171).
   */
  readonly consentPort?: ConsentPort | undefined;
  readonly onEdit: (changes: Partial<Pick<Application, 'notes'>>) => void;
}

interface Draft {
  readonly kind: FollowUpKind;
  readonly subject: string;
  readonly body: string;
}

const TITLES: Readonly<Record<FollowUpKind, string>> = {
  follow_up: 'Follow-up',
  thank_you: 'Thank-you',
};

export function FollowUpPanel({
  entry,
  today,
  port,
  readAvailability,
  createTransport,
  consentPort,
  onEdit,
}: FollowUpPanelProps) {
  const { application, job } = entry;
  const probe = useMemo(() => readAvailability ?? readRealAvailability, [readAvailability]);
  const consentStore = useMemo(() => consentPort ?? createTauriConsentPort(), [consentPort]);

  const [options, setOptions] = useState<readonly ProviderOption[]>([]);
  const [probed, setProbed] = useState(false);
  const [optionKey, setOptionKey] = useState<string | null>(null);
  const [running, setRunning] = useState<FollowUpKind | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** The cloud draft waiting on the user's answer in the dialog, or `null`. */
  const [pendingConsent, setPendingConsent] = useState<{
    readonly kind: FollowUpKind;
    readonly option: ProviderOption;
    readonly consentKind: ConsentProviderKind;
  } | null>(null);

  /*
   * The thank-you offer, derived from a status TRANSITION rather than a
   * status. `seenStatus` is the last status this panel rendered; when the
   * prop moves away from it the move is classified once, during render, and
   * the offer set accordingly — the React-documented way to derive state from
   * a changing prop without an effect that runs a render late.
   */
  const [seenStatus, setSeenStatus] = useState(application.status);
  const [offer, setOffer] = useState(false);
  if (seenStatus !== application.status) {
    setSeenStatus(application.status);
    setOffer(thankYouOffered(seenStatus, application.status));
  }

  useEffect(() => {
    let cancelled = false;

    void probe().then((availability) => {
      if (cancelled) return;
      const usable = extractionOptions(availability);
      setOptions(usable);
      setOptionKey(usable[0]?.key ?? null);
      setProbed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [probe]);

  const selected = optionKey === null ? null : optionByKey(options, optionKey);
  const state = followUpState(entry, today);
  const sentence = describeFollowUpState(entry, today);
  const nothingConfigured = probed && options.length === 0;

  /**
   * The check `runFollowUp` makes underneath, reading the SAME port this
   * panel asks through, so the dialog's answer and the run module's gate can
   * never be looking at two different stores. Fails closed, as everywhere.
   */
  const hasConsent = useCallback(
    (kind: ConsentProviderKind) => consentStore.read().then((read) => read.ok && read.value[kind]),
    [consentStore],
  );

  /** The draft itself, once nothing stands in its way. */
  const perform = useCallback(
    async (kind: FollowUpKind, option: ProviderOption) => {
      setError(null);
      setNote(null);
      setRunning(kind);

      // Materials first, so a locked database is reported as what it is and
      // never as "the model failed".
      const documents = await port.documentsFor(application.id);
      if (!documents.ok) {
        setRunning(null);
        setError(`Your archived documents could not be read: ${documents.error.message}`);
        return;
      }
      const profile = await port.profile();
      if (!profile.ok) {
        setRunning(null);
        setError(`Your profile could not be read: ${profile.error.message}`);
        return;
      }

      const outcome = await runFollowUp(
        {
          option,
          kind,
          jobTitle: job.title,
          company: job.company,
          daysQuiet: kind === 'follow_up' ? quietDays(entry, today) : null,
          materials: materialsFrom(documents.value, job.description),
          writingStyle: profile.value?.writing_style ?? null,
        },
        createTransport,
        hasConsent,
      );
      setRunning(null);

      if (!outcome.available) {
        setError(outcome.reason);
        return;
      }
      setDraft({ kind, subject: outcome.draft.subject, body: outcome.draft.body });
    },
    [application.id, createTransport, entry, hasConsent, job, port, today],
  );

  const run = useCallback(
    async (kind: FollowUpKind) => {
      if (selected === null) return;

      // The consent gate (Apple 5.1.2(i)), asked HERE (L-171). Read fresh
      // from the store on every press, never from a snapshot.
      if (isCloudKind(selected.kind) && !(await hasConsent(selected.kind))) {
        setPendingConsent({ kind, option: selected, consentKind: selected.kind });
        return;
      }

      await perform(kind, selected);
    },
    [hasConsent, perform, selected],
  );

  /**
   * The user said yes in the dialog: record it, then draft what was waiting.
   * Recorded FIRST, so `runFollowUp`'s own gate agrees with the answer.
   */
  const onConsentAccept = useCallback(async () => {
    const pending = pendingConsent;
    setPendingConsent(null);
    if (pending === null) return;

    const granted = await consentStore.grant(pending.consentKind);
    if (!granted.ok) {
      // Said on screen and nothing drafted: a consent that was not recorded
      // is a consent the app does not have.
      setError(granted.error.message);
      return;
    }
    await perform(pending.kind, pending.option);
  }, [consentStore, pendingConsent, perform]);

  /** "Not now": nothing recorded, nothing drafted, the button live again. */
  const onConsentDecline = useCallback(() => setPendingConsent(null), []);

  const onCopy = useCallback(async () => {
    if (draft === null) return;
    const text = `${draft.subject}\n\n${draft.body}`;
    // Guarded: the clipboard is absent in some webviews and refused in others,
    // and neither is a reason for the text to be unreachable — it is in two
    // boxes the user can select.
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (clipboard === undefined) {
      setNote('Copy is not available here. Select the text and copy it.');
      return;
    }
    try {
      await clipboard.writeText(text);
      setNote('Copied.');
    } catch {
      setNote('That could not be copied. Select the text and copy it.');
    }
  }, [draft]);

  const onMarkSent = useCallback(async () => {
    if (draft === null) return;

    setError(null);
    const stamp = new Date().toISOString();
    const document: Document = {
      id: crypto.randomUUID(),
      application_id: application.id,
      // Both kinds archive as `follow_up`: the closed set of document kinds is
      // a schema decision (`entities.ts`), and the title says which this was.
      kind: 'follow_up',
      title: `${TITLES[draft.kind]} — ${today}`,
      text: `${draft.subject}\n\n${draft.body}`,
      created_at: stamp,
    };

    // The archive first, then the note. If the archive fails nothing changes,
    // and the user is not told a follow-up was recorded that nowhere remembers.
    const saved = await port.saveDocument(document);
    if (!saved.ok) {
      setError(`That could not be archived: ${saved.error.message} Try again.`);
      return;
    }

    const logged =
      draft.kind === 'follow_up'
        ? withFollowUpLogged(application, today, stamp)
        : withThankYouLogged(application, today, stamp);
    onEdit({ notes: logged.notes });

    setDraft(null);
    setNote(null);
    setOffer(false);
  }, [application, draft, onEdit, port, today]);

  const busy = running !== null;
  const canDraftFollowUp = state === 'due' && selected !== null && !busy && draft === null;
  const canDraftThankYou = offer && selected !== null && !busy && draft === null;

  return (
    <div data-testid="detail-followup" className="space-y-2 border-t border-line pt-3">
      <p className="block text-xs font-medium text-ink-muted">Follow-up</p>

      <p data-testid="detail-followup-state" data-state={state} className="text-ink-muted">
        {sentence}
      </p>

      {offer ? (
        <p
          data-testid="detail-thankyou-offer"
          role="status"
          className="rounded-control bg-sunken px-3 py-2 text-ink-muted"
        >
          {THANK_YOU_OFFER}
        </p>
      ) : null}

      {/*
        The picker only appears when there is a choice to make — the same rule
        as the paste form, for the same reason.
      */}
      {options.length > 1 ? (
        <div>
          <label
            htmlFor="detail-followup-provider"
            className="block text-xs font-medium text-ink-muted"
          >
            Draft it with
          </label>
          <select
            id="detail-followup-provider"
            data-testid="detail-followup-provider"
            value={optionKey ?? ''}
            disabled={busy}
            onChange={(event) => {
              // Read the value NOW — React nulls `currentTarget` the moment
              // this handler returns.
              const key = event.currentTarget.value;
              setOptionKey(key);
            }}
            className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
          >
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="detail-followup-draft"
          disabled={!canDraftFollowUp}
          onClick={() => void run('follow_up')}
          className={SECONDARY_BUTTON}
        >
          {running === 'follow_up' ? 'Drafting…' : 'Draft a follow-up'}
        </button>

        {offer ? (
          <button
            type="button"
            data-testid="detail-thankyou-draft"
            disabled={!canDraftThankYou}
            onClick={() => void run('thank_you')}
            className={SECONDARY_BUTTON}
          >
            {running === 'thank_you' ? 'Drafting…' : 'Draft a thank-you'}
          </button>
        ) : null}
      </div>

      {/*
        Why the button will not go. The state sentence above already covers
        "not due"; this line is for the one reason that sentence cannot say.
      */}
      {nothingConfigured && !busy ? (
        <p data-testid="detail-followup-reason" className="text-xs text-ink-faint">
          {NO_AI_NOTE}
        </p>
      ) : null}

      {busy && selected !== null ? (
        <p
          data-testid="detail-followup-progress"
          role="status"
          className="rounded-control bg-sunken px-3 py-2 text-ink-muted"
        >
          {selected.local
            ? `Drafting with ${selected.model} on this machine. Nothing is being sent anywhere.`
            : `Drafting with ${selected.label}. This usually takes a few seconds.`}
        </p>
      ) : null}

      {error === null ? null : (
        <p
          role="alert"
          data-testid="detail-followup-error"
          className="rounded-control bg-danger/5 px-3 py-2 text-danger"
        >
          {error}
        </p>
      )}

      {draft === null ? null : (
        <div data-testid="detail-followup-editor" className="space-y-2">
          <div>
            <label
              htmlFor="detail-followup-subject"
              className="block text-xs font-medium text-ink-muted"
            >
              Subject
            </label>
            <input
              id="detail-followup-subject"
              data-testid="detail-followup-subject"
              value={draft.subject}
              onChange={(event) => {
                const subject = event.currentTarget.value;
                setDraft((current) => (current === null ? null : { ...current, subject }));
              }}
              className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
            />
          </div>
          <div>
            <label
              htmlFor="detail-followup-body"
              className="block text-xs font-medium text-ink-muted"
            >
              Body
            </label>
            <textarea
              id="detail-followup-body"
              data-testid="detail-followup-body"
              rows={8}
              value={draft.body}
              onChange={(event) => {
                const body = event.currentTarget.value;
                setDraft((current) => (current === null ? null : { ...current, body }));
              }}
              className="mt-1 w-full rounded-control border border-line bg-card px-2.5 py-1.5 text-ink"
            />
            <p className="mt-1 text-xs text-ink-faint">
              Written from your archived documents only. Read it before it goes anywhere.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="detail-followup-copy"
              onClick={() => void onCopy()}
              className={SECONDARY_BUTTON}
            >
              Copy
            </button>
            <button
              type="button"
              data-testid="detail-followup-sent"
              onClick={() => void onMarkSent()}
              className={SECONDARY_BUTTON}
            >
              Mark as sent
            </button>
            <button
              type="button"
              data-testid="detail-followup-discard"
              onClick={() => {
                setDraft(null);
                setNote(null);
              }}
              className="rounded-control px-3 py-1.5 text-ink-muted hover:bg-sunken hover:text-ink"
            >
              Discard
            </button>
          </div>
          {note === null ? null : (
            <p data-testid="detail-followup-note" role="status" className="text-xs text-ink-faint">
              {note}
            </p>
          )}
        </div>
      )}

      {/*
        The same dialog, from the same file, as every other consent screen
        (L-171). One consent, one store, one wording — see `ConsentGate.tsx`.
      */}
      {pendingConsent === null ? null : (
        <ConsentGate
          kind={pendingConsent.consentKind}
          onAccept={() => void onConsentAccept()}
          onDecline={onConsentDecline}
        />
      )}
    </div>
  );
}
