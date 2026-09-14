/**
 * The follow-up feature DRAFTS. It never sends, and it never opens a mail
 * client.
 *
 * ============================================================================
 * WHY THIS EXISTS (L-162)
 * ============================================================================
 * The whole value of this feature to a nervous job-seeker is that the app
 * cannot embarrass them: nothing leaves their machine addressed to a
 * recruiter unless they paste it somewhere themselves. That promise is only
 * worth making if a machine keeps it, because "Send" is the single most
 * natural button to add to a panel with a subject box and a body box, and the
 * next person will reach for it in good faith.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * Nothing here asserts that "Copy" or "Mark as sent" IS present — rewording
 * is free. It asserts that the shipped, comment-stripped text of the feature's
 * modules contains NO `mailto:`, NO word `send` (as a whole word, any case —
 * "sent" is a record of what the user did and stays legal), and NO route to a
 * shell/opener plugin or a browser port. Only a way to send can turn it red.
 *
 * The population is every non-test module in this directory whose name starts
 * with `followUp`, `FollowUp` or `runFollowUp`, plus the two ai-providers
 * modules the feature is built on — read off the disk, so a `sendFollowUp.ts`
 * added next to them is in scope on the day it is written.
 */
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, shippedText, walk } from '../../lib/repo-scan';

const TRACKER = join(REPO_ROOT, 'apps/light/src/features/tracker');
const AI_PROVIDERS = join(REPO_ROOT, 'packages/ai-providers/src');

const FEATURE_FILE = /(?:^|[\\/])(?:followUp|FollowUp|runFollowUp)[^\\/]*\.tsx?$/;
const PROVIDER_FILE = /(?:^|[\\/])(?:follow-up|build-follow-up-prompt)\.ts$/;

const FORBIDDEN: ReadonlyArray<{ readonly rule: string; readonly pattern: RegExp }> = [
  { rule: 'a mailto: link', pattern: /mailto:/i },
  { rule: 'the word "send" — this feature drafts, the user sends', pattern: /\bsend\b/i },
  { rule: 'a shell or opener plugin', pattern: /@tauri-apps\/plugin-(?:shell|opener)/ },
  { rule: 'a browser port — nothing here opens anything', pattern: /\bBrowserPort\b|\.open\(/ },
  { rule: 'a form submission', pattern: /<form\b|type=["']submit["']/ },
];

const files = [
  ...walk(TRACKER, { extensions: ['.ts', '.tsx'] }).filter((file) => FEATURE_FILE.test(file)),
  ...walk(AI_PROVIDERS, { extensions: ['.ts'] }).filter((file) => PROVIDER_FILE.test(file)),
];

describe('the follow-up feature never sends', () => {
  it('finds the feature at all (a broken scan must not pass vacuously)', () => {
    const names = files.map((file) => displayPath(file));
    expect(names.some((name) => name.endsWith('FollowUpPanel.tsx'))).toBe(true);
    expect(names.some((name) => name.endsWith('runFollowUp.ts'))).toBe(true);
    expect(names.some((name) => name.endsWith('followUp.ts'))).toBe(true);
    expect(names.some((name) => name.endsWith('packages/ai-providers/src/follow-up.ts'))).toBe(
      true,
    );
  });

  it.each(files.map((file) => [displayPath(file), file] as const))(
    '%s names no way to send',
    (_name, file) => {
      const text = shippedText(file);
      for (const { rule, pattern } of FORBIDDEN) {
        expect(pattern.test(text), `${displayPath(file)} contains ${rule}`).toBe(false);
      }
    },
  );

  it('the detector would notice: each forbidden shape is caught in a sample', () => {
    const samples = [
      '<a href="mailto:dana@example.com">',
      'const label = "Send it";',
      "import { open } from '@tauri-apps/plugin-shell';",
      'browser.open(url)',
      '<form onSubmit={…}>',
    ];
    for (const sample of samples) {
      expect(
        FORBIDDEN.some(({ pattern }) => pattern.test(sample)),
        sample,
      ).toBe(true);
    }
    // And the legal past tense stays legal.
    expect(FORBIDDEN.some(({ pattern }) => pattern.test('Mark as sent'))).toBe(false);
  });
});
