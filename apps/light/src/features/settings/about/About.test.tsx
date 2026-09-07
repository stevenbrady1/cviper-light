// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeBrowserPort } from '../../../platform/test/fakeBrowserPort';
import { LIGHT_PAGE_URL, LIGHT_SOURCE_URL } from '../../signposts/links';
import { APP_VERSION } from '../backup';

import { About } from './About';

afterEach(cleanup);

describe('About', () => {
  it('says who made Light, that it is free and MIT-licensed, and which version this is', () => {
    render(<About browser={createFakeBrowserPort()} />);
    const about = screen.getByTestId('settings-about');
    expect(about.textContent).toMatch(/Made by the people behind cviper\.ai/);
    expect(about.textContent).toMatch(/free/);
    expect(about.textContent).toMatch(/MIT/);
    expect(screen.getByTestId('about-version').textContent).toContain(APP_VERSION);
  });

  it('happy: the site link opens exactly the Light page, and nothing else', () => {
    const browser = createFakeBrowserPort();
    render(<About browser={browser} />);
    fireEvent.click(screen.getByTestId('about-open-site'));
    expect(browser.opened()).toEqual([LIGHT_PAGE_URL]);
  });

  it('happy: the source link opens exactly the public repository', () => {
    const browser = createFakeBrowserPort();
    render(<About browser={browser} />);
    fireEvent.click(screen.getByTestId('about-open-source'));
    expect(browser.opened()).toEqual([LIGHT_SOURCE_URL]);
  });

  it('negative: rendering opens nothing, and there is no primary button here', () => {
    const browser = createFakeBrowserPort();
    render(<About browser={browser} />);
    expect(browser.opened()).toEqual([]);
    expect(screen.getByTestId('settings-about').querySelector('[data-primary="true"]')).toBeNull();
  });
});
