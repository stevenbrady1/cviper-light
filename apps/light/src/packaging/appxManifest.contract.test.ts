// @vitest-environment jsdom
/**
 * The package manifest is well-formed XML (L-93).
 *
 * ============================================================================
 * WHY THIS EXISTS — IT COST A FIFTEEN-MINUTE CI RUN TO LEARN
 * ============================================================================
 * The first MSIX packaging run did everything right for fifteen minutes — built
 * the Store flavour, proved the updater was absent from the dependency graph,
 * staged the layout, installed the packaging CLI, generated a certificate — and
 * then died at the last step with
 *
 *     Failed to create MSIX package: Xml_InvalidCommentChars, 11, 3
 *
 * Line 11 was a divider inside the opening comment, written with hyphens:
 *
 *     ----------------------------------------------------------------------
 *
 * XML forbids `--` ANYWHERE inside a comment. The file looked perfectly normal,
 * every test passed, and the only thing that could tell anybody was a Windows
 * runner twenty minutes into a job. An XML parser answers it in microseconds.
 *
 * So the question is asked here instead, on every commit.
 *
 * ============================================================================
 * TWO CHECKS: ONE DECIDES, ONE EXPLAINS
 * ============================================================================
 * `DOMParser` is a real XML parser and it rejects BOTH forbidden comment shapes
 * — `--` inside the body, and a body ending in `-` — proved below on planted
 * input rather than assumed, because a guard built on a parser that shrugged
 * would be worse than no guard.
 *
 * `invalidComments` therefore adds no strictness, and an earlier version of this
 * comment claimed that it did: that jsdom was lenient about a trailing `-`. That
 * was wrong. The fixture behind the claim was `<!-- a - -->`, whose body ends in
 * a SPACE and is perfectly legal XML — it never tested the shape it was named
 * for. Corrected here rather than quietly deleted, because "the parser misses
 * this" is exactly the kind of belief that outlives the evidence for it.
 *
 * What the detector adds is the DIAGNOSIS. The parser says the document is not
 * well-formed; the detector says which line, which rule, and that a divider
 * should be `====`. For a failure that has already cost one fifteen-minute
 * packaging run, the difference between those two messages is the whole value.
 *
 * ============================================================================
 * WHAT THIS DELIBERATELY DOES NOT ASSERT
 * ============================================================================
 * It does not require the identity fields to BE placeholders. Replacing all
 * three is exactly what a real submission does, and a guard that went red the
 * moment the owner pasted their Partner Center values would be deleted on the
 * spot — taking the useful half with it.
 *
 * The state actually worth forbidding is the HALF-FILLED one, which looks
 * finished and is rejected at upload, and that is already held by the
 * all-three-or-none rule in `src/lib/msix-store-build.contract.test.ts`.
 */
import { describe, expect, it } from 'vitest';

// ============================================================================
// THE MANIFEST IS IMPORTED AS TEXT, NOT READ FROM DISK. THAT IS FORCED.
// ============================================================================
// This file runs under jsdom, because `DOMParser` is the real XML parser doing
// the work below and it is a browser global. Under jsdom `import.meta.url` is
// NOT a `file:` URL, so the
//
//     fileURLToPath(new URL('../../../../', import.meta.url))
//
// that every sibling test in this folder uses throws at MODULE LOAD. The
// symptom is worth knowing because it does not look like a failing assertion:
// the suite never COLLECTS, and vitest reports "1 failed | no tests" rather
// than naming anything. It cost a green-red-green proof that proved nothing,
// because the "before" state was never green.
//
// Vite's `?raw` needs no path resolution at all, works in either environment,
// and is typed by `vite/client` (referenced from `src/vite-env.d.ts`).
import MANIFEST from '../../src-tauri/msix/Package.appxmanifest?raw';

const MANIFEST_PATH = 'apps/light/src-tauri/msix/Package.appxmanifest';

/**
 * The parser's complaint about this document, or `null` if it is well-formed.
 *
 * `DOMParser` reports a failure by RETURNING a document containing a
 * `parsererror` element rather than by throwing, so a caller that only wrapped
 * it in a `try` would see every malformed file as fine.
 */
export function parseProblem(xml: string): string | null {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  const error = parsed.getElementsByTagName('parsererror')[0];
  return error === undefined ? null : (error.textContent ?? 'the document is not well-formed XML');
}

/**
 * Comments that break the XML comment rules, with the line each starts on.
 *
 * `Comment ::= '<!--' ((Char - '-') | ('-' (Char - '-')))* '-->'` — so `--` may
 * not appear in the body and the body may not end with `-`.
 */
export function invalidComments(xml: string): string[] {
  const problems: string[] = [];

  for (const match of xml.matchAll(/<!--([\s\S]*?)-->/g)) {
    const body = match[1] ?? '';
    const line = xml.slice(0, match.index).split('\n').length;

    if (body.includes('--')) {
      problems.push(
        `line ${line}: a comment contains "--", which XML forbids anywhere inside one. ` +
          'Use "====" for a divider.',
      );
    }
    if (body.endsWith('-')) {
      problems.push(`line ${line}: a comment body ends with "-", which makes an invalid "--->".`);
    }
  }

  return problems;
}

// ── The premise ─────────────────────────────────────────────────────────────

describe('the premise: there is a manifest to adjudicate', () => {
  it('read a manifest with real content in it', () => {
    // Anti-inert: an empty or missing file parses as nothing and would make
    // every rule below pass by having nothing to inspect.
    expect(MANIFEST.length).toBeGreaterThan(500);
    expect(MANIFEST).toContain('<Package');
    expect(MANIFEST).toContain('<Identity');
  });

  it('the manifest contains comments, which is what is being checked', () => {
    expect([...MANIFEST.matchAll(/<!--/g)].length).toBeGreaterThanOrEqual(4);
  });
});

// ── The contract ────────────────────────────────────────────────────────────

describe('Package.appxmanifest is well-formed XML', () => {
  it('parses', () => {
    const problem = parseProblem(MANIFEST);
    expect(
      problem,
      `${MANIFEST_PATH} is not well-formed XML, so the packaging tool will refuse it — after ` +
        'building the whole app first. ' +
        String(problem),
    ).toBeNull();
  });

  it('has no comment that breaks the XML comment rules', () => {
    const problems = invalidComments(MANIFEST);
    expect(
      problems,
      `${MANIFEST_PATH}:\n${problems.join('\n')}\n\nThis is the exact failure that killed MSIX ` +
        'packaging run 34712978518 at its last step.',
    ).toEqual([]);
  });
});

// ── Proof the detectors can actually fail ───────────────────────────────────

describe('the detectors bite, and let the honest shapes through', () => {
  it('the parser really does reject the failure that happened', () => {
    // Without this, a parser that quietly accepted anything would make the
    // rule above a permanently green statement about nothing.
    expect(parseProblem('<r><!-- a -- b --></r>')).not.toBeNull();
    expect(parseProblem('<r><a></r>')).not.toBeNull();
    expect(parseProblem('<r><!-- a == b --></r>')).toBeNull();
    expect(parseProblem('<r><a/></r>')).toBeNull();
  });

  it('the comment detector catches both forbidden shapes, and names the line', () => {
    const dashes = '<r>\n<!--\n  ------------\n-->\n</r>';
    expect(invalidComments(dashes)).toHaveLength(1);
    expect(invalidComments(dashes)[0]).toContain('line 2');

    // The real trailing-dash shape is `--->`, whose body is ' a -'. Note that
    // `<!-- a - -->` is NOT this: its body ends in a space and is legal XML.
    expect(invalidComments('<r><!-- a ---></r>')).toHaveLength(1);
  });

  it('the parser and the detector agree, and the detector adds the line', () => {
    // Measured, not assumed. jsdom rejects BOTH forbidden shapes, so the
    // detector is not covering a gap in it — it is producing the message that
    // makes the next occurrence a two-second failure rather than a twenty-minute
    // one on a Windows runner.
    const trailing = '<r><!-- a ---></r>';
    expect(parseProblem(trailing)).not.toBeNull();
    expect(invalidComments(trailing)).toHaveLength(1);
    expect(invalidComments(trailing)[0]).toContain('line 1');

    // And a body ending in a SPACE is legal to both of them.
    expect(parseProblem('<r><!-- a - --></r>')).toBeNull();
    expect(invalidComments('<r><!-- a - --></r>')).toEqual([]);
  });

  it('negative: the honest comments this repository actually writes walk through', () => {
    // A guard that fired on the fix for the bug is a guard somebody deletes.
    expect(
      invalidComments('<r><!--\n  ============\n  A heading.\n  ============\n--></r>'),
    ).toEqual([]);
    expect(invalidComments('<r><!-- Product -> Product identity --></r>')).toEqual([]);
    expect(invalidComments('<r><!-- PLACEHOLDER-Owners-Own-Name --></r>')).toEqual([]);
    expect(invalidComments('<r><!-- an em dash — is one character --></r>')).toEqual([]);
  });

  it('boundary: a document with no comments at all has nothing to report', () => {
    expect(invalidComments('<r><a/></r>')).toEqual([]);
  });
});
