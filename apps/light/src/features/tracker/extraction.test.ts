import { describe, expect, it } from 'vitest';

import { EMPTY_JOB_EXTRACTION, type JobExtraction } from '@cviper/core-types';
import { type JobExtractionOutcome } from '@cviper/ai-providers';

import { type Availability } from '../analysis/providers';

import {
  NO_PROVIDER_NOTE,
  draftFromExtraction,
  draftFromOutcome,
  draftWithPastedText,
  extractionOptions,
  extractionProgressNote,
} from './extraction';
import { validateDraft } from './model';

const NOTHING: Availability = {
  ollamaRunning: false,
  ollamaModels: [],
  anthropicKey: false,
  openaiKey: false,
};

function extraction(overrides: Partial<JobExtraction> = {}): JobExtraction {
  return { ...EMPTY_JOB_EXTRACTION, ...overrides };
}

function outcome(overrides: Partial<JobExtractionOutcome> = {}): JobExtractionOutcome {
  return {
    available: true,
    extraction: EMPTY_JOB_EXTRACTION,
    reason: null,
    meta: { retryCount: 0, clampsApplied: [], repairStrategy: 'clean' },
    ...overrides,
  };
}

describe('extractionOptions — what this machine can offer', () => {
  it('offers nothing on a machine with no AI at all', () => {
    expect(extractionOptions(NOTHING)).toEqual([]);
  });

  it('NEVER offers the keyword scorer — there is no regex fallback here', () => {
    // A pattern-matched "title" off the first line of an email is wrong often
    // enough to be worse than an empty box, and wrong INVISIBLY.
    const everything: Availability = {
      ollamaRunning: true,
      ollamaModels: [{ id: 'llama3.2:latest', label: 'llama3.2' }],
      anthropicKey: true,
      openaiKey: true,
    };
    expect(extractionOptions(everything).map((option) => option.kind)).not.toContain('keyword');
  });

  it('offers an installed local model', () => {
    const options = extractionOptions({
      ...NOTHING,
      ollamaRunning: true,
      ollamaModels: [{ id: 'llama3.2:latest', label: 'llama3.2' }],
    });
    expect(options).toHaveLength(1);
    expect(options[0]?.model).toBe('llama3.2:latest');
    expect(options[0]?.local).toBe(true);
  });

  it('offers a cloud provider only when its key is saved', () => {
    expect(extractionOptions({ ...NOTHING, anthropicKey: true }).map((o) => o.kind)).toEqual([
      'anthropic',
    ]);
    expect(extractionOptions({ ...NOTHING, openaiKey: true }).map((o) => o.kind)).toEqual([
      'openai',
    ]);
  });

  it('boundary: Ollama running with no chat models offers nothing', () => {
    expect(extractionOptions({ ...NOTHING, ollamaRunning: true, ollamaModels: [] })).toEqual([]);
  });
});

describe('the note shown when nothing is configured', () => {
  it('names the free route first and offers the manual one in the same breath', () => {
    expect(NO_PROVIDER_NOTE).toContain('Ollama');
    expect(NO_PROVIDER_NOTE).toContain('your own key');
    expect(NO_PROVIDER_NOTE).toMatch(/add the job manually/i);
  });

  it('does not blame the user or call the machine broken', () => {
    expect(NO_PROVIDER_NOTE).not.toMatch(/error|fail|cannot|unable|invalid/i);
  });
});

describe('extractionProgressNote — silence reads as a crash', () => {
  const local = {
    key: 'ollama:llama3.2',
    kind: 'ollama' as const,
    label: 'Ollama',
    note: '',
    model: 'llama3.2',
    local: true,
    needsKey: false,
  };

  it('warns that a local model’s first run takes 5 to 30 seconds', () => {
    const note = extractionProgressNote(local);
    expect(note).toContain('5 to 30 seconds');
    expect(note).toContain('llama3.2');
  });

  it('reassures that nothing leaves the machine on the local path', () => {
    expect(extractionProgressNote(local)).toMatch(/nothing is being sent anywhere/i);
  });

  it('says where the advert is going on a cloud path', () => {
    const note = extractionProgressNote({ ...local, kind: 'anthropic', local: false });
    expect(note).toContain('Anthropic');
  });
});

describe('draftFromExtraction — a null is an empty box, never a guess', () => {
  it('leaves every field blank for an extraction that found nothing', () => {
    const draft = draftFromExtraction(EMPTY_JOB_EXTRACTION, '');

    expect(draft.title).toBe('');
    expect(draft.company).toBe('');
    expect(draft.location).toBe('');
    expect(draft.url).toBe('');
    expect(draft.postedDate).toBe('');
    expect(draft.salaryMin).toBe('');
    expect(draft.salaryMax).toBe('');
    expect(draft.salaryCurrency).toBe('');
  });

  it('never writes a zero where the advert said nothing about pay', () => {
    // `0` and "not stated" are different facts and must look different.
    const draft = draftFromExtraction(extraction({ salary_min: null }), '');
    expect(draft.salaryMin).toBe('');
    expect(draft.salaryMin).not.toBe('0');
  });

  it('boundary: a real zero salary IS shown as 0', () => {
    const draft = draftFromExtraction(extraction({ salary_min: 0, salary_max: 0 }), '');
    expect(draft.salaryMin).toBe('0');
  });

  it('fills in what the extraction did find', () => {
    const draft = draftFromExtraction(
      extraction({
        title: 'Credit Risk Analyst',
        company: 'Lloyds',
        salary_min: 45000,
        salary_max: 55000,
        salary_currency: 'GBP',
        posted_date: '2026-08-18',
        url: 'https://example.invalid/1',
      }),
      '',
    );

    expect(draft).toMatchObject({
      title: 'Credit Risk Analyst',
      company: 'Lloyds',
      salaryMin: '45000',
      salaryMax: '55000',
      salaryCurrency: 'GBP',
      postedDate: '2026-08-18',
      url: 'https://example.invalid/1',
    });
  });

  it('keeps hybrid wording in the location box, word for word', () => {
    const draft = draftFromExtraction(
      extraction({ location: 'City of London (hybrid, 3 days on site)' }),
      '',
    );
    expect(draft.location).toBe('City of London (hybrid, 3 days on site)');
  });

  it('starts the card at "saved" — an advert cannot know whether you applied', () => {
    expect(draftFromExtraction(EMPTY_JOB_EXTRACTION, '').status).toBe('saved');
  });

  it('falls back to the paste when the model returned no description', () => {
    const draft = draftFromExtraction(extraction({ title: 'Analyst' }), 'the whole advert text');
    expect(draft.description).toBe('the whole advert text');
  });

  it('prefers the model’s description when there is one', () => {
    const draft = draftFromExtraction(
      extraction({ description: 'Second-line credit risk.' }),
      'the whole advert text',
    );
    expect(draft.description).toBe('Second-line credit risk.');
  });

  it('produces a draft the validator accepts, apart from the fields the user must fill', () => {
    const errors = validateDraft(
      draftFromExtraction(extraction({ title: 'Analyst', company: 'Lloyds' }), ''),
    );
    expect(errors).toEqual({});
  });
});

describe('draftWithPastedText — nothing the user pasted is lost', () => {
  it('puts the paste in the description and leaves everything else blank', () => {
    const draft = draftWithPastedText('Credit Risk Analyst at Lloyds, £45k-£55k');

    expect(draft.description).toBe('Credit Risk Analyst at Lloyds, £45k-£55k');
    expect(draft.title).toBe('');
    expect(draft.company).toBe('');
    expect(draft.salaryMin).toBe('');
  });

  it('boundary: an empty paste produces a genuinely blank form', () => {
    expect(draftWithPastedText('').description).toBe('');
  });
});

describe('draftFromOutcome — one answer to "what does the user see now"', () => {
  it('shows the extraction when it worked', () => {
    const draft = draftFromOutcome(
      outcome({ extraction: extraction({ title: 'Analyst' }) }),
      'pasted',
    );
    expect(draft.title).toBe('Analyst');
  });

  it('shows a blank form WITH the paste when it did not', () => {
    const draft = draftFromOutcome(
      outcome({ available: false, reason: 'Ollama is not running.' }),
      'the whole advert text',
    );

    expect(draft.title).toBe('');
    expect(draft.company).toBe('');
    expect(draft.salaryMin).toBe('');
    expect(draft.description).toBe('the whole advert text');
  });

  it('never invents a field from a failed outcome, whatever it carries', () => {
    // A failure returns EMPTY_JOB_EXTRACTION, so there is nothing to invent
    // FROM — but a future partial-failure shape must not start leaking either.
    const draft = draftFromOutcome(
      outcome({ available: false, extraction: extraction({ title: 'Guessed' }), reason: 'nope' }),
      'pasted',
    );
    expect(draft.title).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('the address the user typed is never lost', () => {
  /**
   * ==========================================================================
   * THE DEFAULT IS THE EXISTING BEHAVIOUR, EXACTLY
   * ==========================================================================
   * `sourceUrl` is an optional third argument with an empty default, so every
   * call that does not pass one — which is every call the plain paste path
   * makes — behaves precisely as it did before the link box existed. The tests
   * above are the ones that prove that, and they are unchanged.
   */
  it('leaves the link box empty when there was no address', () => {
    expect(draftFromExtraction(EMPTY_JOB_EXTRACTION, 'pasted').url).toBe('');
    expect(draftWithPastedText('pasted').url).toBe('');
    expect(draftFromOutcome(outcome(), 'pasted').url).toBe('');
  });

  it('carries the address into the link box when the model found none', () => {
    // The everyday case for a fetched advert: the page's text almost never
    // contains the page's own address, so without this the one field we know
    // for certain would be the one left blank.
    const draft = draftFromExtraction(
      EMPTY_JOB_EXTRACTION,
      'pasted',
      'https://jobs.example.com/advert/1',
    );

    expect(draft.url).toBe('https://jobs.example.com/advert/1');
  });

  it('prefers the address the model found IN the advert', () => {
    // An advert that names its own application link is naming the one the user
    // should end up with; the address bar is the fallback, not the winner.
    const draft = draftFromExtraction(
      extraction({ url: 'https://jobs.example.com/apply/1' }),
      'pasted',
      'https://jobs.example.com/advert/1',
    );

    expect(draft.url).toBe('https://jobs.example.com/apply/1');
  });

  it('survives a failed extraction, which is when it matters most', () => {
    const draft = draftFromOutcome(
      outcome({ available: false, reason: 'nope' }),
      'the whole advert text',
      'https://jobs.example.com/advert/1',
    );

    expect(draft.url).toBe('https://jobs.example.com/advert/1');
    expect(draft.description).toBe('the whole advert text');
  });

  it('survives "fill it in myself" too', () => {
    expect(draftWithPastedText('pasted', 'https://jobs.example.com/advert/1').url).toBe(
      'https://jobs.example.com/advert/1',
    );
  });

  it('boundary: a whitespace-only address is an empty box, not a space', () => {
    expect(draftFromExtraction(EMPTY_JOB_EXTRACTION, 'pasted', '   ').url).toBe('');
    expect(draftWithPastedText('pasted', '  \n ').url).toBe('');
  });
});
