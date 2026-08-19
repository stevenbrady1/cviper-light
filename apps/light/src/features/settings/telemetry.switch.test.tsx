// @vitest-environment jsdom
/**
 * The telemetry switch, as the user meets it.
 *
 * `telemetry.contract.test.ts` proves nothing reads the flag. This proves the
 * user can SEE that, which is the half that changes whether anybody believes
 * the claim.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { Settings } from './Settings';
import { createFakeBackupPort } from './test/fakePort';
import { createFakeKeyPort } from './keys/test/fakeKeyPort';
import { createFakeUpdatePort } from './updates/test/fakeUpdatePort';

function renderSettings() {
  return render(
    <Settings
      port={createFakeBackupPort()}
      keyPort={createFakeKeyPort()}
      updatePort={createFakeUpdatePort()}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe('the telemetry switch', () => {
  it('is off', async () => {
    renderSettings();
    expect(await screen.findByTestId('settings-telemetry')).toHaveProperty('checked', false);
  });

  it('is disabled, because there is nothing behind it to switch on', async () => {
    renderSettings();
    expect(await screen.findByTestId('settings-telemetry')).toHaveProperty('disabled', true);
  });

  it('says it is not implemented and that no data is sent', async () => {
    renderSettings();

    const label = (await screen.findByTestId('settings-telemetry-note')).textContent ?? '';
    expect(label).toContain('not implemented');
    expect(label).toContain('sends no data');
  });

  it('negative: clicking it changes nothing', async () => {
    // The switch is a statement, not a control. A disabled input that could
    // still be toggled by a click would be the one thing on this screen that
    // lies about itself.
    const user = userEvent.setup();
    renderSettings();

    const box = await screen.findByTestId('settings-telemetry');
    await user.click(box);

    expect(box).toHaveProperty('checked', false);
  });
});
