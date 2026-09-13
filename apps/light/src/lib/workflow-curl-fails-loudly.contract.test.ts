/**
 * The loud-download contract (L-140): every `curl` in `.github/workflows/` that
 * writes a file must carry `--fail`, so that a failed download fails AS a
 * failed download.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * `ci.yml` installs gitleaks pinned by version AND by sha256, then verifies the
 * checksum before unpacking it. That pinning is right and is not what went
 * wrong. What went wrong is the line above it:
 *
 *     curl -sSL -o gitleaks.tgz https://github.com/.../gitleaks_8.24.3_linux_x64.tar.gz
 *     echo "9991e0b2…  gitleaks.tgz" | sha256sum -c -
 *
 * Without `--fail`, curl treats an HTTP error as a successful transfer of an
 * error document. A 500 or a 502 from the release host is written into
 * `gitleaks.tgz` — an HTML page, a few hundred bytes — and curl exits 0. The
 * next line then does exactly its job and reports:
 *
 *     gitleaks.tgz: FAILED
 *     sha256sum: WARNING: 1 computed checksum did NOT match
 *
 * On CI run 174 (`ba27b22`) that is precisely what happened: GitHub served
 * errors for a window, the pin was byte-for-byte correct against upstream
 * `gitleaks_8.24.3_checksums.txt`, and a re-run passed unchanged.
 *
 * ============================================================================
 * WHY IT IS A GUARD AND NOT A ONE-LINE FIX
 * ============================================================================
 * The bug is not that the build went red. The build SHOULD go red when the
 * bytes are wrong. The bug is that it went red UNDER THE WRONG NAME.
 *
 * "checksum mismatch on the secret scanner" is the single alarm in this
 * repository most likely to start an incident: it says a pinned release was
 * substituted, on the tool whose whole job is catching leaked credentials. The
 * honest reading of that alarm is "stop, someone may have tampered with a
 * supply-chain artefact" — and the next person spends an afternoon on an
 * attacker who was never there, while the actual cause, a transient 502, has
 * already cleared.
 *
 * An integrity check must never be the thing that reports a network failure.
 * That separation is a property of the download line, and it is one flag wide,
 * which means it is one careless copy-paste from being lost again — a new
 * workflow, a new tool, `curl -sSL -o` typed from muscle memory. So the rule is
 * enforced across every workflow, not patched once in the one that failed.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * This does not enumerate the downloads that are allowed to exist. It says what
 * must be ABSENT: a curl that writes a file and can still exit 0 on an HTTP
 * error. A download added tomorrow is in scope the moment it is written,
 * without anybody remembering to register it here.
 *
 * ============================================================================
 * WHAT IT DOES NOT COVER
 * ============================================================================
 * A curl that writes NO file (`curl -s … | jq`, a health probe) is out of
 * scope: its exit code is not what a later integrity check reads, and the
 * consumer of the pipe sees the error body itself. `--retry`/`--retry-all-errors`
 * are strongly encouraged next to `--fail` — they turn a blip into a retried
 * download rather than any red at all — but they are not required here, because
 * a retry policy is a judgement call about the endpoint while `--fail` is
 * correctness: without it, "the download worked" is a lie the rest of the step
 * is built on.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './repo-scan.ts';

// ── Detectors ───────────────────────────────────────────────────────────────

/**
 * Drop YAML `#` comments, keeping line numbering intact.
 *
 * A comment is a `#` at the start of a line or preceded by whitespace — the
 * YAML rule — so `gitleaks_8.24.3#frag` or a bare `#` inside a word survives.
 *
 * This runs BEFORE any matching, and that ordering is the point. The fix for
 * L-140 ships a comment directly above the download explaining why `--fail` is
 * there; that comment contains the literal text `--fail`. Without stripping,
 * the explanation of the rule would satisfy the rule, and the guard would pass
 * on a workflow whose actual command had lost the flag. That exact shape — the
 * comment describing the fix standing in for the fix — is a failure this
 * repository has shipped before.
 *
 * Stripping can only ever HIDE a violation, never invent one; the floor below
 * is the other half of that trade.
 */
export function stripYamlComments(source: string): string {
  return source
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '$1'))
    .join('\n');
}

/** One shell command, with a 1-based physical line number for every character. */
interface LogicalLine {
  readonly text: string;
  /** `lineOf[i]` is the file line that `text[i]` came from. */
  readonly lineOf: readonly number[];
}

/**
 * The workflow's shell text as LOGICAL commands: `\`-continued lines joined.
 *
 * A download is very often written across lines —
 *
 *     curl -sSL \
 *       -o gitleaks.tgz \
 *       https://…
 *
 * — and a line-at-a-time scan sees `curl -sSL`, finds no `-o`, and walks past
 * the one command in the repository it exists to read. It would report zero
 * offenders and look identical to a clean tree.
 *
 * The per-character line map is what lets a failure name `ci.yml:209` rather
 * than "somewhere in ci.yml": a guard that cannot point at the line gets read
 * as noise.
 */
export function logicalLines(workflowText: string): LogicalLine[] {
  const physical = stripYamlComments(workflowText).split('\n');
  const commands: LogicalLine[] = [];
  let index = 0;

  while (index < physical.length) {
    let text = '';
    const lineOf: number[] = [];

    for (;;) {
      const raw = physical[index] ?? '';
      const continued = /\\\s*$/.test(raw);
      const body = continued ? raw.replace(/\\\s*$/, ' ') : raw;
      for (let position = 0; position < body.length; position += 1) lineOf.push(index + 1);
      text += body;
      index += 1;
      if (!continued || index >= physical.length) break;
    }

    commands.push({ text, lineOf });
  }

  return commands;
}

/** A single `curl …` command found in a workflow. */
export interface CurlInvocation {
  /** 1-based line of the file the `curl` token sits on. */
  readonly line: number;
  /** The command from `curl` up to the next shell separator, whitespace-collapsed. */
  readonly command: string;
}

/**
 * Every `curl` invocation in a workflow.
 *
 * The command ends at the next `&&`, `||`, `;` or `|`, so the flags examined
 * are curl's own and not the next program's — `curl … | sha256sum -c -` must
 * not be read as one command, or `-c` would look like curl's.
 */
export function curlInvocations(workflowText: string): CurlInvocation[] {
  const found: CurlInvocation[] = [];

  for (const { text, lineOf } of logicalLines(workflowText)) {
    // `curl` as a whole word, at a command position — never `mycurl` or `curl_wrap`.
    const token = /(^|[\s;&|(])curl(?=\s|$)/g;
    let match: RegExpExecArray | null;

    while ((match = token.exec(text)) !== null) {
      // The captured separator is consumed by the match but is not part of the
      // command, so skip past it to land on the `c` of `curl`.
      const start = match.index + (match[1] ?? '').length;
      const rest = text.slice(start);
      const cut = rest.search(/&&|\|\||;|\|/);
      const command = (cut === -1 ? rest : rest.slice(0, cut)).trim().replace(/\s+/g, ' ');
      found.push({ line: lineOf[start] ?? 0, command });
    }
  }

  return found;
}

/**
 * Does this curl write its body to a file?
 *
 * All the spellings, because they are equivalent in consequence and a guard
 * that knew only `-o` would be silent on `-O`:
 *
 *   * `-o file` and clustered short flags that end in `o` (`-sSLo file`)
 *   * `--output file`, `--output-dir dir`
 *   * `-O` / `--remote-name` (name taken from the URL)
 *   * a shell redirect of the body into a file (`curl … > file`)
 *
 * `2>/dev/null` and `2>&1` are stderr plumbing, not a downloaded artefact, and
 * are deliberately not matched.
 */
export function writesOutput(command: string): boolean {
  return (
    /(?:^|\s)-[a-zA-Z]*o(?:[\s=]|$)/.test(command) ||
    /(?:^|\s)--output(?:-dir)?(?:[\s=]|$)/.test(command) ||
    /(?:^|\s)-[a-zA-Z]*O(?:\s|$)/.test(command) ||
    /(?:^|\s)--remote-name(?![\w-])/.test(command) ||
    /(?<![0-9&])>>?\s*(?!\/dev\/null)[^\s&|<>]/.test(command)
  );
}

/**
 * Does this curl turn an HTTP error into a non-zero exit?
 *
 * `--fail`, `--fail-with-body`, and `-f` on its own or inside a cluster
 * (`-sSfL`) all do. `--fail-early` does NOT: it aborts a MULTI-URL transfer at
 * the first failure and says nothing about HTTP status, so it must not be
 * allowed to look like the real flag just because it starts with the same
 * eight characters.
 */
export function failsLoudly(command: string): boolean {
  return (
    /(?:^|\s)--fail(?:-with-body)?(?![\w-])/.test(command) ||
    /(?:^|\s)-[a-zA-Z]*f[a-zA-Z]*(?:\s|$)/.test(command)
  );
}

/** Every curl in a workflow that writes a file — the population under the rule. */
export function fileWritingCurls(workflowText: string): CurlInvocation[] {
  return curlInvocations(workflowText).filter((curl) => writesOutput(curl.command));
}

/** Every curl that would write an HTTP error page to disk and exit 0. */
export function silentlyFailingCurls(workflowText: string): CurlInvocation[] {
  return fileWritingCurls(workflowText).filter((curl) => !failsLoudly(curl.command));
}

// ── The detectors can actually fail ─────────────────────────────────────────

describe('the detector bites, and lets an honest download through', () => {
  /** A `run: |` block shaped like the real one, so line numbers are realistic. */
  const runBlock = (...lines: string[]): string =>
    ['jobs:', '  scan:', '    steps:', '      - name: Install a tool', '        run: |', ...lines]
      .map((line, at) => (at < 5 ? line : `          ${line}`))
      .join('\n');

  it('catches a download with no --fail, and names the line', () => {
    const workflow = runBlock(
      'curl -sSL -o gitleaks.tgz https://example.test/gitleaks.tar.gz',
      'echo "abc  gitleaks.tgz" | sha256sum -c -',
    );
    const offenders = silentlyFailingCurls(workflow);

    expect(offenders).toHaveLength(1);
    // Line 6: the five header lines, then the curl. A guard that cannot point
    // at the line is a guard nobody acts on.
    expect(offenders[0]?.line).toBe(6);
    expect(offenders[0]?.command).toBe(
      'curl -sSL -o gitleaks.tgz https://example.test/gitleaks.tar.gz',
    );
  });

  it('accepts --fail, -f inside a cluster, and --fail-with-body', () => {
    expect(
      silentlyFailingCurls(runBlock('curl --fail --retry 3 -sSL -o t.tgz https://example.test/t')),
    ).toEqual([]);
    expect(silentlyFailingCurls(runBlock('curl -sSfL -o t.tgz https://example.test/t'))).toEqual(
      [],
    );
    expect(silentlyFailingCurls(runBlock('curl -f -o t.tgz https://example.test/t'))).toEqual([]);
    expect(
      silentlyFailingCurls(runBlock('curl --fail-with-body -o t.tgz https://example.test/t')),
    ).toEqual([]);
  });

  it('is not satisfied by --fail-early, which says nothing about HTTP status', () => {
    // Starts with the same eight characters and does something else entirely.
    expect(failsLoudly('curl --fail-early -o t.tgz https://example.test/t')).toBe(false);
    expect(
      silentlyFailingCurls(runBlock('curl --fail-early -o t.tgz https://x.test/t')),
    ).toHaveLength(1);
  });

  it('follows a `\\`-continued command across lines', () => {
    // The shape a line-at-a-time scan walks straight past: no `-o` on the line
    // the `curl` token sits on.
    const workflow = runBlock('curl -sSL \\', '  -o gitleaks.tgz \\', '  https://example.test/t');
    const offenders = silentlyFailingCurls(workflow);

    expect(offenders).toHaveLength(1);
    expect(offenders[0]?.line).toBe(6);
    // And the honest version of the same shape walks through.
    expect(
      silentlyFailingCurls(
        runBlock('curl --fail -sSL \\', '  -o gitleaks.tgz \\', '  https://x.test/t'),
      ),
    ).toEqual([]);
  });

  it('reads a curl anywhere inside a multi-line `run:` block, not just the first line', () => {
    const workflow = runBlock(
      'echo "preparing"',
      'mkdir -p tools',
      'curl -sSL -o tools/thing.tgz https://example.test/thing',
    );
    expect(silentlyFailingCurls(workflow)).toHaveLength(1);
    expect(silentlyFailingCurls(workflow)[0]?.line).toBe(8);
  });

  it('is not satisfied by a comment that mentions --fail', () => {
    // THE trap this guard is shaped around: the fix ships with a comment
    // explaining `--fail`, and that comment must not stand in for the flag.
    const workflow = runBlock(
      '# --fail turns an HTTP error into an exit code, not a file',
      'curl -sSL -o gitleaks.tgz https://example.test/t',
    );
    expect(silentlyFailingCurls(workflow)).toHaveLength(1);
    // A trailing comment on the line itself is no better.
    expect(
      silentlyFailingCurls(runBlock('curl -sSL -o t.tgz https://example.test/t  # --fail one day')),
    ).toHaveLength(1);
  });

  it('sees every output-writing spelling', () => {
    expect(writesOutput('curl -o t.tgz https://x.test/t')).toBe(true);
    expect(writesOutput('curl -sSLo t.tgz https://x.test/t')).toBe(true);
    expect(writesOutput('curl --output t.tgz https://x.test/t')).toBe(true);
    expect(writesOutput('curl --output=t.tgz https://x.test/t')).toBe(true);
    expect(writesOutput('curl --output-dir tools -O https://x.test/t')).toBe(true);
    expect(writesOutput('curl -O https://x.test/t.tgz')).toBe(true);
    expect(writesOutput('curl --remote-name https://x.test/t.tgz')).toBe(true);
    expect(writesOutput('curl -sSL https://x.test/t > t.tgz')).toBe(true);
  });

  it('ignores a curl that writes no file, and stderr plumbing', () => {
    // Out of scope by design: the pipe's consumer sees the error body, and no
    // later integrity check is built on a false "the download worked".
    expect(writesOutput('curl -sSL https://x.test/t')).toBe(false);
    expect(writesOutput('curl -sS https://x.test/health 2>/dev/null')).toBe(false);
    expect(writesOutput('curl -sS https://x.test/health 2>&1')).toBe(false);
    expect(silentlyFailingCurls(runBlock('curl -sSL https://x.test/t | tar -xz'))).toEqual([]);
  });

  it('reads curl as a word, and stops at the next command in a pipeline', () => {
    // `-c` belongs to sha256sum. Reading past the pipe would hand curl flags
    // it never had — and `-o` in a later command would invent an offender.
    const invocations = curlInvocations(
      runBlock('curl --fail -sSL -o t.tgz https://x.test/t | sha256sum -c -'),
    );
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.command).toBe('curl --fail -sSL -o t.tgz https://x.test/t');
    // Words that merely contain "curl" are not invocations.
    expect(curlInvocations(runBlock('mycurl -o t.tgz https://x.test/t'))).toEqual([]);
    expect(curlInvocations(runBlock('echo curl_helper'))).toEqual([]);
  });

  it('boundary: an empty workflow and one with no curl at all', () => {
    expect(silentlyFailingCurls('')).toEqual([]);
    expect(fileWritingCurls('')).toEqual([]);
    expect(silentlyFailingCurls(runBlock('pnpm install --frozen-lockfile'))).toEqual([]);
  });
});

// ── The real tree ───────────────────────────────────────────────────────────

const WORKFLOW_DIRECTORY = join(REPO_ROOT, '.github/workflows');

/**
 * How many workflows exist today: ci, ios, monorepo-split, msix, release, smoke.
 *
 * A floor, not a count. The danger it answers is not "somebody added a
 * workflow" — the scan covers that by reading the directory — it is "the scan
 * quietly stopped finding any", which produces an empty offender list that the
 * assertion below reads as a clean tree.
 */
const WORKFLOW_FLOOR = 5;

/**
 * At least one file-writing curl must be found, anywhere.
 *
 * THE ANTI-INERT FLOOR. Today that is the gitleaks download in `ci.yml`. If
 * this guard ever adjudicates zero downloads — the shell shape changed, the
 * comment stripper ate the line, the continuation joiner broke — then "no curl
 * is missing `--fail`" is true for the reason that makes it worthless, and the
 * suite would report green while looking at nothing. That is this repository's
 * most-repeated failure class, and it is why the floor is asserted before the
 * rule and not after it.
 *
 * If the last download is ever legitimately removed, lower this to 0 in the
 * same commit, so the decision is visible in review. Do not delete it.
 */
const FILE_WRITING_CURL_FLOOR = 1;

function workflowFiles(): string[] {
  const names = readdirSync(WORKFLOW_DIRECTORY).filter(
    (name) => name.endsWith('.yml') || name.endsWith('.yaml'),
  );

  expect(
    names.length,
    `Only ${names.length} workflow files were read from ${WORKFLOW_DIRECTORY}, expected at least ` +
      `${WORKFLOW_FLOOR}. An empty or shrunken scan looks byte-for-byte identical to a clean one.`,
  ).toBeGreaterThanOrEqual(WORKFLOW_FLOOR);
  expect(names, 'the workflow that downloads the secret scanner must be in scope').toContain(
    'ci.yml',
  );

  return names;
}

function readWorkflow(name: string): string {
  return readFileSync(join(WORKFLOW_DIRECTORY, name), 'utf8');
}

describe('every workflow download fails as a download', () => {
  it('finds at least one file-writing curl to adjudicate', () => {
    const downloads = workflowFiles().flatMap((name) =>
      fileWritingCurls(readWorkflow(name)).map((curl) => `${name}:${curl.line}`),
    );

    expect(
      downloads.length,
      'No curl that writes a file was found in any workflow. Either every download was ' +
        'removed, or this guard has gone blind and its green is meaningless — check the ' +
        'detector before believing the tree is clean.',
    ).toBeGreaterThanOrEqual(FILE_WRITING_CURL_FLOOR);
  });

  it('has no curl that could write an HTTP error page to disk', () => {
    const offenders = workflowFiles().flatMap((name) =>
      silentlyFailingCurls(readWorkflow(name)).map(
        (curl) => `${name}:${curl.line}: ${curl.command}`,
      ),
    );

    expect(
      offenders,
      'These downloads have no `--fail`, so curl writes a 500/502 error page into the output ' +
        'file and exits 0. Whatever checks the file next — a checksum, a tar, a signature — ' +
        'then reports the network failure under its OWN name, and "checksum mismatch on the ' +
        'secret scanner" reads as a tampered release (L-140, CI run 174). Add `--fail` ' +
        '(and `--retry 3 --retry-all-errors` while you are there).',
    ).toEqual([]);
  });
});
