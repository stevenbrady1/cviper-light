/**
 * The consent contract: every module that can build the AI transport checks
 * consent first, or says in writing why it does not need to.
 *
 * ============================================================================
 * WHY THIS EXISTS: L-115
 * ============================================================================
 * `runAnalysis.ts` was gated and proved. `runExtraction.ts` — the tracker's
 * paste-an-advert path — built the SAME transport from the same factory with
 * no consent check anywhere in the file, so a recruiter's email could reach
 * OpenAI with nothing disclosed and nothing recorded.
 *
 * The guard that was supposed to catch that read exactly ONE hard-coded file.
 * A second call site was invisible to it rather than failing it: the same shape
 * as L-106, where a sweep matched `*_STORAGE_KEY` and the consent store — which
 * is not one — survived a full erase. A guard that adjudicates a narrower
 * population than the rule it claims to enforce reports the health of what it
 * looked at as the health of everything.
 *
 * So the population here is DERIVED, not listed: every non-test module under
 * `apps/light/src` that imports `createTauriTransport`. A third call site added
 * tomorrow is in scope on the day it is written, without anyone editing this
 * file — a forbid-list, not an allow-list (LESSON-033).
 *
 * ============================================================================
 * WHAT EACH IMPORTER MUST DO
 * ============================================================================
 *   * call `hasConsent(` before the first `createTransport()` /
 *     `createTauriTransport()` in the file, or
 *   * appear in `CONSENT_EXEMPT` with a written reason — and then never build
 *     a transport itself, because that is what the exemption claims.
 *
 * Comments are stripped first (`shippedText`), so the paragraph explaining a
 * gate can never stand in for the gate — the failure this repository's own
 * conventions call out by name.
 *
 * ============================================================================
 * PROVED, NOT ASSUMED
 * ============================================================================
 * Four mutations, all restored: deleting the check from `runAnalysis.ts`,
 * deleting the one added to `runExtraction.ts`, adding a fourth importer with
 * no check and no exemption, and adding one that reaches the factory through a
 * NAMESPACE import — the shape that used to be invisible here rather than red.
 * Each turns this file red, naming the offending module. The output is in the
 * L-115 pull request.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, shippedText, stripComments, walk } from './repo-scan';

const APP_SRC = join(REPO_ROOT, 'apps/light/src');

/**
 * Import forms that put the real transport factory in a module's hands.
 *
 * The static named import is what every shipped module uses. The others are
 * here because a guard that knows ONE spelling is a guard a refactor steps
 * around without anyone meaning to: `await import('./transport')` is the
 * obvious dynamic form, and a NAMESPACE import
 * (`import * as transportModule from '../../ai/transport'`) never writes the
 * token `createTauriTransport` on the import line at all, so a detector that
 * looks for it there drops the file out of the population entirely — invisible,
 * not red. That is the exact failure this whole file exists to stop, so the
 * namespace form matches on the MODULE PATH, not on what is taken from it, and
 * the member-call shape is matched wherever it appears in the file.
 */
const IMPORT_FORMS: readonly RegExp[] = [
  /import[^;]*?\bcreateTauriTransport\b[^;]*?from\s*['"][^'"]*transport['"]/,
  /\bcreateTauriTransport\b[^;]*?=\s*await\s+import\(\s*['"][^'"]*transport['"]\s*\)/,
  /import\(\s*['"][^'"]*transport['"]\s*\)[^;]*?\bcreateTauriTransport\b/,
  /import\s+\*\s+as\s+\w+\s+from\s*['"][^'"]*transport['"]/,
  /\.\s*createTauriTransport\s*(?:\?\.)?\s*\(/,
];

/** `hasConsent(kind)` — the shared check, however the module obtained it. */
const CONSENT_CHECK = /\bhasConsent\s*\(/;

/**
 * A transport being BUILT: the factory CALLED, under any of its spellings.
 *
 * `createTransport()`, `createTauriTransport()`, the namespace member form
 * `transportModule.createTauriTransport()`, and the optional-call form
 * `createTransport?.()` — which an injected, optional factory is written as,
 * and which a naive `\(` after the name does not match.
 *
 * The call, never the name. `createTransport: () => ChatTransport =
 * createTauriTransport` is a default parameter, not a construction, and a guard
 * that counted the import line as the first use would be unsatisfiable — the
 * import is always at the top.
 */
const TRANSPORT_BUILD = /\b(?:\w+\.)?create(?:Tauri)?Transport\s*(?:\?\.)?\s*\(\s*\)/;

function importsTauriTransport(text: string): boolean {
  return IMPORT_FORMS.some((pattern) => pattern.test(text));
}

interface GateReport {
  readonly consentAt: number;
  readonly transportAt: number;
}

/** Where the consent check and the first transport construction are, or -1. */
function gateReport(text: string): GateReport {
  return {
    consentAt: text.search(CONSENT_CHECK),
    transportAt: text.search(TRANSPORT_BUILD),
  };
}

interface Exemption {
  /** Repository-relative, forward slashes — exactly what `displayPath` prints. */
  readonly file: string;
  readonly reason: string;
}

/**
 * Modules that import the factory but are not themselves the place data leaves.
 *
 * An entry here is a claim, and the tests below check the claim: the file must
 * still be an importer (a stale exemption is dead weight that hides the next
 * one), and it must not build a transport of its own.
 */
const CONSENT_EXEMPT: readonly Exemption[] = [
  {
    file: 'apps/light/src/features/analysis/Analysis.tsx',
    reason:
      'A pass-through, not a call site. It never invokes the factory: it hands ' +
      '`createTransport ?? createTauriTransport` to `runAnalysis`, which holds the gate, and ' +
      'supplies the consent reader that gate calls plus the `ConsentGate` dialog that records ' +
      'the answer. A `hasConsent(` here would be a second gate to keep in step with the first, ' +
      'and the screen already refuses to call `performRun` until `consent[kind]` is true.',
  },
];

const IMPORTERS = walk(APP_SRC, { extensions: ['.ts', '.tsx'] })
  .map((file) => ({ file: displayPath(file), text: shippedText(file) }))
  .filter((candidate) => importsTauriTransport(candidate.text));

const EXEMPT_FILES = new Set(CONSENT_EXEMPT.map((entry) => entry.file));

describe('the call-site detector', () => {
  it('sees every import form that hands a module the real factory', () => {
    expect(
      importsTauriTransport("import { createTauriTransport } from '../../ai/transport';"),
    ).toBe(true);
    expect(
      importsTauriTransport(
        "import {\n  createTauriTransport,\n  probeOllama,\n} from '../../ai/transport';",
      ),
    ).toBe(true);
    expect(
      importsTauriTransport("const { createTauriTransport } = await import('./transport');"),
    ).toBe(true);
  });

  it('sees a namespace import, which never writes the factory name on the import line', () => {
    // The evasion that is invisible rather than red: nothing on this line says
    // `createTauriTransport`, so a detector keyed to that token drops the file
    // out of the population and reports the tree as clean.
    expect(importsTauriTransport("import * as transportModule from '../../ai/transport';")).toBe(
      true,
    );

    // And the member call on its own, wherever the namespace came from.
    expect(importsTauriTransport('const t = transportModule.createTauriTransport();')).toBe(true);
    expect(importsTauriTransport('const t = transportModule.createTauriTransport?.();')).toBe(true);
  });

  it('lets the honest shapes through', () => {
    // A module that takes a transport as a parameter, and one that imports
    // something else from the same file, are not call sites of this factory.
    expect(importsTauriTransport('function run(createTransport: () => ChatTransport) {}')).toBe(
      false,
    );
    expect(importsTauriTransport("import { probeOllama } from '../../ai/transport';")).toBe(false);
  });

  it('reads a gate as ordered only when the check really precedes the build', () => {
    const gated = gateReport('await hasConsent(kind);\nconst p = providerFor(createTransport());');
    expect(gated.consentAt).toBeGreaterThan(-1);
    expect(gated.consentAt).toBeLessThan(gated.transportAt);

    const ungated = gateReport('const p = providerFor(createTransport());');
    expect(ungated.consentAt).toBe(-1);

    // The default parameter is not a construction: a file whose only mention of
    // the factory is its own signature has not built one.
    expect(
      gateReport('createTransport: () => ChatTransport = createTauriTransport,').transportAt,
    ).toBe(-1);
  });

  it('counts every spelling of the call as a build', () => {
    // Each of these reaches the network exactly as `createTransport()` does, so
    // a build the guard cannot see is a gate it cannot order.
    for (const built of [
      'const t = createTransport();',
      'const t = createTauriTransport();',
      'const t = transportModule.createTauriTransport();',
      'const t = createTransport?.();',
      'const t = deps.createTransport?.();',
    ]) {
      expect(gateReport(built).transportAt, built).toBeGreaterThan(-1);
    }
  });

  it('a comment cannot stand in for the check', () => {
    // The sentence explaining a gate must never satisfy the guard for it. The
    // regex on its own cannot tell the difference; `shippedText` is what makes
    // it true, so that is what is proved here rather than trusted.
    const prose = '// the transport is only built once hasConsent(kind) says yes';
    expect(CONSENT_CHECK.test(prose)).toBe(true);
    expect(CONSENT_CHECK.test(stripComments(prose))).toBe(false);

    // And the same on the real file: `Apple` occurs in `runAnalysis.ts` only in
    // its comments, so its absence after stripping proves the strip ran.
    const gate = join(APP_SRC, 'features/analysis/runAnalysis.ts');
    expect(readFileSync(gate, 'utf8')).toContain('Apple');
    expect(shippedText(gate)).not.toContain('Apple');
  });
});

describe('every AI call site is behind the consent gate', () => {
  it('scans the real tree and finds the known importers', () => {
    // Anti-inert: a walk that stopped finding files, or a detector that stopped
    // matching, would otherwise report an empty population as a clean one —
    // which is precisely how L-115 survived its own guard.
    expect(IMPORTERS.length).toBeGreaterThanOrEqual(2);
    expect(IMPORTERS.map((importer) => importer.file)).toEqual(
      expect.arrayContaining([
        'apps/light/src/features/analysis/Analysis.tsx',
        'apps/light/src/features/analysis/runAnalysis.ts',
        'apps/light/src/features/tracker/runExtraction.ts',
      ]),
    );
  });

  it('checks consent before it can build a transport, in every importing module', () => {
    const offenders = IMPORTERS.filter((importer) => !EXEMPT_FILES.has(importer.file)).flatMap(
      (importer) => {
        const { consentAt, transportAt } = gateReport(importer.text);
        if (consentAt === -1) {
          return [`${importer.file}: builds the AI transport and never calls hasConsent(`];
        }
        if (transportAt !== -1 && consentAt > transportAt) {
          return [`${importer.file}: calls hasConsent( only AFTER the transport is built`];
        }
        return [];
      },
    );

    expect(
      offenders,
      "Every module that can build the AI transport sends the user's own text to a named " +
        'third party (Apple 5.1.2(i)). It checks hasConsent( first, or it is listed in ' +
        'CONSENT_EXEMPT with a reason saying why it is not the place data leaves.',
    ).toEqual([]);
  });

  it('keeps every exemption true: still an importer, and still not building one', () => {
    const stale = CONSENT_EXEMPT.filter(
      (entry) => !IMPORTERS.some((importer) => importer.file === entry.file),
    ).map((entry) => `${entry.file}: exempted, but no longer imports the transport factory`);

    const builders = IMPORTERS.filter((importer) => EXEMPT_FILES.has(importer.file))
      .filter((importer) => gateReport(importer.text).transportAt !== -1)
      .map((importer) => `${importer.file}: exempted as a pass-through, but builds a transport`);

    expect([...stale, ...builders]).toEqual([]);
  });

  it('every exemption carries a reason somebody actually wrote', () => {
    const placeholders = /\b(TODO|FIXME|TBD|later|N\/A|see above|because)\b\.?$/i;

    for (const entry of CONSENT_EXEMPT) {
      expect(entry.reason.length, `${entry.file} needs a real reason`).toBeGreaterThan(60);
      expect(placeholders.test(entry.reason.trim()), `${entry.file}: placeholder reason`).toBe(
        false,
      );
    }
  });
});
