import { describe, expect, it } from 'vitest';

import {
  foldRelease,
  parseFragment,
  renderRelease,
  unreleasedProblems,
  type Fragment,
} from './changelog.ts';

const BASE = 'https://github.com/stevenbrady1/cviper-light';

const CHANGELOG = [
  '# Changelog',
  '',
  'Intro.',
  '',
  '## [Unreleased]',
  '',
  'Pending changes live in `changes/unreleased/`.',
  '',
  '## [0.11.0] — 2026-10-27',
  '',
  '### Added',
  '',
  '- Old entry (L-200).',
  '',
  `[Unreleased]: ${BASE}/compare/light-v0.11.0...main`,
  `[0.11.0]: ${BASE}/compare/light-v0.10.6...light-v0.11.0`,
  '',
].join('\n');

function fragment(lNumber: number, section: Fragment['section'], body?: string): Fragment {
  return { file: `L-${lNumber}.md`, lNumber, section, body: body ?? `- Entry (L-${lNumber}).` };
}

describe('parseFragment', () => {
  it('reads the section from the front matter and the bullet from the body', () => {
    expect(
      parseFragment('L-301.md', '---\nsection: Added\n---\n\n- Smoke test (L-301).\n'),
    ).toEqual({ file: 'L-301.md', lNumber: 301, section: 'Added', body: '- Smoke test (L-301).' });
  });

  it('keeps more than one bullet, in order', () => {
    const text = '---\nsection: Fixed\n---\n\n- First (L-9).\n- Second, same work item.\n';
    expect(parseFragment('L-9.md', text).body).toBe('- First (L-9).\n- Second, same work item.');
  });

  it('boundary: accepts Windows line endings and the smallest L-number', () => {
    expect(
      parseFragment('L-1.md', '---\r\nsection: Security\r\n---\r\n\r\n- Fix (L-1).\r\n'),
    ).toEqual({ file: 'L-1.md', lNumber: 1, section: 'Security', body: '- Fix (L-1).' });
  });

  it('negative: a file name that is not L-NNN.md', () => {
    for (const name of ['notes.md', 'L-0.md', 'L-012.md', 'L-12.txt', 'l-12.md', 'L-12-b.md']) {
      expect(() => parseFragment(name, '---\nsection: Added\n---\n\n- x (L-12).\n')).toThrow(
        /file name/,
      );
    }
  });

  it('negative: a missing, unknown or misspelt section', () => {
    expect(() => parseFragment('L-5.md', '- x (L-5).\n')).toThrow(/front matter/);
    expect(() => parseFragment('L-5.md', '---\n---\n\n- x (L-5).\n')).toThrow(/section/);
    expect(() => parseFragment('L-5.md', '---\nsection: Removed\n---\n\n- x (L-5).\n')).toThrow(
      /Added, Changed, Fixed, Security/,
    );
    expect(() => parseFragment('L-5.md', '---\nsection: fixed\n---\n\n- x (L-5).\n')).toThrow(
      /section/,
    );
    expect(() =>
      parseFragment('L-5.md', '---\nsection: Fixed\ntitle: x\n---\n\n- x (L-5).\n'),
    ).toThrow(/title/);
  });

  it('negative: an empty body, or a line that is not a bullet', () => {
    expect(() => parseFragment('L-5.md', '---\nsection: Fixed\n---\n\n')).toThrow(/no entry/);
    expect(() => parseFragment('L-5.md', '---\nsection: Fixed\n---\n\nProse (L-5).\n')).toThrow(
      /bullet/,
    );
    expect(() =>
      parseFragment('L-5.md', '---\nsection: Fixed\n---\n\n### Fixed\n\n- x (L-5).\n'),
    ).toThrow(/bullet/);
  });

  it('negative: the body never names its own L-number, and L-29 is not L-298', () => {
    expect(() => parseFragment('L-29.md', '---\nsection: Fixed\n---\n\n- x (L-298).\n')).toThrow(
      /L-29\b/,
    );
  });
});

describe('unreleasedProblems', () => {
  it('passes a changelog whose Unreleased block holds only prose', () => {
    expect(unreleasedProblems(CHANGELOG)).toEqual([]);
  });

  it('negative: a section heading or a bullet under Unreleased', () => {
    const withEntry = CHANGELOG.replace(
      'Pending changes live in `changes/unreleased/`.',
      '### Fixed\n\n- Something (L-302).',
    );
    expect(unreleasedProblems(withEntry)).toEqual([
      'line 7: "### Fixed"',
      'line 9: "- Something (L-302)."',
    ]);
  });

  it('negative: other list markers are entries too', () => {
    for (const line of ['* x', '+ x', '1. x']) {
      expect(unreleasedProblems(CHANGELOG.replace('Pending', `${line}\n\nPending`))).toHaveLength(
        1,
      );
    }
  });

  it('negative: no Unreleased heading at all', () => {
    expect(unreleasedProblems(CHANGELOG.replace('## [Unreleased]', '## Next'))).toEqual([
      'there is no "## [Unreleased]" heading',
    ]);
  });
});

describe('renderRelease', () => {
  it('orders sections Added, Changed, Fixed, Security and entries newest first', () => {
    const text = renderRelease(
      [
        fragment(10, 'Fixed'),
        fragment(12, 'Added'),
        fragment(11, 'Fixed'),
        fragment(3, 'Security'),
      ],
      '0.11.1',
      '2026-10-29',
    );
    expect(text).toBe(
      [
        '## [0.11.1] — 2026-10-29',
        '',
        '### Added',
        '',
        '- Entry (L-12).',
        '',
        '### Fixed',
        '',
        '- Entry (L-11).',
        '- Entry (L-10).',
        '',
        '### Security',
        '',
        '- Entry (L-3).',
        '',
      ].join('\n'),
    );
  });
});

describe('foldRelease', () => {
  it('puts the release under Unreleased, keeps the prose, and moves the links on', () => {
    const out = foldRelease(CHANGELOG, [fragment(301, 'Added')], '0.11.1', '2026-10-29');
    expect(out).toBe(
      [
        '# Changelog',
        '',
        'Intro.',
        '',
        '## [Unreleased]',
        '',
        'Pending changes live in `changes/unreleased/`.',
        '',
        '## [0.11.1] — 2026-10-29',
        '',
        '### Added',
        '',
        '- Entry (L-301).',
        '',
        '## [0.11.0] — 2026-10-27',
        '',
        '### Added',
        '',
        '- Old entry (L-200).',
        '',
        `[Unreleased]: ${BASE}/compare/light-v0.11.1...main`,
        `[0.11.1]: ${BASE}/compare/light-v0.11.0...light-v0.11.1`,
        `[0.11.0]: ${BASE}/compare/light-v0.10.6...light-v0.11.0`,
        '',
      ].join('\n'),
    );
    expect(unreleasedProblems(out)).toEqual([]);
  });

  it('boundary: a major bump is newer than any minor or patch', () => {
    expect(() =>
      foldRelease(CHANGELOG, [fragment(1, 'Added')], '1.0.0', '2026-10-29'),
    ).not.toThrow();
    expect(() =>
      foldRelease(CHANGELOG, [fragment(1, 'Added')], '0.11.10', '2026-10-29'),
    ).not.toThrow();
  });

  it('negative: nothing to release', () => {
    expect(() => foldRelease(CHANGELOG, [], '0.11.1', '2026-10-29')).toThrow(/nothing to release/);
  });

  it('negative: a version that is malformed, already released, or not newer', () => {
    const one = [fragment(1, 'Added')];
    expect(() => foldRelease(CHANGELOG, one, 'v0.11.1', '2026-10-29')).toThrow(/version/);
    expect(() => foldRelease(CHANGELOG, one, '0.11', '2026-10-29')).toThrow(/version/);
    expect(() => foldRelease(CHANGELOG, one, '0.11.0', '2026-10-29')).toThrow(/newer than 0.11.0/);
    expect(() => foldRelease(CHANGELOG, one, '0.10.9', '2026-10-29')).toThrow(/newer than 0.11.0/);
  });

  it('negative: a date that is malformed or not a real day', () => {
    const one = [fragment(1, 'Added')];
    expect(() => foldRelease(CHANGELOG, one, '0.11.1', '29/10/2026')).toThrow(/date/);
    expect(() => foldRelease(CHANGELOG, one, '0.11.1', '2026-02-30')).toThrow(/date/);
  });

  it('negative: entries already under Unreleased are refused, not merged', () => {
    const dirty = CHANGELOG.replace('Pending changes', '- Stray (L-7).\n\nPending changes');
    expect(() => foldRelease(dirty, [fragment(1, 'Added')], '0.11.1', '2026-10-29')).toThrow(
      /Unreleased/,
    );
  });

  it('negative: the same L-number twice', () => {
    expect(() =>
      foldRelease(CHANGELOG, [fragment(4, 'Added'), fragment(4, 'Fixed')], '0.11.1', '2026-10-29'),
    ).toThrow(/L-4 twice/);
  });

  it('negative: no Unreleased compare link to move on', () => {
    const noLink = CHANGELOG.replace(/^\[Unreleased\]:.*\n/mu, '');
    expect(() => foldRelease(noLink, [fragment(1, 'Added')], '0.11.1', '2026-10-29')).toThrow(
      /no "\[Unreleased\]: /,
    );
  });
});
