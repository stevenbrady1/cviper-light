/**
 * The updater-endpoint contract (L-92): the address an installed copy asks for
 * a manifest must be one that can actually answer, and the manifest it gets
 * must have been verified before it was published.
 *
 * ============================================================================
 * WHY THIS EXISTS — `/releases/latest/` IS A TRAP, NOT A URL
 * ============================================================================
 * `plugins.updater.endpoints` pointed at
 *
 *     https://github.com/<owner>/<repo>/releases/latest/download/latest.json
 *
 * which reads as "whatever the newest release is". It is not. GitHub resolves
 * `/releases/latest/` to the newest release that is NEITHER A DRAFT NOR A
 * PRE-RELEASE, and this repository produces neither of those things:
 *
 *   * `release.yml` always produces a DRAFT (`releaseDraft: true`, and that is
 *     deliberate — publishing is the moment every existing install starts
 *     downloading, so a person presses it).
 *   * The owner's rule is that unsigned direct installers ship as
 *     PRE-RELEASES, because an installer Windows SmartScreen warns about is not
 *     something to hand the general public as a headline download.
 *
 * So the endpoint 404s today, with nothing published at all, and it would go on
 * 404ing after the first real release. Worse, it fails in the direction nobody
 * investigates: the user presses "Check for updates", is told there is nothing
 * to compare against, and believes they are current.
 *
 * The fix is an endpoint whose address never changes and whose CONTENT is
 * replaced: a permanent `updater` release holding one `latest.json` asset, at
 *
 *     https://github.com/<owner>/<repo>/releases/download/updater/latest.json
 *
 * Verified against `tauri-plugin-updater` 2.10.1 rather than assumed — see
 * `apps/light/src-tauri/RELEASE-SIGNING.md`, which records what was read and
 * where.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * Nothing here asserts the correct URL is PRESENT. A guard pinning the literal
 * endpoint would fail the day the repository moved and pass the day somebody
 * broke it in a new way, and the first person to hit that deletes the guard
 * rather than the defect.
 *
 * What is forbidden is the SHAPE of an endpoint that cannot answer, and the
 * shape of a release flow that publishes a manifest nothing checked:
 *
 *   1. An endpoint containing `/releases/latest/` — the trap above.
 *   2. An endpoint that is not `https:`. The plugin refuses these in a release
 *      build (`validate_endpoints`), so it is a build that ships broken.
 *   3. An endpoint naming a host the outbound registry does not know. The app
 *      may not contact an address the privacy notice does not list.
 *   4. `releaseDraft: false` anywhere in `release.yml`. The draft gate is the
 *      one thing standing between a tag typo and every install downloading it.
 *   5. A job that uploads `latest.json` without verifying it in the same job.
 *      An unverified manifest is the whole failure this work item is about.
 *
 * ============================================================================
 * WHAT COUNTS AS TEXT
 * ============================================================================
 * COMMENTS ARE EXCLUDED from the workflow scan, for the reason `repo-scan.ts`
 * gives: a guard that fires on the prose explaining the fix is a guard somebody
 * deletes. `tauri.conf.json` is STRICT JSON with no comments at all (see
 * RELEASE-SIGNING.md), so it is parsed rather than scanned.
 *
 * The limitation that buys, stated rather than hidden: a commented-out upload
 * step is invisible here, which is correct — it uploads nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { OUTBOUND_HOST_NAMES } from './outbound-hosts.ts';
import { REPO_ROOT } from './repo-scan.ts';

const CONFIG_PATH = 'apps/light/src-tauri/tauri.conf.json';
const WORKFLOW_PATH = '.github/workflows/release.yml';

const CONFIG = readFileSync(join(REPO_ROOT, CONFIG_PATH), 'utf8');
const WORKFLOW = readFileSync(join(REPO_ROOT, WORKFLOW_PATH), 'utf8');

/**
 * The token that says a job checked the manifest before it published it.
 *
 * The root script name rather than a step name: a step can be renamed by
 * anybody tidying the file, and the rename would silently excuse the job.
 */
export const VERIFIER_SCRIPT = 'verify:updater-manifest';

/** The asset whose address every installed copy has baked into it. */
export const MANIFEST_ASSET = 'latest.json';

export interface Offence {
  readonly where: string;
  readonly found: string;
  readonly why: string;
}

/** The workflow as the runner sees it, with `#` commentary gone. */
export function readableYaml(source: string): string {
  return source.replaceAll('\r\n', '\n').replace(/(^|\s)#.*$/gm, '$1');
}

/** The updater endpoints declared in a Tauri config, or `[]` if there are none. */
export function endpointsOf(configJson: string): string[] {
  const parsed = JSON.parse(configJson) as {
    plugins?: { updater?: { endpoints?: unknown } };
  };
  const endpoints = parsed.plugins?.updater?.endpoints;
  if (!Array.isArray(endpoints)) return [];
  return endpoints.filter((entry): entry is string => typeof entry === 'string');
}

/** The endpoint as a URL, or `null` when it is not one at all. */
function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Every way an updater endpoint could be one that cannot answer. */
export function endpointOffences(configJson: string): Offence[] {
  const offences: Offence[] = [];

  for (const endpoint of endpointsOf(configJson)) {
    if (endpoint.includes('/releases/latest/')) {
      offences.push({
        where: CONFIG_PATH,
        found: endpoint,
        why:
          'GitHub resolves `/releases/latest/` to the newest release that is NEITHER A DRAFT NOR ' +
          'A PRE-RELEASE. This project publishes drafts (release.yml) and ships its unsigned ' +
          'installers as pre-releases, so this address 404s — and it fails silently, as "there ' +
          'is nothing to compare against". Point it at a fixed tag whose asset is overwritten ' +
          'on each release instead.',
      });
    }

    const parsed = parseUrl(endpoint);
    if (parsed === null) {
      offences.push({
        where: CONFIG_PATH,
        found: endpoint,
        why: 'not a URL the updater can parse, so the endpoint list is rejected at startup.',
      });
      continue;
    }

    if (parsed.protocol !== 'https:') {
      offences.push({
        where: CONFIG_PATH,
        found: endpoint,
        why:
          'a non-https updater endpoint. `validate_endpoints` in tauri-plugin-updater refuses ' +
          'these in a release build, so this is a build that ships unable to update at all.',
      });
    }

    const host = parsed.hostname.toLowerCase();
    if (!OUTBOUND_HOST_NAMES.has(host)) {
      offences.push({
        where: CONFIG_PATH,
        found: endpoint,
        why:
          `\`${host}\` is not in lib/outbound-hosts.ts, so the app would contact an address the ` +
          'privacy notice does not list. Register it with a "why", or use a host already there.',
      });
    }
  }

  return offences;
}

/**
 * The jobs of a workflow, as blocks of text.
 *
 * Deliberately lexical — no YAML parser, matching the house style of the other
 * repository guards (`release-signing-gate.contract.test.ts`,
 * `verify-loop-matches-ci.contract.test.ts`).
 */
export function jobsOf(workflow: string): Array<{ readonly name: string; readonly text: string }> {
  const lines = workflow.split('\n');
  const jobs: Array<{ name: string; text: string[] }> = [];

  let seenJobs = false;
  let indent = -1;
  let current: { name: string; text: string[] } | null = null;

  const flush = (): void => {
    if (current !== null) jobs.push(current);
    current = null;
  };

  for (const line of lines) {
    if (!seenJobs) {
      if (/^jobs:\s*$/.test(line)) seenJobs = true;
      continue;
    }
    if (line.trim() === '') {
      current?.text.push(line);
      continue;
    }

    const depth = line.length - line.trimStart().length;
    const header = /^(\s+)([A-Za-z0-9_-]+):\s*$/.exec(line);

    if (header && (indent === -1 || depth === indent)) {
      indent = (header[1] ?? '').length;
      flush();
      current = { name: header[2] ?? '', text: [line] };
      continue;
    }

    if (indent !== -1 && depth <= indent && !header) {
      // Dedented out of the jobs block entirely.
      flush();
      break;
    }

    current?.text.push(line);
  }

  flush();
  return jobs.map((job) => ({ name: job.name, text: job.text.join('\n') }));
}

/** Every way the release flow could publish something nobody checked. */
export function releaseFlowOffences(workflow: string): Offence[] {
  const text = readableYaml(workflow);
  const offences: Offence[] = [];

  for (const match of text.matchAll(/releaseDraft:\s*false/g)) {
    offences.push({
      where: `${WORKFLOW_PATH} — ${match[0]}`,
      found: match[0],
      why:
        'the draft gate is off. Publishing is the moment every existing install starts ' +
        'downloading this build, and that decision belongs to a person who has looked at the ' +
        'artefacts — not to a tag push that might have been a typo.',
    });
  }

  for (const job of jobsOf(text)) {
    const uploads = new RegExp(
      String.raw`release\s+upload[^\n]*${MANIFEST_ASSET.replace('.', String.raw`\.`)}`,
    ).test(job.text);
    if (!uploads) continue;
    if (job.text.includes(VERIFIER_SCRIPT)) continue;

    offences.push({
      where: `${WORKFLOW_PATH} — the "${job.name}" job`,
      found: `uploads ${MANIFEST_ASSET} without running \`${VERIFIER_SCRIPT}\``,
      why:
        `this job publishes the manifest every installed copy reads, and nothing in it ran ` +
        `\`${VERIFIER_SCRIPT}\` first. A manifest that is missing, unparseable or signed by a ` +
        'key no shipped binary trusts must fail the run rather than be uploaded.',
    });
  }

  return offences;
}

function explain(offences: readonly Offence[]): string {
  return offences.map((o) => `${o.where}  [${o.found}]\n    -> ${o.why}`).join('\n');
}

// ── The premise ─────────────────────────────────────────────────────────────

describe('the premise: there is an updater endpoint and a release workflow', () => {
  // Asserted FIRST. Everything below adjudicates a list, so a parser that
  // quietly returned an empty one would make this file pass by having nothing
  // to say.

  it('the config declares at least one updater endpoint', () => {
    expect(
      endpointsOf(CONFIG).length,
      `${CONFIG_PATH} declares no updater endpoints. If the updater was removed, delete this ` +
        'contract with it rather than leaving it adjudicating nothing.',
    ).toBeGreaterThan(0);
  });

  it('the release workflow has jobs, and one of them bundles', () => {
    const jobs = jobsOf(readableYaml(WORKFLOW));
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.map((job) => job.name)).toContain('bundle');
  });

  it('the workflow still produces a draft at all', () => {
    // The gate this guard protects has to exist before "it is not off" means
    // anything.
    expect(readableYaml(WORKFLOW)).toMatch(/releaseDraft:\s*true/);
  });
});

// ── The contract ────────────────────────────────────────────────────────────

describe('the updater endpoint can actually answer', () => {
  it('tauri.conf.json is clean', () => {
    const offences = endpointOffences(CONFIG);
    expect(offences, `\n${explain(offences)}\n`).toEqual([]);
  });
});

describe('the release flow publishes nothing it has not verified', () => {
  it('release.yml is clean', () => {
    const offences = releaseFlowOffences(WORKFLOW);
    expect(offences, `\n${explain(offences)}\n`).toEqual([]);
  });
});

// ── Proof the detectors can actually fail ───────────────────────────────────

describe('the endpoint detector can actually fail', () => {
  const config = (...endpoints: string[]): string =>
    JSON.stringify({ plugins: { updater: { endpoints } } });

  it('catches the /releases/latest/ trap, transcribed', () => {
    const offences = endpointOffences(
      config('https://github.com/stevenbrady1/cviper-light/releases/latest/download/latest.json'),
    );
    expect(offences).not.toEqual([]);
    expect(offences[0]?.why).toContain('PRE-RELEASE');
  });

  it('catches a plain-http endpoint', () => {
    const offences = endpointOffences(config('http://github.com/o/r/releases/download/u/l.json'));
    expect(offences.map((offence) => offence.why).join(' ')).toContain('non-https');
  });

  it('catches an endpoint on a host nobody registered', () => {
    const offences = endpointOffences(config('https://updates.example-vendor.io/latest.json'));
    expect(offences.map((offence) => offence.why).join(' ')).toContain('outbound-hosts.ts');
  });

  it('catches an endpoint that is not a URL at all', () => {
    expect(endpointOffences(config('not-a-url'))).not.toEqual([]);
  });

  it('boundary: no updater block at all yields nothing to adjudicate', () => {
    expect(endpointOffences('{}')).toEqual([]);
    expect(endpointsOf('{}')).toEqual([]);
  });
});

describe('the release-flow detector can actually fail', () => {
  it('catches the draft gate being switched off', () => {
    const offences = releaseFlowOffences(
      ['jobs:', '  bundle:', '    steps:', '      - with:', '          releaseDraft: false'].join(
        '\n',
      ),
    );
    expect(offences.map((offence) => offence.why).join(' ')).toContain('draft gate is off');
  });

  it('catches a job that uploads the manifest without verifying it', () => {
    const offences = releaseFlowOffences(
      [
        'jobs:',
        '  promote-manifest:',
        '    steps:',
        '      - name: Publish it',
        '        run: gh release upload updater latest.json --clobber',
      ].join('\n'),
    );
    expect(offences).toHaveLength(1);
    expect(offences[0]?.where).toContain('promote-manifest');
  });

  it('names the job and the reason', () => {
    const [offence] = releaseFlowOffences(
      ['jobs:', '  ship:', '    steps:', '      - run: gh release upload updater latest.json'].join(
        '\n',
      ),
    );
    expect(offence?.found).toContain('without running');
    expect(offence?.why).toContain(VERIFIER_SCRIPT);
  });
});

// ── Proof they do not fire on the correct shape ─────────────────────────────

describe('a correct configuration walks through', () => {
  it('a fixed-tag endpoint on a registered host is fine', () => {
    expect(
      endpointOffences(
        JSON.stringify({
          plugins: {
            updater: {
              endpoints: [
                'https://github.com/stevenbrady1/cviper-light/releases/download/updater/latest.json',
              ],
            },
          },
        }),
      ),
    ).toEqual([]);
  });

  it('an asset called latest.json is not itself the trap', () => {
    // The asset and the magic path segment share a word. Only the SEGMENT is
    // forbidden, or the fix would be unrepresentable.
    expect(
      endpointOffences(
        JSON.stringify({
          plugins: {
            updater: { endpoints: ['https://github.com/o/r/releases/download/u/latest.json'] },
          },
        }),
      ),
    ).toEqual([]);
  });

  it('a job that verifies before it uploads walks through', () => {
    const offences = releaseFlowOffences(
      [
        'jobs:',
        '  promote-manifest:',
        '    steps:',
        `      - run: pnpm ${VERIFIER_SCRIPT} latest.json --bundle-dir .`,
        '      - run: gh release upload updater latest.json --clobber',
      ].join('\n'),
    );
    expect(offences, explain(offences)).toEqual([]);
  });

  it('a commented-out upload reaches no runner', () => {
    const offences = releaseFlowOffences(
      [
        'jobs:',
        '  promote-manifest:',
        '    steps:',
        '      # - run: gh release upload updater latest.json',
      ].join('\n'),
    );
    expect(offences).toEqual([]);
  });

  it('boundary: an empty workflow has nothing to say', () => {
    expect(releaseFlowOffences('')).toEqual([]);
    expect(jobsOf('')).toEqual([]);
  });

  it('boundary: a bundling job that uploads no manifest is not adjudicated', () => {
    const offences = releaseFlowOffences(
      ['jobs:', '  bundle:', '    steps:', '      - uses: tauri-apps/tauri-action@v0'].join('\n'),
    );
    expect(offences).toEqual([]);
  });
});
