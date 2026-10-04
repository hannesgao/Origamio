/**
 * The pictures the screenshot regression compares: the crane in the four
 * fixed 3D views, the folded view and the crease pattern. Only view frames
 * are captured (no text), so fonts do not matter, and nothing time-based is
 * in the picture.
 *
 *   node scripts/screenshot.mjs --browser linux --url http://localhost:4173/ \
 *        --out shots/ci --scenario scripts/scenarios/baseline.mjs --width 1400 --height 900
 */
import { join } from 'node:path';

export default async function (page, { out, log }) {
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-panel="library"]');
  await page.click('[data-preset="crane"]');
  await page.keyboard.press('End');
  await page.click('.panel-close');
  await page.keyboard.press('f');
  await page.waitForTimeout(400);

  const capture = async (name, selector) => {
    const box = await page.locator(selector).boundingBox();
    if (!box) throw new Error(`nothing to capture for ${selector}`);
    const file = join(out, `${name}.png`);
    await page.screenshot({ path: file, clip: box });
    log(`saved ${file}`);
  };
  await capture('folded', '.folded-card .view-frame');
  await capture('unfolded', '.unfolded-card .view-frame');
  await page.click('.unfolded-card [data-secondary="solid"]');
  await page.waitForTimeout(300);
  for (const view of ['front', 'side', 'top', 'isometric']) {
    await page.click(`.solid-card [data-view="${view}"]`);
    // The solve runs in a worker; give it time to answer and draw.
    await page.waitForTimeout(600);
    await capture(`crane-${view}`, '.solid-card .view-frame');
  }
  await page.evaluate(() => localStorage.clear());
}
