/**
 * The release-admin workflow contract (L-178): `release-admin.yml` stays a
 * hand-run tidy-up that cannot publish, and cannot be steered by what is typed
 * into its dispatch box.
 *
 * A FORBID-LIST (LESSON-033). It encodes what must be ABSENT:
 *
 *   1. Any trigger but `workflow_dispatch`. A push or schedule trigger would
 *      edit releases nobody asked to edit.
 *   2. A `${{ }}` expression inside a `run:` command. Inputs are free text;
 *      interpolated into a shell line, a crafted tag becomes a command.
 *   3. `gh` called straight from the workflow. Every release command goes
 *      through `releaseAdmin.ts`, where the refusals are unit-tested; a bare
 *      `gh release edit --draft=false` added here would skip all of them.
 *   4. A dispatch option the planner does not implement — `publish` above all.
 *   5. Any permission beyond `contents`.
 *
 * Comments are stripped before anything is adjudicated, so the prose above
 * each rule in the workflow never trips it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ADMIN_ACTIONS } from '../release/releaseAdmin.ts';
import { REPO_ROOT } from './repo-scan.ts';

const WORKFLOW_PATH = '.github/workflows/release-admin.yml';
const WORKFLOW = readFileSync(join(REPO_ROOT, WORKFLOW_PATH), 'utf8');

function stripComments(text: string): string[] {
  return text.split('\n').map((line) => line.replace(/(^|\s)#.*$/, '$1').trimEnd());
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Every `run:` command, single-line or block, as its own string. */
export function runCommands(text: string): string[] {
  const lines = stripComments(text);
  const commands: string[] = [];
  lines.forEach((line, index) => {
    const match = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(line);
    if (!match) return;
    const inline = match[2] ?? '';
    if (!/^[|>][-+]?$/.test(inline)) {
      commands.push(inline);
      return;
    }
    const keyIndent = indentOf(line);
    const body: string[] = [];
    for (const next of lines.slice(index + 1)) {
      if (next.trim() !== '' && indentOf(next) <= keyIndent) break;
      body.push(next.trim());
    }
    commands.push(body.join('\n'));
  });
  return commands;
}

/** The keys directly under `on:`. */
export function triggers(text: string): string[] {
  const lines = stripComments(text);
  const start = lines.findIndex((line) => /^on:\s*$/.test(line));
  if (start === -1) return [];
  const found: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue;
    if (indentOf(line) === 0) break;
    if (indentOf(line) === 2) found.push(line.trim().replace(/:.*$/, ''));
  }
  return found;
}

/** The `- option` lines under the `action` input's `options:`. */
export function dispatchOptions(text: string): string[] {
  const lines = stripComments(text);
  const start = lines.findIndex((line) => /^\s+options:\s*$/.test(line));
  if (start === -1) return [];
  const keyIndent = indentOf(lines[start] ?? '');
  const options: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue;
    if (indentOf(line) <= keyIndent && !line.trim().startsWith('-')) break;
    const option = /^\s*-\s+(\S+)\s*$/.exec(line);
    if (!option) break;
    options.push(option[1] ?? '');
  }
  return options;
}

/** Every `<scope>: read|write` permission line. */
export function grantedPermissions(text: string): string[] {
  return stripComments(text)
    .map((line) => /^\s+([a-z-]+):\s*(read|write)\s*$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => `${match[1]}: ${match[2]}`);
}

export function offences(text: string): string[] {
  const found: string[] = [];
  for (const trigger of triggers(text)) {
    if (trigger !== 'workflow_dispatch')
      found.push(`trigger '${trigger}' is not workflow_dispatch`);
  }
  for (const command of runCommands(text)) {
    if (command.includes('${{')) found.push(`\`${command}\` interpolates an expression into shell`);
    if (/(^|[\s;&|(])gh(\s|$)/.test(command)) found.push(`\`${command}\` calls gh directly`);
  }
  for (const option of dispatchOptions(text)) {
    if (!(ADMIN_ACTIONS as readonly string[]).includes(option)) {
      found.push(`dispatch option '${option}' is not an action the planner implements`);
    }
  }
  for (const permission of grantedPermissions(text)) {
    if (!permission.startsWith('contents:'))
      found.push(`permission '${permission}' is not contents`);
  }
  return found;
}

describe('the real release-admin.yml', () => {
  it('is read as the workflow it is (anti-inert)', () => {
    expect(triggers(WORKFLOW)).toEqual(['workflow_dispatch']);
    expect(runCommands(WORKFLOW)).toEqual(['node apps/light/src/release/runReleaseAdmin.ts']);
    expect(dispatchOptions(WORKFLOW)).toEqual([...ADMIN_ACTIONS]);
    expect(grantedPermissions(WORKFLOW)).toEqual(['contents: write']);
  });

  it('breaks none of the rules', () => {
    expect(offences(WORKFLOW)).toEqual([]);
  });
});

describe('the detector fails on each forbidden shape', () => {
  const HEADER =
    'name: x\non:\n  workflow_dispatch:\n    inputs:\n      action:\n        type: choice\n        options:\n          - delete-draft\njobs:\n  tidy:\n    steps:\n';

  it('a push trigger', () => {
    const text = 'on:\n  workflow_dispatch:\n  push:\n    tags: [light-v*]\n';
    expect(offences(text)).toEqual(["trigger 'push' is not workflow_dispatch"]);
  });

  it('an input interpolated into a single-line run', () => {
    const text = `${HEADER}      - run: node x.ts \${{ inputs.tag }}\n`;
    expect(offences(text)).toHaveLength(1);
    expect(offences(text)[0]).toMatch(/interpolates/);
  });

  it('an input interpolated inside a block run', () => {
    const text = `${HEADER}      - name: y\n        run: |\n          set -e\n          echo \${{ inputs.tag }}\n`;
    expect(offences(text)[0]).toMatch(/interpolates/);
  });

  it('gh called straight from the workflow, even after other commands', () => {
    const text = `${HEADER}      - run: |\n          set -e\n          gh release edit "$ADMIN_TAG" --draft=false\n`;
    expect(offences(text)[0]).toMatch(/calls gh directly/);
  });

  it('a publish option', () => {
    const text = HEADER.replace('- delete-draft', '- delete-draft\n          - publish');
    expect(offences(text)).toEqual([
      "dispatch option 'publish' is not an action the planner implements",
    ]);
  });

  it('a wider permission', () => {
    const text = `${HEADER.replace('jobs:', 'permissions:\n  contents: write\n  actions: write\njobs:')}`;
    expect(offences(text)).toEqual(["permission 'actions: write' is not contents"]);
  });

  it('does not fire on a comment that names every forbidden thing', () => {
    const text = `${HEADER}      # never: gh release edit --draft=false \${{ inputs.tag }}\n      - run: node ok.ts\n`;
    expect(offences(text)).toEqual([]);
  });
});
