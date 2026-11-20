// @vitest-environment jsdom
/**
 * The shared parts of the "one sentence of choices above one big box" layout
 * (L-442): the chip drop-down and the composer box. No screen uses them yet;
 * the Analysis and Tailor layouts that follow do.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChipSelect } from './ChipSelect';
import { Composer } from './Composer';
import { COMPOSER_BAR, COMPOSER_EDITOR, FIELD_CHIP } from './fields';

afterEach(cleanup);

const CVS = [
  { value: 'cv-1', label: 'Alex_Morgan_Sample_CV.json' },
  { value: 'cv-2', label: 'Second CV.pdf' },
];

function chip(overrides: Partial<Parameters<typeof ChipSelect>[0]> = {}) {
  return render(
    <ChipSelect
      id="chip-cv"
      name="Your CV"
      testId="chip-cv"
      value="cv-1"
      options={CVS}
      onChange={vi.fn()}
      {...overrides}
    />,
  );
}

function classesOf(element: Element): string[] {
  return element.className.split(/\s+/).filter((name) => name !== '');
}

describe('ChipSelect: a real drop-down that looks like a chip (L-442)', () => {
  it('happy: it is named by its hidden label and shows the chosen item', () => {
    chip();
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Your CV' });
    expect(select).toBe(screen.getByTestId('chip-cv'));
    expect(select.tagName).toBe('SELECT');
    expect(select.value).toBe('cv-1');
    expect(select.selectedOptions[0]?.textContent).toBe('Alex_Morgan_Sample_CV.json');
    // The name is spoken, not shown.
    const label = document.querySelector('label[for="chip-cv"]');
    expect(label?.textContent).toBe('Your CV');
    expect(classesOf(label!)).toContain('sr-only');
  });

  it('happy: it wears the chip style, and the drawn chevron is hidden and cannot be pressed', () => {
    chip();
    const select = screen.getByTestId('chip-cv');
    for (const cls of FIELD_CHIP.split(' ')) expect(classesOf(select)).toContain(cls);
    const mark = select.parentElement?.querySelector('span[aria-hidden="true"]');
    expect(mark?.querySelector('svg')).not.toBeNull();
    expect(classesOf(mark as Element)).toContain('pointer-events-none');
    // Turned to point down, as Search's fold mark is (L-437).
    expect(classesOf(mark as Element)).toContain('rotate-90');
  });

  it('happy: at least 44px tall below md, like the buttons, and its natural height above', () => {
    chip();
    const select = screen.getByTestId('chip-cv');
    expect(classesOf(select)).toEqual(expect.arrayContaining(['min-h-11', 'md:min-h-0']));
  });

  it('interaction: choosing an item calls onChange with its value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    chip({ onChange });
    await user.selectOptions(screen.getByTestId('chip-cv'), 'cv-2');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('cv-2');
  });

  it('negative: disabled draws it greyed, never hidden, and choosing does nothing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    chip({ disabled: true, onChange });
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Your CV' });
    expect(select.disabled).toBe(true);
    expect(select.hidden).toBe(false);
    expect(classesOf(select)).toEqual(
      expect.arrayContaining(['disabled:bg-line', 'disabled:text-ink-faint']),
    );
    await user.selectOptions(select, 'cv-2').catch(() => undefined);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('boundary: a 200-character item keeps the chip within its row', () => {
    const long = 'A'.repeat(200);
    chip({ options: [{ value: 'long', label: long }], value: 'long' });
    const select = screen.getByTestId<HTMLSelectElement>('chip-cv');
    expect(select.selectedOptions[0]?.textContent).toBe(long);
    expect(classesOf(select)).toEqual(expect.arrayContaining(['min-w-0', 'max-w-full']));
    expect(classesOf(select.parentElement!)).toEqual(
      expect.arrayContaining(['min-w-0', 'max-w-full']),
    );
  });

  it('boundary: the empty option comes first, with value ""', () => {
    chip({ empty: 'Or use one you are already tracking', value: '' });
    const select = screen.getByTestId<HTMLSelectElement>('chip-cv');
    const first = select.options[0]!;
    expect(first.value).toBe('');
    expect(first.textContent).toBe('Or use one you are already tracking');
    expect(select.options).toHaveLength(3);
    expect(select.value).toBe('');
  });

  it('boundary: with no empty option and no items, it draws an empty drop-down, still named', () => {
    chip({ options: [], value: '' });
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Your CV' });
    expect(select.options).toHaveLength(0);
  });
});

describe('Composer: the chip row, the box and the notes under it (L-442)', () => {
  function full() {
    return render(
      <Composer
        testId="composer"
        sentence={<span data-testid="s">Check …</span>}
        notices={<p data-testid="n">A notice</p>}
        editor={
          <textarea data-testid="e" aria-label="The job advert" className={COMPOSER_EDITOR} />
        }
        barStart={<span data-testid="bs">tracked</span>}
        barEnd={<button type="button">Check this CV</button>}
        footnotes={<p data-testid="f">A footnote</p>}
      />,
    );
  }

  it('happy: the slots come in order: sentence, notices, editor, bar (start then end), footnotes', () => {
    full();
    const order = ['s', 'n', 'e', 'bs']
      .map((id) => screen.getByTestId(id))
      .concat(screen.getByRole('button', { name: 'Check this CV' }), screen.getByTestId('f'));
    for (let i = 1; i < order.length; i += 1) {
      const before = order[i - 1]!;
      const after = order[i]!;
      expect(
        before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING,
        `${before.textContent ?? ''} before ${after.textContent ?? ''}`,
      ).toBeTruthy();
    }
  });

  it('happy: the bar wears the bar style and sits right under the editor, in one box', () => {
    full();
    const bar = screen.getByTestId('composer-bar');
    for (const cls of COMPOSER_BAR.split(' ')) expect(classesOf(bar)).toContain(cls);
    expect(screen.getByTestId('e').nextElementSibling).toBe(bar);
    // It wraps on a phone rather than pushing past the box.
    expect(classesOf(bar)).toContain('flex-wrap');
  });

  it('boundary: an empty slot leaves no empty box', () => {
    render(
      <Composer
        testId="composer"
        sentence={null}
        notices={false}
        editor={<textarea aria-label="The job advert" className={COMPOSER_EDITOR} />}
        barEnd={<button type="button">Check this CV</button>}
      />,
    );
    const root = screen.getByTestId('composer');
    for (const slot of ['sentence', 'notices', 'bar-start', 'footnotes']) {
      expect(root.querySelector(`[data-slot="${slot}"]`), slot).toBeNull();
    }
    const empty = [...root.querySelectorAll('*')].filter(
      (element) => element.childNodes.length === 0 && element.tagName !== 'TEXTAREA',
    );
    expect(empty).toEqual([]);
    // The end slot still sits at the right of the bar.
    expect(screen.getByTestId('composer-bar').contains(screen.getByRole('button'))).toBe(true);
  });

  it('boundary: barEnd comes after barStart even when both are present', () => {
    full();
    const start = screen.getByTestId('bs').closest('[data-slot="bar-start"]');
    const end = screen
      .getByRole('button', { name: 'Check this CV' })
      .closest('[data-slot="bar-end"]');
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    expect(start!.nextElementSibling).toBe(end);
  });
});
