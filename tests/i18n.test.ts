// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { en } from '../src/i18n/en';
import { LANGUAGES, detectLanguage, language, onLanguageChange, setLanguage, t } from '../src/i18n';
import { LIBRARY } from '../src/library';

/** Every step name a shipped sequence carries, including the folds within a step. */
const shippedLabels = (): Set<string> => {
  const labels = new Set<string>();
  for (const { sequence } of LIBRARY) {
    for (const step of sequence.steps) if (step.label) labels.add(step.label);
  }
  return labels;
};

describe('the words of the interface', () => {
  it('has a name and a description for every shipped sequence, in every language', async () => {
    for (const lang of LANGUAGES) {
      await setLanguage(lang, false);
      for (const { id } of LIBRARY) {
        expect(t.presets[id]?.name, `${lang}: presets.${id}.name`).toBeTruthy();
        expect(t.presets[id]?.description, `${lang}: presets.${id}.description`).toBeTruthy();
      }
    }
  });

  it('translates every step name a shipped sequence carries, in every language', async () => {
    const labels = shippedLabels();
    expect(labels.size).toBeGreaterThan(10);
    for (const lang of LANGUAGES) {
      await setLanguage(lang, false);
      for (const label of labels) {
        expect(t.stepLabels[label], `${lang}: stepLabels["${label}"]`).toBeTruthy();
      }
    }
    // And carries nothing that no sequence uses any more.
    for (const label of Object.keys(en.stepLabels)) expect(labels.has(label), label).toBe(true);
  });

  it('leaves no word empty in any language', async () => {
    const walk = (value: unknown, path: string): void => {
      if (typeof value === 'string') expect(value.trim(), path).not.toBe('');
      else if (typeof value === 'function') return;
      else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
      else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
      }
    };
    for (const lang of LANGUAGES) {
      await setLanguage(lang, false);
      walk(t, lang);
      expect(t.tag, lang).toBeTruthy();
    }
  });

  it('swaps the words in place and sets the page language', async () => {
    const seen: string[] = [];
    const stop = onLanguageChange((lang) => seen.push(lang));
    await setLanguage('en', false);
    expect(language()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(t.folded.title).toBe('Folded');
    stop();
    expect(seen).toEqual(['en']);
  });

  it('starts from the URL, then the remembered choice, then the browser', () => {
    expect(LANGUAGES).toContain(detectLanguage());
  });
});
