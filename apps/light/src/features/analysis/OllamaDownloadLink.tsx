import { useCallback, useState } from 'react';

import { type BrowserPort } from '../../platform/browser';

import { OLLAMA_DOWNLOAD_URL } from './providers';

/**
 * The link beside the Ollama hint (L-240): Ollama's download page, opened in
 * the user's own browser through `BrowserPort` — the same way every other
 * outside page in this app opens. The app never loads the page itself.
 *
 * Drawn only where the hint already speaks (Ollama running with no chat model
 * — `ollamaNeedsChatModel`), never on a machine without Ollama: an "install
 * Ollama" link on every launch is the advert `providers.ts` decided against.
 *
 * A browser that will not open is said out loud, not swallowed: a link that
 * silently does nothing is a dead end.
 */
export interface OllamaDownloadLinkProps {
  /** Prefixes the `data-testid`s: `<prefix>-ollama-link`, `<prefix>-ollama-link-problem`. */
  readonly idPrefix: string;
  readonly browser: BrowserPort;
}

export function OllamaDownloadLink({ idPrefix, browser }: OllamaDownloadLinkProps) {
  const [problem, setProblem] = useState<string | null>(null);

  const onOpen = useCallback(async () => {
    setProblem(null);
    const opened = await browser.open(OLLAMA_DOWNLOAD_URL);
    if (!opened.ok) setProblem(opened.error.message);
  }, [browser]);

  return (
    <span className="mt-1 block">
      <button
        type="button"
        data-testid={`${idPrefix}-ollama-link`}
        onClick={() => void onOpen()}
        className="min-h-11 text-left font-medium underline underline-offset-2 hover:no-underline md:min-h-0"
      >
        Open Ollama’s download page
      </button>
      <span className="ml-2">Opens in your browser.</span>
      {problem === null ? null : (
        <span
          role="alert"
          data-testid={`${idPrefix}-ollama-link-problem`}
          className="mt-1 block text-danger"
        >
          {problem}
        </span>
      )}
    </span>
  );
}
