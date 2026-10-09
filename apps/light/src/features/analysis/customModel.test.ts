// @vitest-environment jsdom
/**
 * Which model the typed-address service runs (L-150). Unlike the named clouds
 * there is no curated list — the service is whatever the user pointed at — so
 * the id comes from the service's own model list, or is typed, and is checked
 * only for being something a server could plausibly accept.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CUSTOM_MODEL_STORAGE_KEY,
  MAX_CUSTOM_MODEL_CHARS,
  chooseCustomModel,
  forgetCustomModel,
  normaliseCustomModel,
  readCustomModel,
} from './customModel';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('choosing the model', () => {
  it('remembers a chosen model and reads it back', () => {
    expect(chooseCustomModel('qwen2.5-7b-instruct')).toBe(true);
    expect(readCustomModel()).toBe('qwen2.5-7b-instruct');
  });

  it('keeps the slashes and colons real model ids use', () => {
    for (const id of ['meta-llama/Llama-3.1-8B-Instruct', 'llama3.2:latest', 'gpt-4o@2024']) {
      expect(chooseCustomModel(id)).toBe(true);
      expect(readCustomModel()).toBe(id);
    }
  });

  it('trims what was typed', () => {
    expect(normaliseCustomModel('  mistral-7b \n')).toBe('mistral-7b');
    expect(chooseCustomModel('  mistral-7b \n')).toBe(true);
    expect(readCustomModel()).toBe('mistral-7b');
  });

  it('is stored under the app prefix, so "delete everything" reaches it', () => {
    expect(CUSTOM_MODEL_STORAGE_KEY.startsWith('cviper.light.')).toBe(true);
  });

  it('forgets the choice', () => {
    chooseCustomModel('phi-4');
    forgetCustomModel();
    expect(readCustomModel()).toBeNull();
  });
});

describe('what it refuses', () => {
  it('reads nothing chosen as null', () => {
    expect(readCustomModel()).toBeNull();
  });

  it('negative: an empty or blank model is refused and changes nothing', () => {
    chooseCustomModel('phi-4');
    for (const blank of ['', '   ', '\n\t']) {
      expect(normaliseCustomModel(blank)).toBeNull();
      expect(chooseCustomModel(blank)).toBe(false);
    }
    expect(readCustomModel()).toBe('phi-4');
  });

  it('negative: control characters and inner spaces are refused', () => {
    for (const bad of ['phi 4', 'phi\u00004', 'phi\t4', 'phi\u007f']) {
      expect(normaliseCustomModel(bad)).toBeNull();
      expect(chooseCustomModel(bad)).toBe(false);
    }
  });

  it('boundary: the length limit', () => {
    const atLimit = 'm'.repeat(MAX_CUSTOM_MODEL_CHARS);
    expect(chooseCustomModel(atLimit)).toBe(true);
    expect(readCustomModel()).toBe(atLimit);
    expect(chooseCustomModel(`${atLimit}m`)).toBe(false);
    expect(readCustomModel()).toBe(atLimit);
  });

  it('negative: a stored value that is not a usable id reads as nothing chosen', () => {
    for (const stored of ['', '   ', 'has space', 'm'.repeat(MAX_CUSTOM_MODEL_CHARS + 1)]) {
      localStorage.setItem(CUSTOM_MODEL_STORAGE_KEY, stored);
      expect(readCustomModel()).toBeNull();
    }
  });

  it('negative: storage that throws reads as nothing chosen and refuses a choice', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readCustomModel()).toBeNull();
    expect(chooseCustomModel('phi-4')).toBe(false);
  });
});
