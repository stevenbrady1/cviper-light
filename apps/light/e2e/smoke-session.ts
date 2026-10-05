/**
 * L-206: create the WebDriver session, waiting for the app's window to exist.
 *
 * An open WebDriver port only proves the server is up. The window is created a
 * moment later, and a session request in that gap fails with
 * `NoSuchWindowError: No window could be found` (smoke run 37291738820: the app
 * had not crashed, setup died ~10s in and all nine tests were cancelled).
 *
 * Only that one error is retried, and only until a finite deadline. Anything else
 * is a real failure and surfaces at once.
 */

export interface SessionWaitOptions<T> {
  create: () => Promise<T>;
  timeoutMs: number;
  intervalMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function isNoSuchWindow(error: unknown): boolean {
  return error instanceof Error && error.name === 'NoSuchWindowError';
}

export async function createSessionWhenWindowReady<T>(options: SessionWaitOptions<T>): Promise<T> {
  const { create, timeoutMs, intervalMs } = options;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + timeoutMs;

  for (;;) {
    try {
      return await create();
    } catch (error) {
      if (!isNoSuchWindow(error)) throw error;
      if (now() + intervalMs > deadline) {
        const last = error instanceof Error ? error.message : String(error);
        throw new Error(
          `The app's window never appeared within ${timeoutMs}ms of the WebDriver server ` +
            `listening. Last error: NoSuchWindowError: ${last}`,
          { cause: error },
        );
      }
      await sleep(intervalMs);
    }
  }
}
