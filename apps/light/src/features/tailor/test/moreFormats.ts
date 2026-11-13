import { screen } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';

/**
 * Open the "More formats" menu (L-400). Its items — Save as Word…, Save as
 * text… — are only drawn while it is open, as a user only sees them then.
 */
export async function openMoreFormats(user: UserEvent): Promise<void> {
  await user.click(screen.getByTestId('tailor-save-more'));
}
