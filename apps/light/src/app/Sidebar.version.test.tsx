// @vitest-environment jsdom
/**
 * The app's version in the sidebar, under Settings (L-251) — so "which version
 * am I on?" is answered without opening Settings → About.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { APP_VERSION } from '../features/settings/backup';

import { Sidebar } from './Sidebar';

afterEach(() => cleanup());

// APP_VERSION is held to package.json by the backup tests (backup.ts says so).

describe('the version in the sidebar', () => {
  it('shows exactly "CViper Light <APP_VERSION>", the version About shows', () => {
    render(<Sidebar activeView="tracker" onSelect={() => undefined} status={null} />);

    expect(screen.getByTestId('sidebar-version').textContent).toBe(`CViper Light ${APP_VERSION}`);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('sits below the Settings item, and is text — not focusable, not a button', () => {
    render(<Sidebar activeView="tracker" onSelect={() => undefined} status={null} />);

    const version = screen.getByTestId('sidebar-version');
    const settings = screen.getByTestId('nav-settings');
    expect(settings.compareDocumentPosition(version) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(version.tagName).toBe('P');
    expect(version.hasAttribute('tabindex')).toBe(false);
    expect(version.querySelector('button, a, [tabindex]')).toBeNull();
  });
});
