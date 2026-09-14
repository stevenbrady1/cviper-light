/**
 * The ai-job-search importer (L-167): what the parser lifts out of the four
 * files, what it refuses to lift, and how the result lands on a profile the
 * user may already have typed into.
 */
import { describe, expect, it } from 'vitest';

import { emptyProfile, type Profile } from '@cviper/core-types';

import {
  mergeImportedProfile,
  parseAiJobSearchWorkspace,
  type ImportedProfile,
} from './importAiJobSearch';
import { FILLED, PRISTINE } from './test/aiJobSearchFixtures';

const IMPORTABLE_FIELDS = [
  'headline',
  'languages',
  'work_rights',
  'deal_breakers',
  'target_sectors',
  'career_goals',
  'energising',
  'draining',
  'writing_style',
  'star_examples',
] as const;

describe('parseAiJobSearchWorkspace — the pristine template', () => {
  const imported = parseAiJobSearchWorkspace(PRISTINE);

  it('imports NOTHING: every placeholder is a placeholder, not a value', () => {
    // Negative, and the most important one: a fresh clone must not seed the
    // profile with "[YOUR_LINKEDIN_HEADLINE]" and two languages called
    // "[LANGUAGE]".
    for (const field of IMPORTABLE_FIELDS) {
      expect(imported[field], field).toBeUndefined();
    }
  });

  it('says so in the notes, field by field', () => {
    expect(imported.notes.join('\n')).toMatch(/Headline: none found/);
    expect(imported.notes.join('\n')).toMatch(/Languages: none found/);
    expect(imported.notes.join('\n')).toMatch(/STAR examples: none found/);
  });

  it('never mentions a name, an email or a phone number, in any field or note', () => {
    const everything = JSON.stringify(imported);
    expect(everything).not.toMatch(/YOUR_NAME|YOUR_EMAIL|YOUR_PHONE|YOUR_ADDRESS/);
  });
});

describe('parseAiJobSearchWorkspace — a filled-in workspace', () => {
  const imported = parseAiJobSearchWorkspace(FILLED);

  it('takes the headline with its quotes stripped', () => {
    expect(imported.headline).toBe('Credit risk analyst moving into quant development');
  });

  it('merges the two language tables by name, first table first, case-insensitively', () => {
    expect(imported.languages).toEqual([
      { name: 'English', level: 'Native' },
      { name: 'French', level: 'B2' },
      { name: 'German', level: 'A2' },
    ]);
  });

  it('takes work rights only from Status/Constraints lines that talk about them', () => {
    // Both files have a Status line; only the CLAUDE.md one mentions
    // citizenship. The Constraints line mentions right to work and a visa.
    expect(imported.work_rights).toBe(
      'Employed, open to a move; UK citizen, no sponsorship needed; ' +
        'Hybrid within an hour of Leeds; right to work in the UK, no visa needed',
    );
  });

  it('takes the deal-breakers, target sectors (one entry per sector) and career goals', () => {
    expect(imported.deal_breakers).toEqual([
      'Fully on-site',
      'Below GBP 70k',
      'Relocation outside the UK',
    ]);
    expect(imported.target_sectors).toEqual([
      'Banking: HSBC, Lloyds, NatWest',
      'Hedge funds: Man Group, Marshall Wace',
    ]);
    expect(imported.career_goals).toEqual([
      'Lead a small modelling team within three years',
      'Move from reporting into model development',
      'Keep one foot in the code',
    ]);
  });

  it('splits an inline energise list on commas, keeps a bulleted drain list as bullets, and adds What Excites You', () => {
    expect(imported.energising).toEqual([
      'Hard technical problems',
      'Shipping models that people actually use',
      'model building',
      'pairing with engineers',
      'teaching',
    ]);
    expect(imported.draining).toEqual(['Status meetings', 'Slide decks for their own sake']);
  });

  it('reads STAR blocks in both the S/T/A/R and the Situation/Task/Action/Result spellings', () => {
    expect(imported.star_examples).toEqual([
      {
        title: 'IFRS 9 model rebuild (Ownership)',
        situation: 'The impairment model failed its annual audit two months before year end.',
        task: 'Rebuild the model and get it signed off before the reporting deadline.',
        action:
          'Rewrote the staging logic in Python, added a reconciliation suite, walked the auditors through it weekly.',
        result: 'Signed off three weeks early; the reconciliation suite is still run every month.',
      },
      {
        title: 'Pricing dashboard (Influence)',
        situation: 'Traders were pricing from a spreadsheet nobody trusted.',
        task: 'Persuade the desk to move to a shared tool.',
        action: 'Built a prototype in a week and sat with the desk for a month of feedback.',
        result: 'Adopted by all four desks; the spreadsheet was retired.',
      },
    ]);
  });

  it('skips a STAR block that has no Result, and says which one', () => {
    expect(imported.notes.join('\n')).toMatch(/Half-finished example.*Result/);
  });

  it('never imports contact details, even though the files hold them', () => {
    const everything = JSON.stringify(imported);
    expect(everything).not.toMatch(/jane@example\.com|07700|12 Example Street|linkedin/);
  });

  it('does not fill writing_style: none of the four files describes it', () => {
    expect(imported.writing_style).toBeUndefined();
  });

  it('counts what it found in the notes', () => {
    const notes = imported.notes.join('\n');
    expect(notes).toMatch(/Languages: 3 found/);
    expect(notes).toMatch(/STAR examples: 2 found/);
    expect(notes).toMatch(/Deal breakers: 3 found/);
  });
});

describe('parseAiJobSearchWorkspace — rough edges', () => {
  it('skips a language row that is not Language | Level, and keeps the good rows', () => {
    // Boundary: a row with one cell, a row with an empty name, and a row whose
    // level is a placeholder while the name is real.
    const claude_md = `### Identity
- **Languages:**
  | Language | Level |
  |----------|-------|
  | English | Native |
  | Spanish |
  | | B1 |
  | Polish | [LEVEL] |
  | German | A2 |
`;
    const imported = parseAiJobSearchWorkspace({
      claude_md,
      candidate_profile: null,
      job_evaluation: null,
      interview_prep: null,
    });
    expect(imported.languages).toEqual([
      { name: 'English', level: 'Native' },
      { name: 'German', level: 'A2' },
    ]);
    expect(imported.notes.join('\n')).toMatch(/language row/i);
  });

  it('handles a workspace that has only CLAUDE.md', () => {
    const imported = parseAiJobSearchWorkspace({
      claude_md: FILLED.claude_md,
      candidate_profile: null,
      job_evaluation: null,
      interview_prep: null,
    });
    expect(imported.headline).toBe('Credit risk analyst moving into quant development');
    expect(imported.languages).toEqual([
      { name: 'English', level: 'Native' },
      { name: 'French', level: 'B2' },
    ]);
    expect(imported.deal_breakers).toHaveLength(3);
    expect(imported.career_goals).toBeUndefined();
    expect(imported.star_examples).toBeUndefined();
    expect(imported.notes.join('\n')).toMatch(/04-job-evaluation\.md.*not in that folder/);
  });

  it('reads a STAR block written with bare Situation: prefixes and a bulleted title', () => {
    const interview_prep = `## Ready-Made STAR Examples

### 4. Migration to the cloud (Delivery)
Situation: Twenty on-prem servers out of support.
Task: Move them without downtime.
Action: Lifted and shifted one a week, with a rollback each time.
Result: Done in five months, no outage.
`;
    const imported = parseAiJobSearchWorkspace({
      claude_md: null,
      candidate_profile: null,
      job_evaluation: null,
      interview_prep,
    });
    expect(imported.star_examples).toEqual([
      {
        title: 'Migration to the cloud (Delivery)',
        situation: 'Twenty on-prem servers out of support.',
        task: 'Move them without downtime.',
        action: 'Lifted and shifted one a week, with a rollback each time.',
        result: 'Done in five months, no outage.',
      },
    ]);
  });

  it('does not take a Status line that says nothing about the right to work', () => {
    const imported = parseAiJobSearchWorkspace({
      claude_md: '### Identity\n- **Status:** Employed, looking\n',
      candidate_profile: null,
      job_evaluation: null,
      interview_prep: null,
    });
    expect(imported.work_rights).toBeUndefined();
  });

  it('trims every value and drops blank entries', () => {
    const imported = parseAiJobSearchWorkspace({
      claude_md: '### Deal-breakers\n-    Fully on-site   \n- \n-  Nights  \n',
      candidate_profile: null,
      job_evaluation: null,
      interview_prep: null,
    });
    expect(imported.deal_breakers).toEqual(['Fully on-site', 'Nights']);
  });

  it('four nulls is a workspace with nothing in it, not a crash', () => {
    const imported = parseAiJobSearchWorkspace({
      claude_md: null,
      candidate_profile: null,
      job_evaluation: null,
      interview_prep: null,
    });
    for (const field of IMPORTABLE_FIELDS) expect(imported[field]).toBeUndefined();
    expect(imported.notes.length).toBeGreaterThan(0);
  });
});

describe('mergeImportedProfile', () => {
  const NOW = '2026-09-14T09:00:00.000Z';
  const typed: Profile = {
    ...emptyProfile(NOW),
    headline: 'Already typed',
    work_rights: '   ',
    languages: [{ name: 'french', level: 'C1' }],
    deal_breakers: ['Fully on-site', 'Nights'],
    star_examples: [
      {
        title: 'IFRS 9 model rebuild (Ownership)',
        situation: 'mine',
        task: '',
        action: '',
        result: '',
      },
    ],
  };
  const imported: ImportedProfile = {
    headline: 'From the folder',
    work_rights: 'UK citizen',
    languages: [
      { name: 'French', level: 'B2' },
      { name: 'German', level: 'A2' },
    ],
    deal_breakers: ['fully on-site', 'Below GBP 70k'],
    career_goals: ['Lead a team'],
    star_examples: [
      {
        title: 'ifrs 9 model rebuild (ownership)',
        situation: 's',
        task: 't',
        action: 'a',
        result: 'r',
      },
      { title: 'Pricing dashboard', situation: 's', task: 't', action: 'a', result: 'r' },
    ],
    notes: [],
  };

  const merged = mergeImportedProfile(typed, imported);

  it('never overwrites a scalar the user typed', () => {
    expect(merged.headline).toBe('Already typed');
  });

  it('fills a scalar that is null or blank', () => {
    expect(merged.work_rights).toBe('UK citizen');
    expect(merged.writing_style).toBeNull();
  });

  it('unions lists: current first, imported appended, case-insensitive de-dup', () => {
    expect(merged.deal_breakers).toEqual(['Fully on-site', 'Nights', 'Below GBP 70k']);
    expect(merged.career_goals).toEqual(['Lead a team']);
    expect(merged.target_sectors).toEqual([]);
  });

  it('merges languages by name, keeping the level the user typed', () => {
    expect(merged.languages).toEqual([
      { name: 'french', level: 'C1' },
      { name: 'German', level: 'A2' },
    ]);
  });

  it('merges STAR examples by title, keeping the one the user has', () => {
    expect(merged.star_examples).toEqual([
      typed.star_examples[0],
      { title: 'Pricing dashboard', situation: 's', task: 't', action: 'a', result: 'r' },
    ]);
  });

  it('leaves the input alone and keeps id and updated_at', () => {
    expect(typed.deal_breakers).toEqual(['Fully on-site', 'Nights']);
    expect(merged.id).toBe(typed.id);
    expect(merged.updated_at).toBe(NOW);
  });

  it('an import with nothing in it changes nothing', () => {
    expect(mergeImportedProfile(typed, { notes: ['nothing'] })).toEqual(typed);
  });
});
