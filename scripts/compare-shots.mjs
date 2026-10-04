#!/usr/bin/env node
/**
 * Compare the screenshots of a run with the committed baselines.
 *
 *   node scripts/compare-shots.mjs [--run shots/ci] [--baseline tests/shots]
 *        [--diff shots/diff] [--max-percent 0.3] [--update]
 *
 * Every baseline must have a picture in the run and may differ in at most
 * `max-percent` of its pixels (pixelmatch, threshold 0.1); differing pixels
 * are written as diff images. With `--update` the run's pictures become the
 * baselines. A run picture without a baseline fails too, so a new picture
 * is committed on purpose.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const { values: args } = parseArgs({
  options: {
    run: { type: 'string', default: 'shots/ci' },
    baseline: { type: 'string', default: 'tests/shots' },
    diff: { type: 'string', default: 'shots/diff' },
    'max-percent': { type: 'string', default: '0.3' },
    update: { type: 'boolean', default: false },
  },
});

const runDir = resolve(args.run);
const baseDir = resolve(args.baseline);
const diffDir = resolve(args.diff);
const maxPercent = Number(args['max-percent']);
const pngs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')) : []);

if (args.update) {
  mkdirSync(baseDir, { recursive: true });
  for (const file of pngs(runDir)) copyFileSync(join(runDir, file), join(baseDir, file));
  console.log(`baselines updated from ${runDir}: ${pngs(runDir).join(', ')}`);
  process.exit(0);
}

const names = new Set([...pngs(runDir), ...pngs(baseDir)]);
if (names.size === 0) {
  console.log(`nothing to compare: no pictures in ${runDir} or ${baseDir}`);
  process.exit(1);
}
let failed = 0;
for (const name of [...names].sort()) {
  const runFile = join(runDir, name);
  const baseFile = join(baseDir, name);
  if (!existsSync(baseFile)) {
    console.log(`MISSING BASELINE ${name}: commit it with --update if the picture is right`);
    failed++;
    continue;
  }
  if (!existsSync(runFile)) {
    console.log(`MISSING RUN ${name}: the scenario no longer makes this picture`);
    failed++;
    continue;
  }
  const a = PNG.sync.read(readFileSync(runFile));
  const b = PNG.sync.read(readFileSync(baseFile));
  if (a.width !== b.width || a.height !== b.height) {
    console.log(`SIZE ${name}: run ${a.width}x${a.height}, baseline ${b.width}x${b.height}`);
    failed++;
    continue;
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const differing = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  const percent = (100 * differing) / (a.width * a.height);
  const ok = percent <= maxPercent;
  console.log(`${ok ? 'ok  ' : 'DIFF'} ${name}: ${differing} pixels (${percent.toFixed(3)}%)`);
  if (!ok) {
    mkdirSync(diffDir, { recursive: true });
    writeFileSync(join(diffDir, name), PNG.sync.write(diff));
    failed++;
  }
}
if (failed > 0) {
  console.log(`${failed} picture(s) differ; diffs in ${diffDir}`);
  process.exit(1);
}
console.log('all pictures match');
