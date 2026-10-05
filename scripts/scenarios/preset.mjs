/**
 * Example scenario: load a preset, apply every step, frame the sheet and
 * capture the three views. Pick the preset with SHOT_PRESET (default crane).
 *
 *   SHOT_PRESET=crane node scripts/screenshot.mjs --out shots --scenario scripts/scenarios/preset.mjs
 */
import { join } from 'node:path';

export default async function (page, { shot, out }) {
  const preset = process.env.SHOT_PRESET ?? 'crane';
  // The presets are listed in the Library panel, which a fresh profile has closed.
  await page.click('[data-panel="library"]');
  await page.click(`[data-preset="${preset}"]`);
  await page.click('.panel-close');
  await page.keyboard.press('End');
  await page.waitForTimeout(200);
  await page.keyboard.press('f');
  await page.waitForTimeout(200);
  await shot(`${preset}-page`);
  await page.locator('.folded-view').screenshot({ path: join(out, `${preset}-folded.png`) });
}
