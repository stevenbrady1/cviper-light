// @vitest-environment jsdom
/**
 * The first-run screen discloses the request the app makes before the user has
 * pressed anything (L-108).
 *
 * ============================================================================
 * THE DEFECT THIS PINS
 * ============================================================================
 * `App.tsx` runs the update check in a mount effect, and `launchCheck.ts`
 * resolves an unconfigured machine to ON. So on a brand-new install the app
 * asks `github.com` for a version number while the welcome screen is still the
 * only thing the user has read — and that screen said
 *
 *     "Your data stays on this computer. There is no account and nothing to
 *      sign up for."
 *
 * and stopped. Every word of that is true and none of it is the whole story.
 * The disclosure existed only in Settings → Privacy, which is a screen a
 * first-run user has not opened yet, so the first request to GitHub happened
 * before anything told them it would.
 *
 * The fix is the disclosure, not the default: a direct-download build has no
 * store behind it, so the launch check is how a security fix ever reaches
 * anybody (`launchCheck.ts` sets out the whole argument). What had to change is
 * that the screen says so.
 *
 * ============================================================================
 * KEYED ON THE REGISTRY AND ON THE LIVE DEFAULT, NOT ON A BLESSED SENTENCE
 * ============================================================================
 * The cheap version of this guard is
 * `expect(copy).toContain('<today's exact wording>')`. That is not a contract,
 * it is a copy of the copy: it goes red the day somebody improves the sentence
 * and green the day somebody rewrites it into something worse.
 *
 * So the rule is a relationship, in the shape `unconfigurableKeyClaims`
 * (L-105) established:
 *
 *   * The GATE is `updateCheckOnLaunchEnabled()` on a machine with nothing
 *     stored — the real function the real mount effect calls. While that is
 *     true, the first-run screen owes the reader a disclosure. Turn the default
 *     off one day and this guard stands down on its own rather than having to
 *     be deleted by hand.
 *   * The SUBJECT is the `github.com` row of `lib/outbound-hosts.ts` — the same
 *     registry the privacy notice and the generated policy are built from. The
 *     host the copy must name is read off that row, so renaming the row changes
 *     what the screen has to say instead of quietly excusing it.
 *   * The FACTS are the ones the issue asked for, each matched by shape rather
 *     than by wording: who is asked, when, what is asked for, what it carries,
 *     and where it is switched off.
 *
 * `the verdict follows the registry and the default` below proves both halves
 * of the flip on the SAME copy, so it is a property of the guard rather than
 * something a later reader has to take on trust.
 *
 * ============================================================================
 * IT READS THE RENDERED SCREEN, NOT THE MODULE BEHIND IT
 * ============================================================================
 * `render(<Welcome />)` and then `textContent`, deliberately. A unit test over
 * an exported string cannot see copy that stopped being rendered, and the
 * promise here is about what a user reads on their first launch. The whole
 * section is read rather than one `data-testid`, so moving the sentence around
 * the screen is free; `disclosurePassage` then narrows it to the copy that is
 * actually about the update check.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OUTBOUND_HOSTS, type OutboundHost } from '../../lib/outbound-hosts';
import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type Availability } from '../analysis/providers';
import { updateCheckOnLaunchEnabled } from '../settings/updates/launchCheck';

import { Welcome } from './Welcome';

/** The registered host the launch check reads its version number from. */
const UPDATE_HOST = 'github.com';

/** The default machine: no local model, no key, nothing configured. */
const NOTHING: Availability = {
  ollamaRunning: false,
  ollamaModels: [],
  anthropicKey: false,
  openaiKey: false,
};

/**
 * The word a reader would use for a registered host: `github.com` → `github`.
 *
 * Derived rather than written down, so the required word follows the registry.
 * A row renamed to somewhere else changes what the screen has to name, and the
 * guard says so instead of passing on a sentence that has gone false.
 */
export function readableHostName(host: string): string {
  return host.split('.')[0] ?? host;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface RequiredFact {
  /** Named as the gap it describes, because that is what a failure prints. */
  readonly id: string;
  readonly needs: RegExp;
}

/**
 * What a first-run reader has to be told, matched by shape.
 *
 * Each entry is a family of wordings rather than one sentence. Rewriting the
 * paragraph is free; dropping one of the four facts is not.
 */
const REQUIRED_FACTS: readonly RequiredFact[] = [
  {
    // Deliberately NOT `open`. "You can open this again from Settings" is
    // already on this screen and has nothing to do with the update check.
    id: 'does not say WHEN it happens (when the app starts)',
    needs: /\b(start|starts|starting|startup|launch|launches)\b/i,
  },
  {
    id: 'does not say WHAT is asked for (a version number)',
    needs: /version number/i,
  },
  {
    id: 'does not say it carries nothing about the user',
    needs: /(nothing|no data|no information)[^.]*about you\b/i,
  },
  {
    id: 'does not say Settings can switch it off',
    needs: /settings[^.]*\boff\b|\boff\b[^.]*settings/i,
  },
];

/**
 * The part of the screen that is ABOUT the update check.
 *
 * ============================================================================
 * WHY THE FACTS ARE NOT LOOKED FOR IN THE WHOLE SCREEN
 * ============================================================================
 * Scanning the whole `textContent` was the first version of this, and it was
 * wrong in a way that only showed up when it was run against the copy that
 * shipped the defect: the welcome screen ALREADY says "you can start without
 * one" and "You can open this again from Settings". Two of the four facts came
 * back satisfied by sentences that have nothing to do with GitHub, on a screen
 * that disclosed nothing at all.
 *
 * So the facts are looked for in the passage that names the host: the sentence
 * that mentions it, plus the one after it, because a disclosure reads forwards
 * — you name the thing, then say what it carries and where to switch it off.
 * Copy that names no host has an empty passage and therefore owes every fact,
 * which is exactly the verdict the old screen deserved.
 */
export function disclosurePassage(copy: string, host: string): string {
  const named = new RegExp(`\\b${escapeRegExp(readableHostName(host))}\\b`, 'i');
  // Zero-width split, because `textContent` runs adjacent elements together
  // with no space between them: "…without one.When CViper Light starts…".
  const parts = copy.split(/(?<=[.!?])\s*/);

  const wanted = new Set<number>();
  parts.forEach((part, index) => {
    if (!named.test(part)) return;
    wanted.add(index);
    wanted.add(index + 1);
  });

  return parts.filter((_, index) => wanted.has(index)).join(' ');
}

/**
 * Every fact the first-run copy owes the reader and does not give them.
 *
 * Pure, and takes the registry and the default as arguments, so the verdict can
 * be asked on planted inputs. That is what makes the stand-down testable rather
 * than hypothetical.
 */
export function launchCheckDisclosureGaps(
  copy: string,
  hosts: readonly OutboundHost[],
  checksOnLaunchByDefault: boolean,
): string[] {
  // Nothing to disclose on first run: the app makes no request until the user
  // asks for one, and Settings → Updates is where the choice lives.
  if (!checksOnLaunchByDefault) return [];

  const entry = hosts.find((candidate) => candidate.host === UPDATE_HOST);
  if (entry === undefined) return [];

  const passage = disclosurePassage(copy, entry.host);
  const gaps = REQUIRED_FACTS.filter((fact) => !fact.needs.test(passage)).map((fact) => fact.id);

  return passage === '' ? [`does not name ${entry.host}, the host it asks`, ...gaps] : gaps;
}

function welcomeCopy(): string {
  render(
    <Welcome
      onDismiss={() => undefined}
      browser={createFakeBrowserPort()}
      detect={() => Promise.resolve(NOTHING)}
    />,
  );
  return screen.getByTestId('welcome').textContent ?? '';
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the guard is not standing down', () => {
  it('an unconfigured machine really does check on launch', () => {
    // Anti-inert. Every assertion below is conditional on this being true, so
    // if it ever stops being true the guard would pass on any copy at all —
    // including copy that says nothing. `launchCheck.test.ts` owns the
    // behaviour; this says out loud that this file depends on it.
    localStorage.clear();
    expect(updateCheckOnLaunchEnabled()).toBe(true);
  });

  it('and github.com is still the registered host it asks', () => {
    // A row renamed or removed would drop the whole disclosure out of the
    // sweep silently, taking the required host name with it.
    const entry = OUTBOUND_HOSTS.find((candidate) => candidate.host === UPDATE_HOST);

    expect(entry, `${UPDATE_HOST} is not in outbound-hosts.ts`).toBeDefined();
    expect(entry?.purpose).toBe('fetched-on-request');
    expect(entry?.why).toMatch(/version|update/i);
  });
});

describe('the detector', () => {
  const HONEST =
    'When CViper Light starts it asks GitHub whether there is a newer version — a request for ' +
    'a version number, carrying nothing about you. Settings → Updates switches it off.';

  it('lets honest copy through', () => {
    expect(launchCheckDisclosureGaps(HONEST, OUTBOUND_HOSTS, true)).toEqual([]);
  });

  it('catches the copy this work item replaced', () => {
    // The real regression, verbatim. It is true, and it is silent about all
    // five facts.
    const before =
      'Your data stays on this computer. There is no account and nothing to sign up for.';

    expect(launchCheckDisclosureGaps(before, OUTBOUND_HOSTS, true)).toHaveLength(5);
  });

  it('negative: catches a disclosure that drops one fact at a time', () => {
    // A partial disclosure is the likely drift, not a wholesale deletion — a
    // later edit tidying away "carrying nothing about you" or the pointer to
    // Settings leaves a sentence that still reads fine.
    const noSwitch =
      'When CViper Light starts it asks GitHub for a version number, carrying nothing about you.';
    expect(launchCheckDisclosureGaps(noSwitch, OUTBOUND_HOSTS, true)).toEqual([
      'does not say Settings can switch it off',
    ]);

    const noPayload =
      'When CViper Light starts it asks GitHub for a version number. Settings switches it off.';
    expect(launchCheckDisclosureGaps(noPayload, OUTBOUND_HOSTS, true)).toEqual([
      'does not say it carries nothing about the user',
    ]);

    const noWhen =
      'CViper Light asks GitHub for a version number, carrying nothing about you. ' +
      'Settings switches it off.';
    expect(launchCheckDisclosureGaps(noWhen, OUTBOUND_HOSTS, true)).toEqual([
      'does not say WHEN it happens (when the app starts)',
    ]);
  });

  it('negative: copy that names no host owes every fact, however much else it says', () => {
    // The passage is empty, so there is nothing to read the other four facts
    // out of — and a disclosure that never says who is asked is not one.
    const noHost =
      'When CViper Light starts it asks for a version number, carrying nothing about you. ' +
      'Settings switches it off.';

    expect(launchCheckDisclosureGaps(noHost, OUTBOUND_HOSTS, true)).toEqual([
      'does not name github.com, the host it asks',
      'does not say WHEN it happens (when the app starts)',
      'does not say WHAT is asked for (a version number)',
      'does not say it carries nothing about the user',
      'does not say Settings can switch it off',
    ]);
  });

  it('negative: unrelated sentences elsewhere on the screen do not pay the debt', () => {
    // The bug the passage rule exists for. Every one of these words is already
    // on the shipped welcome screen, in copy about something else entirely.
    const elsewhere =
      'Two of these work better with a free key — you can start without one. ' +
      'You can open this again from Settings at any time. ' +
      'The version number of this build is shown in About. ' +
      'GitHub hosts the source code.';

    expect(launchCheckDisclosureGaps(elsewhere, OUTBOUND_HOSTS, true)).toEqual([
      'does not say WHEN it happens (when the app starts)',
      'does not say WHAT is asked for (a version number)',
      'does not say it carries nothing about the user',
      'does not say Settings can switch it off',
    ]);
  });

  it('boundary: empty copy owes every fact', () => {
    expect(launchCheckDisclosureGaps('', OUTBOUND_HOSTS, true)).toHaveLength(5);
    expect(launchCheckDisclosureGaps('   \n  ', OUTBOUND_HOSTS, true)).toHaveLength(5);
  });
});

describe('the verdict follows the registry and the default, not the wording', () => {
  const SILENT =
    'Your data stays on this computer. There is no account and nothing to sign up for.';

  it('silence is a defect while an unconfigured machine checks on launch', () => {
    expect(launchCheckDisclosureGaps(SILENT, OUTBOUND_HOSTS, true)).toHaveLength(5);
  });

  it('the SAME copy stops being a defect once nothing is requested on launch', () => {
    // Nothing about the copy changed between these two assertions — only what
    // the app does before the user has pressed anything, which is the only
    // thing that should move the verdict.
    expect(launchCheckDisclosureGaps(SILENT, OUTBOUND_HOSTS, false)).toEqual([]);
  });

  it('the host the copy must name is read off the registry, not hardcoded', () => {
    // Same rule, a planted registry. The screen has to name whatever the
    // registry says the app contacts — so a row moved to another forge is a
    // sentence that has to be rewritten, not a guard that quietly still passes.
    const planted: readonly OutboundHost[] = [
      { host: UPDATE_HOST, purpose: 'fetched-on-request', why: 'The update check.' },
    ];
    const namesTheWrongForge =
      'When CViper Light starts it asks Codeberg for a version number, carrying nothing about ' +
      'you. Settings switches it off.';

    expect(launchCheckDisclosureGaps(namesTheWrongForge, planted, true)).toContain(
      'does not name github.com, the host it asks',
    );
  });

  it('an unregistered update host is the registry’s defect, not this screen’s', () => {
    // `outbound-hosts.contract.test.ts` is what fails when a host disappears
    // from the registry while the code still names it. This guard must not
    // invent a second, vaguer verdict on the same fact.
    expect(launchCheckDisclosureGaps(SILENT, [], true)).toEqual([]);
  });
});

describe('the first-run screen', () => {
  it('discloses the launch update check before the user has pressed anything', () => {
    const gaps = launchCheckDisclosureGaps(
      welcomeCopy(),
      OUTBOUND_HOSTS,
      updateCheckOnLaunchEnabled(),
    );

    expect(
      gaps,
      'The welcome screen is the only thing a new user has read when the mount effect in ' +
        'App.tsx asks github.com for a version number. Its copy must say who is asked, what is ' +
        'asked for, that it carries nothing about them, and that Settings can switch it off — ' +
        'or the launch check must stop being the default.',
    ).toEqual([]);
  });

  it('says it in the screen’s own voice, not as a warning', () => {
    // The disclosure is a fact about the product, told the way the rest of the
    // screen tells facts. A first-run screen that apologises for its own
    // update check teaches the reader that something is wrong with it.
    const copy = welcomeCopy();

    expect(copy).not.toMatch(/\b(warning|caution|please note|disclaimer|beware)\b/i);
  });

  it('does not claim more than the code can back', () => {
    // The registry says the request "carries no data about you beyond the
    // request itself" — the site still sees an IP address, exactly as it would
    // for any download. Copy promising anonymity would be a claim no part of
    // this app implements.
    const copy = welcomeCopy();

    expect(copy).not.toMatch(/\banonymous(ly)?\b|\buntraceable\b|\bcannot be traced\b/i);
  });
});
