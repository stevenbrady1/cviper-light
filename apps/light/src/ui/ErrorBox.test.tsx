// @vitest-environment jsdom
/**
 * The one error box (L-368). About twenty error messages were each built by
 * hand, in two shapes: a strip under a screen's header, and a box inside a
 * panel. They drifted — Profile's strip had a grey bottom line where the
 * others had a red-tinted one.
 *
 * Classes are asserted here on purpose, as in `ui.test.tsx`: these strings ARE
 * the look, and jsdom resolves no stylesheet, so this is the only place the
 * look can be pinned. They are written out as literals, NOT imported from the
 * component — a test that imported them would agree with any change.
 *
 * The screens' own tests still run unedited: they are the proof that moving
 * onto the shared part changed nothing a user can see or do.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorBox } from './ErrorBox';

afterEach(() => {
  cleanup();
});

/**
 * What the hand-built strips on Analysis, Tailor and Tracker carried on 11 Nov
 * 2026, plus `break-words` (L-374): a word too long for a line breaks.
 */
const STRIP = 'border-b border-danger/30 bg-danger/5 px-4 py-2 break-words text-danger md:px-6';
/** Tracker's two strips: the same strip, laid out as a row so Retry sits at the end. */
const STRIP_ROW = `flex items-center justify-between gap-3 ${STRIP}`;
/** What the hand-built boxes inside panels carry, plus `break-words` (L-374). */
const BOX = 'rounded-control bg-danger/5 px-3 py-2 break-words text-danger';

/** Anything that forces a sentence onto one line, or the box to a fixed width. */
const CLIPPING = /\b(truncate|text-ellipsis|whitespace-nowrap|line-clamp-1|(min-)?w-\S+)\b/;

describe('ErrorBox — each shape draws exactly what the hand-built ones did', () => {
  it('a strip is a paragraph with the strip classes, class for class', () => {
    render(
      <ErrorBox variant="strip" testId="some-error">
        It could not be saved.
      </ErrorBox>,
    );
    const strip = screen.getByTestId('some-error');
    expect(strip.tagName).toBe('P');
    expect(strip.className).toBe(STRIP);
    expect(strip.textContent).toBe('It could not be saved.');
  });

  it('a row strip is a div with the row classes, and the children as given', () => {
    render(
      <ErrorBox variant="strip" layout="row" testId="row-error">
        <span>It could not be read.</span>
      </ErrorBox>,
    );
    const strip = screen.getByTestId('row-error');
    expect(strip.tagName).toBe('DIV');
    expect(strip.className).toBe(STRIP_ROW);
    expect(strip.innerHTML).toBe('<span>It could not be read.</span>');
  });

  it('a box is a paragraph with the box classes, and no space above by default', () => {
    render(
      <ErrorBox variant="box" testId="box-error">
        That did not work.
      </ErrorBox>,
    );
    const box = screen.getByTestId('box-error');
    expect(box.tagName).toBe('P');
    expect(box.className).toBe(BOX);
  });

  it('a box takes the space above it that the hand-built ones carry, first', () => {
    render(
      <>
        <ErrorBox variant="box" gapAbove="mt-2" testId="box-2">
          a
        </ErrorBox>
        <ErrorBox variant="box" gapAbove="mt-3" testId="box-3">
          b
        </ErrorBox>
      </>,
    );
    expect(screen.getByTestId('box-2').className).toBe(`mt-2 ${BOX}`);
    expect(screen.getByTestId('box-3').className).toBe(`mt-3 ${BOX}`);
  });

  it('no shape carries the grey bottom line Profile used to have', () => {
    render(
      <>
        <ErrorBox variant="strip" testId="a">
          a
        </ErrorBox>
        <ErrorBox variant="strip" layout="row" testId="b">
          b
        </ErrorBox>
        <ErrorBox variant="box" testId="c">
          c
        </ErrorBox>
      </>,
    );
    for (const id of ['a', 'b', 'c']) {
      expect(screen.getByTestId(id).className.split(' '), id).not.toContain('border-line');
    }
  });
});

describe('ErrorBox — it is always an alert', () => {
  it('every shape is announced as an alert', () => {
    render(
      <>
        <ErrorBox variant="strip" testId="a">
          a
        </ErrorBox>
        <ErrorBox variant="strip" layout="row" testId="b">
          b
        </ErrorBox>
        <ErrorBox variant="box" gapAbove="mt-3" testId="c">
          c
        </ErrorBox>
      </>,
    );
    expect(screen.getAllByRole('alert').map((el) => el.dataset['testid'])).toEqual(['a', 'b', 'c']);
  });

  it('NEGATIVE: a caller cannot change or remove the role, or restyle it', () => {
    // Not props at all — the type refuses them...
    const typed = (
      // @ts-expect-error `role` is not something a caller can pass.
      <ErrorBox variant="strip" testId="typed" role="status">
        x
      </ErrorBox>
    );
    // ...and if one is forced through anyway, it is dropped, not spread.
    const forced = { role: 'presentation', 'aria-live': 'off', className: 'hidden', hidden: true };
    render(
      <>
        {typed}
        <ErrorBox variant="box" testId="forced" {...(forced as object)}>
          y
        </ErrorBox>
      </>,
    );

    const first = screen.getByTestId('typed');
    expect(first.getAttribute('role')).toBe('alert');
    expect(first.className).toBe(STRIP);

    const second = screen.getByTestId('forced');
    expect(second.getAttribute('role')).toBe('alert');
    expect(second.hasAttribute('aria-live')).toBe(false);
    expect(second.hasAttribute('hidden')).toBe(false);
    expect(second.className).toBe(BOX);
  });

  it('BOUNDARY: two on one screen are two alerts, each with its own test id', () => {
    render(
      <>
        <ErrorBox variant="strip" layout="row" testId="tracker-error">
          <span>The board could not be read.</span>
        </ErrorBox>
        <ErrorBox variant="strip" layout="row" testId="tracker-substages-error">
          <span>Your interview stages could not be read.</span>
        </ErrorBox>
      </>,
    );
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toBe(screen.getByTestId('tracker-error'));
    expect(alerts[1]).toBe(screen.getByTestId('tracker-substages-error'));
  });

  it('BOUNDARY: empty children still draw one alert, exactly as the hand-built ones did', () => {
    // The screens decide whether there is an error to show (`error === null ?
    // null : …`). An empty message was drawn before, so it still is: a refactor
    // is not the place to change what the screens draw.
    render(
      <ErrorBox variant="strip" testId="empty">
        {''}
      </ErrorBox>,
    );
    const empty = screen.getByRole('alert');
    expect(empty).toBe(screen.getByTestId('empty'));
    expect(empty.textContent).toBe('');
    expect(empty.className).toBe(STRIP);
  });
});

describe('ErrorBox — what goes inside', () => {
  it('a button inside works: the click reaches its handler', async () => {
    const onRetry = vi.fn();
    render(
      <ErrorBox variant="strip" layout="row" testId="with-retry">
        <span>The board could not be read.</span>
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      </ErrorBox>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').contains(screen.getByRole('button', { name: 'Retry' }))).toBe(
      true,
    );
  });

  it('BOUNDARY: a very long message is kept whole and nothing forces it onto one line or a width', () => {
    // jsdom does no layout, so — as in `styles/prose-clipping.contract.test.ts`
    // — this checks the CLASSES a browser would lay out, not pixels. In a
    // 375px window each shape is a block (or a row whose message is a plain
    // span) with no width of its own, so it takes the column's width and a
    // long sentence wraps inside it.
    const long = 'The file could not be saved to the folder you picked. '.repeat(40).trim();
    render(
      <div data-testid="phone-column">
        <ErrorBox variant="strip" testId="s">
          {long}
        </ErrorBox>
        <ErrorBox variant="strip" layout="row" testId="r">
          <span>{long}</span>
        </ErrorBox>
        <ErrorBox variant="box" gapAbove="mt-2" testId="b">
          {long}
        </ErrorBox>
      </div>,
    );
    for (const id of ['s', 'r', 'b']) {
      const el = screen.getByTestId(id);
      expect(el.textContent, id).toBe(long);
      expect(el.className, id).not.toMatch(CLIPPING);
      expect(el.getAttribute('style'), id).toBeNull();
    }
  });

  // An UNBROKEN token — a file path or web address with no spaces — used to run
  // off the edge: none of the strips or boxes carried `break-words` (L-374).
  // jsdom cannot measure it, so this pins the class; the WebKit job measures
  // the real layout at 375px and 1000px (`e2e/contrast-webkit.spec.ts`).
  it('a very long UNBROKEN message breaks: every shape carries `break-words` (L-374)', () => {
    const path = `C:\\Users\\someone\\AppData\\Roaming\\com.cviper.light\\${'NestedFolder\\'.repeat(12)}cviper.json`;
    render(
      <>
        <ErrorBox variant="strip" testId="s">
          {path}
        </ErrorBox>
        <ErrorBox variant="strip" layout="row" testId="r">
          <span className="min-w-0">{path}</span>
        </ErrorBox>
        <ErrorBox variant="box" testId="b">
          {path}
        </ErrorBox>
        <ErrorBox variant="box" gapAbove="mt-3" testId="g">
          {path}
        </ErrorBox>
      </>,
    );
    for (const id of ['s', 'r', 'b', 'g']) {
      const classes = screen.getByTestId(id).className.split(' ');
      expect(classes, id).toContain('break-words');
      // Only a word too long for its line breaks: never mid-word in a sentence
      // (`break-all`), and the text is never clipped instead.
      expect(classes, id).not.toContain('break-all');
      expect(screen.getByTestId(id).className, id).not.toMatch(CLIPPING);
      expect(screen.getByTestId(id).textContent, id).toBe(path);
    }
  });
});

/**
 * L-377: the boxes inside Settings, job boards, CV upload and the CV pickers
 * move onto the `box` shape. Two of them hold more than one block — Settings'
 * notice (two paragraphs) and Erase everything's failure (a paragraph and a
 * list) — and a `<p>` cannot hold a `<ul>` or another `<p>`. So the box can be
 * drawn as a `div`: `as="div"`. Nothing else about it changes.
 */
describe('ErrorBox — a box that holds more than one block (L-377)', () => {
  it('as="div" is a div with the box classes, and the blocks as given', () => {
    render(
      <ErrorBox variant="box" as="div" testId="block-box">
        <p className="font-medium">Some of it could not be removed.</p>
        <ul className="mt-1 list-disc pl-5 text-ink-muted">
          <li>The CV folder</li>
          <li>The saved keys</li>
        </ul>
      </ErrorBox>,
    );
    const box = screen.getByTestId('block-box');
    expect(box.tagName).toBe('DIV');
    expect(box.className).toBe(BOX);
    expect(box.innerHTML).toBe(
      '<p class="font-medium">Some of it could not be removed.</p>' +
        '<ul class="mt-1 list-disc pl-5 text-ink-muted"><li>The CV folder</li><li>The saved keys</li></ul>',
    );
  });

  it('two paragraphs, with the space above first, as Settings and Erase everything carry it', () => {
    render(
      <>
        <ErrorBox variant="box" as="div" testId="two-paragraphs">
          <p className="font-medium">That file could not be read.</p>
          <p className="mt-1 whitespace-pre-line text-ink-muted">It is not a CViper backup.</p>
        </ErrorBox>
        <ErrorBox variant="box" as="div" gapAbove="mt-3" testId="spaced">
          <p>a</p>
        </ErrorBox>
      </>,
    );
    const two = screen.getByTestId('two-paragraphs');
    expect(two.className).toBe(BOX);
    expect([...two.children].map((child) => child.tagName)).toEqual(['P', 'P']);
    expect(screen.getByTestId('spaced').className).toBe(`mt-3 ${BOX}`);
  });

  it('as="p" is the paragraph it always was', () => {
    render(
      <ErrorBox variant="box" as="p" gapAbove="mt-2" testId="text-box">
        That did not work.
      </ErrorBox>,
    );
    const box = screen.getByTestId('text-box');
    expect(box.tagName).toBe('P');
    expect(box.className).toBe(`mt-2 ${BOX}`);
  });

  it('the div form is still always an alert, with its own test id', () => {
    render(
      <>
        <ErrorBox variant="box" as="div" testId="settings-problem">
          <p>a</p>
        </ErrorBox>
        <ErrorBox variant="box" as="div" gapAbove="mt-3" testId="settings-erase-problem">
          <p>b</p>
        </ErrorBox>
      </>,
    );
    expect(screen.getAllByRole('alert').map((el) => el.dataset['testid'])).toEqual([
      'settings-problem',
      'settings-erase-problem',
    ]);
  });

  it('NEGATIVE: only a p or a div, only on a box, and the role still cannot be changed', () => {
    const typed = (
      <>
        {/* @ts-expect-error a box is a `p` or a `div`, nothing else. */}
        <ErrorBox variant="box" as="section" testId="section">
          x
        </ErrorBox>
        {/* @ts-expect-error `as` belongs to the box; a strip is drawn by `layout`. */}
        <ErrorBox variant="strip" as="div" testId="strip-as">
          y
        </ErrorBox>
      </>
    );
    // Forced through anyway: anything but "div" draws the paragraph, and
    // nothing else that is forced through reaches the element.
    const forced = {
      as: 'span',
      role: 'presentation',
      'aria-live': 'off',
      className: 'hidden',
      hidden: true,
    };
    const forcedDiv = { role: 'status', className: 'border border-danger/30', id: 'x' };
    render(
      <>
        {typed}
        <ErrorBox variant="box" testId="forced" {...(forced as object)}>
          z
        </ErrorBox>
        <ErrorBox variant="box" as="div" testId="forced-div" {...(forcedDiv as object)}>
          <p>w</p>
        </ErrorBox>
      </>,
    );

    expect(screen.getByTestId('section').tagName).toBe('P');
    expect(screen.getByTestId('strip-as').tagName).toBe('P');
    expect(screen.getByTestId('strip-as').className).toBe(STRIP);

    const forcedP = screen.getByTestId('forced');
    expect(forcedP.tagName).toBe('P');
    expect(forcedP.getAttribute('role')).toBe('alert');
    expect(forcedP.hasAttribute('aria-live')).toBe(false);
    expect(forcedP.hasAttribute('hidden')).toBe(false);
    expect(forcedP.className).toBe(BOX);

    const div = screen.getByTestId('forced-div');
    expect(div.tagName).toBe('DIV');
    expect(div.getAttribute('role')).toBe('alert');
    expect(div.hasAttribute('id')).toBe(false);
    expect(div.className).toBe(BOX);
  });

  it('BOUNDARY: empty children in the div form still draw one alert', () => {
    render(
      <ErrorBox variant="box" as="div" gapAbove="mt-3" testId="empty-div">
        {''}
      </ErrorBox>,
    );
    const empty = screen.getByRole('alert');
    expect(empty).toBe(screen.getByTestId('empty-div'));
    expect(empty.tagName).toBe('DIV');
    expect(empty.textContent).toBe('');
    expect(empty.className).toBe(`mt-3 ${BOX}`);
  });

  it('a button inside the div form works: the click reaches its handler', async () => {
    const onRetry = vi.fn();
    render(
      <ErrorBox variant="box" as="div" testId="div-with-button">
        <p>The file could not be read.</p>
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      </ErrorBox>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('alert').contains(screen.getByRole('button', { name: 'Try again' })),
    ).toBe(true);
  });

  it('a long UNBROKEN path in the div form breaks too, and nothing clips it', () => {
    const path = `C:\\Users\\someone\\AppData\\Roaming\\com.cviper.light\\${'NestedFolder\\'.repeat(12)}cviper.json`;
    render(
      <ErrorBox variant="box" as="div" gapAbove="mt-3" testId="div-path">
        <p className="font-medium">Some of it could not be removed.</p>
        <ul className="mt-1 list-disc pl-5 text-ink-muted">
          <li>{path}</li>
        </ul>
      </ErrorBox>,
    );
    const box = screen.getByTestId('div-path');
    const classes = box.className.split(' ');
    // `overflow-wrap` is inherited, so the paragraph and the list inside break too.
    expect(classes).toContain('break-words');
    expect(classes).not.toContain('break-all');
    expect(box.className).not.toMatch(CLIPPING);
    expect(box.textContent).toBe(`Some of it could not be removed.${path}`);
  });
});
