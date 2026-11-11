import { IconTile } from '../../ui';

import { AddApplicationButton, PasteJobButton } from './TrackerButtons';

/**
 * The empty board.
 *
 * An invitation, not an apology. It does not say "no applications found" — it
 * says what this screen is for and offers the actions that make it useful, with
 * the reassurance that matters most here: this works with nothing set up.
 */
export function EmptyBoard({
  onAdd,
  onPaste,
  disabled,
}: {
  onAdd: () => void;
  onPaste: () => void;
  disabled: boolean;
}) {
  return (
    <div
      data-testid="tracker-empty"
      className="flex h-full items-center justify-center rounded-card border border-line border-dashed bg-card"
    >
      <div className="max-w-sm px-6 text-center">
        <div className="mb-3 flex justify-center">
          <IconTile icon="tracker" />
        </div>
        <p className="font-medium text-ink">Start with the last job you applied to.</p>
        <p className="mt-1 text-ink-muted">
          The board keeps every application in one place and shows you which ones have gone quiet.
          It needs no account and no set-up.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <AddApplicationButton testId="tracker-empty-add" disabled={disabled} onClick={onAdd} />
          <PasteJobButton testId="tracker-empty-paste" disabled={disabled} onClick={onPaste} />
        </div>
      </div>
    </div>
  );
}
