/**
 * The words a screen reader should hear when a status message appears (L-299).
 *
 * Screen readers announce CHANGES to a live region that is already on the
 * page. A visible message rendered only when it has something to say arrives
 * with its words in the same instant, and whether it is read out then depends
 * on the screen reader and the browser (WCAG 4.1.3). So the visible message
 * keeps its look and carries no role, and this region — always rendered,
 * visually hidden — is where the words are written.
 *
 * The text is keyed, so a new message is a new node: the same rule
 * `SubstageEditor` uses for its own announcements.
 *
 * Place it anywhere but last in a `space-y-*` container: `sr-only` is
 * absolutely positioned, so it takes no room, but being the last child would
 * give the real last child a bottom margin it did not have.
 */
export function LiveStatus({ text, testId }: { text: string | null; testId?: string }) {
  return (
    <p role="status" data-testid={testId} className="sr-only">
      <span key={text ?? ''}>{text ?? ''}</span>
    </p>
  );
}
