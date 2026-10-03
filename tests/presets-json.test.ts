import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PRESETS, presetToSequence } from '../src/presets';
import { parseSequence, serializeSequence } from '../src/sequence';

const dir = join(__dirname, '..', 'presets');
const write = process.env['WRITE_PRESETS'] === '1';

describe('preset JSON files', () => {
  for (const preset of PRESETS) {
    const file = join(dir, `${preset.id}.json`);
    const text = serializeSequence(presetToSequence(preset));

    it(`${preset.id}.json matches src/presets.ts`, () => {
      if (write) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, text);
      }
      expect(existsSync(file), `${file} is missing; run npm run presets:write`).toBe(true);
      expect(readFileSync(file, 'utf8')).toBe(text);
    });

    it(`${preset.id}.json parses back to the same steps`, () => {
      const parsed = parseSequence(text);
      expect(parsed.name).toBe(preset.label);
      expect(parsed.steps).toHaveLength(preset.steps.length);
      expect(serializeSequence(parsed)).toBe(text);
    });
  }
});
