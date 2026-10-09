// @vitest-environment jsdom
/**
 * The crash safety net (L-226).
 *
 * There was no error boundary anywhere: one exception thrown while rendering
 * unmounted the whole tree and left a blank window, with nothing to press and
 * no hint that the data was still on disk. The boundary turns that into a
 * screen that says what happened and offers a way back.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';

let shouldThrow = true;
function Fragile() {
  if (shouldThrow) throw new Error('a render bug');
  return <p>The app, working</p>;
}

beforeEach(() => {
  shouldThrow = true;
  // React logs every caught render error; the noise is expected here.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a render error', () => {
  it('shows a recovery screen instead of a blank window', () => {
    render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeTruthy();
    expect(screen.getByText(/your data is safe/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /reload/i })).toBeTruthy();
  });

  it('never puts the error message on screen', () => {
    // An exception message can carry whatever text was being rendered — a
    // line of a CV, an advert — and a screenshot of this page is what gets
    // pasted into a public issue.
    render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    );
    expect(screen.queryByText(/a render bug/)).toBeNull();
  });

  it('"Try again" renders the app again once the fault is gone', () => {
    render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    );
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.getByText('The app, working')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('boundary: a fault that is still there is caught again, not left blank', () => {
    render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('"Reload" reloads the window', () => {
    const reload = vi.fn();
    render(
      <ErrorBoundary onReload={reload}>
        <Fragile />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe('no error', () => {
  it('renders its children untouched', () => {
    shouldThrow = false;
    render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    );
    expect(screen.getByText('The app, working')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the whole app is inside it', () => {
  it('main.tsx renders <App /> within the boundary', () => {
    const main = readFileSync(join(import.meta.dirname, '..', 'main.tsx'), 'utf8');
    expect(main).toMatch(/<ErrorBoundary>\s*<App \/>\s*<\/ErrorBoundary>/);
  });
});
