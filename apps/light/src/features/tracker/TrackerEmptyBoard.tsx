import { EmptyState } from '../../ui';

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
    <div className="flex h-full items-center justify-center">
      <div className="max-w-sm">
        <EmptyState
          testId="tracker-empty"
          icon="tracker"
          title="Start with the last job you applied to."
          body="The board keeps every application in one place and shows you which ones have gone quiet. It needs no account and no set-up."
          action={
            <div className="flex items-center justify-center gap-2">
              <AddApplicationButton
                testId="tracker-empty-add"
                disabled={disabled}
                onClick={onAdd}
              />
              <PasteJobButton testId="tracker-empty-paste" disabled={disabled} onClick={onPaste} />
            </div>
          }
        />
      </div>
    </div>
  );
}
