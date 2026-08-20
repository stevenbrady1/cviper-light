/**
 * extract-json.ts — the JSON repair ladder.
 *
 * PORTED FROM: backend/ai/gateway.py  (CViper repo, @ 52af65a2)
 *   `strip_code_fences`
 *   `safe_parse_json`
 *   `extract_json`
 *
 * Upstream drift is pinned in CViper's `docs/port-parity-manifest.yaml`; its
 * guard fails there when this source changes. Symbols are named rather than
 * line numbers, which decay on the next edit upstream.
 *
 * WHY THIS MATTERS MORE HERE THAN IT DID THERE: the source docstring says the
 * repair ladder exists for "malformed responses from local models" — trailing
 * commas are called out as "common in Ollama output" and C-style comments as
 * "added by some quantized models". CViper Light's default path is a local
 * quantised model, so this ladder is the hot path, not the safety net.
 *
 * DELIBERATELY CHANGED FROM THE SOURCE
 *  1. Returns a discriminated union instead of throwing.
 *  2. All server-side logging/telemetry removed. The failure CLASS survives
 *     because the classes warrant different user advice; only the transport is
 *     gone.
 *  3. The user-facing messages are retargeted at a local daemon rather than a
 *     cloud provider's rate limiter.
 *  4. The unquoted-key regex avoids JS lookbehind (unsupported in the older
 *     WebKit a Tauri build hits on macOS/Linux).
 *  5. NEW THIRD FAILURE CLASS: 'truncated'. See `looksTruncated` below — this
 *     closes the port's `TODO(verify)`.
 *
 * NOT CHANGED: the order of repair steps, the regexes' semantics, and the fact
 * that rung 2 re-strips trailing commas on the extracted snippet.
 */

/** Which repair rung produced the value — useful for eval telemetry. */
export type RepairStrategy =
  | 'clean' // parsed as-is, no repair needed
  | 'regex-repairs' // trailing commas + line comments + unquoted keys
  | 'substring'; // sliced between the first '{' and the last '}'

/**
 * The failure classes, kept apart because they need DIFFERENT user advice.
 *
 *  - 'empty-response': the model produced nothing at all. Nothing the user can
 *    rephrase — retry, or the daemon/model is wrong.
 *  - 'not-json': the model wrote prose or markdown instead of JSON. Usually a
 *    too-small model ignoring the format instruction — swap the model.
 *  - 'truncated': the model started JSON correctly and was CUT OFF. The source
 *    caught this upstream with a `TruncatedResponseError` we do not have, so
 *    without this class a token-capped reply lands in 'not-json' and sends the
 *    user off to change model when the real fix is a bigger output budget or a
 *    shorter CV.
 */
export type JsonFailureKind = 'empty-response' | 'not-json' | 'truncated';

export type JsonParseFailure = {
  readonly ok: false;
  readonly failure: JsonFailureKind;
  /** Advice safe to show the user verbatim. */
  readonly message: string;
  /** First 200 chars, newlines flattened. Empty for 'empty-response'. */
  readonly preview: string;
  /** Length of the raw (untrimmed) response. */
  readonly rawLength: number;
};

export type JsonParseResult<T = Record<string, unknown>> =
  { readonly ok: true; readonly value: T; readonly strategy: RepairStrategy } | JsonParseFailure;

// ─────────────────────────────────────────────────────────────────────────────
// stripCodeFences
// Source: gateway.py lines 1632-1656. Nothing behavioural changed.
// ─────────────────────────────────────────────────────────────────────────────

/** Longest first line still treated as a language tag rather than content. */
const MAX_LANGUAGE_TAG_LENGTH = 15;

export function stripCodeFences(content: string): string {
  if (!content) return content;

  let text = content.trim();

  if (text.includes('```json')) {
    // Python: text.split("```json")[1].split("```")[0] — take what follows the
    // FIRST marker, up to the next fence, or to the end of the string if the
    // fence is unterminated. An unterminated fence is exactly what a reply cut
    // off at the token cap looks like, so this path must survive it.
    const afterMarker = text.split('```json')[1] ?? '';
    text = afterMarker.split('```')[0] ?? '';
  } else if (text.includes('```')) {
    const parts = text.split('```');
    if (parts.length >= 3) {
      let inner = parts[1] ?? '';
      if (inner.startsWith('\n')) {
        inner = inner.slice(1);
      } else if (inner.includes('\n')) {
        const firstLine = (inner.split('\n')[0] ?? '').trim();
        // Source guard: purely alphabetic and short => a language tag, not
        // content. Python's `str.isalpha()` is false for the empty string,
        // which the length check below mirrors.
        if (
          firstLine.length > 0 &&
          firstLine.length < MAX_LANGUAGE_TAG_LENGTH &&
          /^[A-Za-z]+$/.test(firstLine)
        ) {
          inner = inner.slice(inner.indexOf('\n') + 1);
        }
      }
      text = inner;
    }
  }

  return text.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Repair steps, in the source's order (gateway.py lines 1684-1700).
// Rungs 1a-1c are applied together and parsed ONCE; rung 2 is a second attempt
// that re-applies 1a to the extracted snippet.
// ─────────────────────────────────────────────────────────────────────────────

/** `re.sub(r',\s*([}\]])', r'\1', s)`. Kills `{"a": 1,}` and `[1, 2,]`. */
function stripTrailingCommas(source: string): string {
  return source.replace(/,\s*([}\]])/g, '$1');
}

/**
 * `re.sub(r'//[^\n]*', '', s)`. Removes `// like this` line comments.
 *
 * KNOWN HAZARD, PRESERVED ON PURPOSE: this is not string-aware, so a URL inside
 * a string value ("https://example.com") loses everything from the slashes to
 * the end of the line. The source has the same behaviour, and it only runs
 * AFTER a clean parse has already failed. When it does damage, rung 2 undoes it
 * by slicing the ORIGINAL text — `rung 2 rescues the known URL hazard` is the
 * test that proves it. Do not make this string-aware without a test: it changes
 * which inputs get repaired.
 */
function stripLineComments(source: string): string {
  return source.replace(/\/\/[^\n]*/g, '');
}

/**
 * `re.sub(r'(?<=[\{,])\s*(\w+)\s*:', r' "\1":', s)`. Quotes bare
 * JavaScript-style keys: `{match_score: 84}` -> `{ "match_score": 84}`.
 *
 * CHANGED: the Python uses a lookbehind so the delimiter is not consumed. JS
 * lookbehind is unsupported in older WebKit — the engine a Tauri build hits on
 * macOS and Linux — so the delimiter is captured and re-emitted instead.
 * Equivalent for all valid inputs: the only overlap case (two adjacent commas)
 * is unparseable JSON either way.
 */
function quoteUnquotedKeys(source: string): string {
  return source.replace(/([{,])\s*(\w+)\s*:/g, '$1 "$2":');
}

// ─────────────────────────────────────────────────────────────────────────────
// Truncation detection — NEW, closing the port's TODO(verify).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Did this reply START as JSON and get cut off?
 *
 * The scan begins at the first `{` — so "Here is the JSON:\n{..." is judged on
 * the JSON, not the preamble — and is string-aware, so braces inside a string
 * value do not move the depth. Truncated means one of:
 *
 *   - the scan ends inside a string (the model stopped mid-sentence), or
 *   - the scan ends with unclosed braces or brackets.
 *
 * It deliberately does NOT fire when there is no `{` at all (that is prose), or
 * when depth returns to zero (that is malformed, not cut short). Both are
 * pinned by tests, because a false 'truncated' would tell the user to raise a
 * token budget that was never the problem.
 *
 * Only ever consulted after every repair rung has already failed, so a reply
 * that merely looks odd but still parses never reaches it.
 */
function looksTruncated(text: string): boolean {
  const start = text.indexOf('{');
  if (start === -1) return false;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      // Backslashes only escape inside a string; outside one the input is
      // already malformed and the depth reading is what matters.
      escaped = inString;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (character === '{' || character === '[') depth += 1;
    else if (character === '}' || character === ']') depth -= 1;
  }

  return inString || depth > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// safeParseJson
// Source: gateway.py lines 1658-1746.
// ─────────────────────────────────────────────────────────────────────────────

/** How much of a bad reply we quote back. Source: 200 chars. */
const PREVIEW_LENGTH = 200;

function previewOf(stripped: string): string {
  return stripped.slice(0, PREVIEW_LENGTH).replace(/\n/g, ' ');
}

export function safeParseJson<T = Record<string, unknown>>(text: string): JsonParseResult<T> {
  // Rung 0 — parse as-is.
  try {
    return { ok: true, value: JSON.parse(text) as T, strategy: 'clean' };
  } catch {
    // fall through
  }

  // Rung 1 — regex repairs, applied in source order, parsed once.
  const repaired = quoteUnquotedKeys(stripLineComments(stripTrailingCommas(text)));
  try {
    return { ok: true, value: JSON.parse(repaired) as T, strategy: 'regex-repairs' };
  } catch {
    // fall through
  }

  // Rung 2 — substring between the first '{' and the last '}', for models that
  // wrap JSON in prose. The source slices the ORIGINAL text, not the repaired
  // string, then re-strips trailing commas on the snippet only.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const snippet = stripTrailingCommas(text.slice(start, end + 1));
    try {
      return { ok: true, value: JSON.parse(snippet) as T, strategy: 'substring' };
    } catch {
      // fall through
    }
  }

  // Every repair failed — classify the symptom.
  const raw = text ?? '';
  const stripped = raw.trim();

  if (stripped.length === 0) {
    // Source note: "Almost always means upstream rate-limited, refused, or
    // returned a zero-token generation. The user can't fix this by rephrasing."
    // Locally the same symptom means the daemon died, the model was never
    // pulled, or generation stopped at zero tokens.
    return {
      ok: false,
      failure: 'empty-response',
      message:
        'The model returned an empty response. Check the AI provider is ' +
        'reachable and the selected model is installed, then try again. If it ' +
        'keeps happening, pick a different model.',
      preview: '',
      rawLength: raw.length,
    };
  }

  if (looksTruncated(stripped)) {
    return {
      ok: false,
      failure: 'truncated',
      message:
        'The model ran out of room and its answer was cut off part-way ' +
        'through. Try again with a shorter CV or job description, or raise the ' +
        'output limit for this model.',
      preview: previewOf(stripped),
      rawLength: raw.length,
    };
  }

  // Non-empty, well-formed at the edges, and still not JSON. Source note:
  // "Usually a small/free model ignored the JSON instruction and wrote markdown
  // or prose instead."
  return {
    ok: false,
    failure: 'not-json',
    message:
      'The model replied with text instead of JSON (first 200 characters: ' +
      `${JSON.stringify(previewOf(stripped))}). Small quantised models ` +
      'sometimes ignore the format instruction — try a larger model, or run ' +
      'the analysis again.',
    preview: previewOf(stripped),
    rawLength: raw.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// extractJson
// Source: gateway.py lines 1748-1778.
// Changed: returns the Result union rather than `Optional[Dict]` — the source
// collapses both failure classes to `None`, throwing away the distinction it
// just went to the trouble of computing. `expected_keys` still degrades
// gracefully: missing keys never fail the parse, they are reported.
// `clamp_enums(parsed)` (source line 1776) is NOT here; it lives in `clamp.ts`,
// which is driven by this app's flat schema rather than the old server-side
// enum registry.
// ─────────────────────────────────────────────────────────────────────────────

export type ExtractJsonResult<T = Record<string, unknown>> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly strategy: RepairStrategy;
      readonly missingKeys: readonly string[];
    }
  | JsonParseFailure;

export function extractJson<T = Record<string, unknown>>(
  content: string | null | undefined,
  expectedKeys: readonly string[] = [],
): ExtractJsonResult<T> {
  // Source: `if not content: return None` — an absent response is the same
  // symptom as an empty one.
  if (!content) {
    return {
      ok: false,
      failure: 'empty-response',
      message:
        'The model returned no response at all. Check the AI provider is ' +
        'reachable and the selected model is installed, then try again.',
      preview: '',
      rawLength: 0,
    };
  }

  const result = safeParseJson<T>(stripCodeFences(content).trim());
  if (!result.ok) return result;

  const parsed: unknown = result.value;
  const missingKeys =
    parsed !== null && typeof parsed === 'object'
      ? expectedKeys.filter((key) => !(key in (parsed as Record<string, unknown>)))
      : [...expectedKeys];

  return { ok: true, value: result.value, strategy: result.strategy, missingKeys };
}
