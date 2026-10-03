#!/usr/bin/env node
/**
 * Screenshot helper: the only way this project drives a browser.
 *
 *   node scripts/screenshot.mjs --out shots [--url http://localhost:5173/]
 *        [--scenario scripts/scenarios/preset.mjs] [--width 1600] [--height 950]
 *        [--dark] [--full-page] [--name page] [--browser auto|wsl|windows]
 *
 * Backends
 *   wsl      Playwright's own Chromium inside WSL (headless). Needs, once:
 *              npx playwright-core install chromium
 *              sudo npx playwright-core install-deps chromium
 *   windows  The Chrome installed on Windows, driven by Playwright running
 *            under Windows node.exe. Every run gets its own fresh profile
 *            directory, the browser is closed with Playwright's close(), and
 *            the directory is removed in `finally`. No DevTools port is opened
 *            and nothing is ever ended by process name: if close() fails, only
 *            the chrome.exe processes whose command line contains this run's
 *            unique profile directory are stopped.
 *   auto     Try wsl first, fall back to windows when Chromium cannot launch.
 *
 * A scenario is an ES module whose default export receives the Playwright
 * page and a helper object: `export default async (page, { shot, out }) => {}`.
 * `shot(name)` saves `<out>/<name>.png`. Without a scenario one screenshot of
 * the page is taken.
 */
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:5173/' },
    out: { type: 'string', default: 'shots' },
    scenario: { type: 'string' },
    width: { type: 'string', default: '1600' },
    height: { type: 'string', default: '950' },
    dark: { type: 'boolean', default: false },
    'full-page': { type: 'boolean', default: false },
    name: { type: 'string', default: 'page' },
    browser: { type: 'string', default: 'auto' },
    help: { type: 'boolean', default: false },
  },
});

if (args.help) {
  console.log(
    'node scripts/screenshot.mjs --out DIR [--url URL] [--scenario FILE] [--width N] [--height N] [--dark] [--full-page] [--name NAME] [--browser auto|wsl|windows]',
  );
  process.exit(0);
}

const onWindows = process.platform === 'win32';
const log = (...parts) => console.log('[screenshot]', ...parts);

/** Convert a WSL path for Windows node.exe. */
const toWindowsPath = (p) =>
  execFileSync('wslpath', ['-w', resolve(p)])
    .toString()
    .trim();

/** Run this script again under Windows node.exe with the windows backend. */
function reexecOnWindows() {
  const candidates = ['/mnt/c/Program Files/nodejs/node.exe'];
  const nodeExe = candidates.find((c) => {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  });
  if (!nodeExe) {
    console.error(
      '[screenshot] Windows node.exe not found; install Node.js on Windows or use --browser wsl.',
    );
    process.exit(2);
  }
  const forwarded = [
    toWindowsPath(new URL(import.meta.url).pathname),
    '--browser',
    'windows',
    '--url',
    args.url,
    '--out',
    toWindowsPath(args.out),
    '--width',
    args.width,
    '--height',
    args.height,
    '--name',
    args.name,
  ];
  if (args.scenario) forwarded.push('--scenario', toWindowsPath(args.scenario));
  if (args.dark) forwarded.push('--dark');
  if (args['full-page']) forwarded.push('--full-page');
  log('running under Windows node.exe with the Chrome installed on Windows');
  // WSL only hands environment variables to Windows programs when WSLENV lists
  // them; forward every SHOT_* variable so scenarios can read their options.
  const shotVars = Object.keys(process.env).filter((key) => key.startsWith('SHOT_'));
  const wslenv = [process.env['WSLENV'], ...shotVars].filter(Boolean).join(':');
  const child = spawn(nodeExe, forwarded, {
    stdio: 'inherit',
    env: { ...process.env, WSLENV: wslenv },
  });
  child.on('exit', (code) => process.exit(code ?? 1));
}

/** Stop only the chrome.exe processes started for this run (fallback after a failed close). */
function stopOwnChrome(userDataDir) {
  const marker = userDataDir.split(/[\\/]/).pop();
  const command = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { stdio: 'ignore' });
    log(`stopped leftover processes of profile ${marker}`);
  } catch (error) {
    log(`could not stop leftover processes of profile ${marker}: ${error.message}`);
  }
}

async function run() {
  const { chromium } = await import('playwright-core');
  const viewport = { width: Number(args.width), height: Number(args.height) };
  const colorScheme = args.dark ? 'dark' : 'light';
  const out = resolve(args.out);
  mkdirSync(out, { recursive: true });

  let browser = null;
  let context = null;
  let userDataDir = null;
  const cleanup = async () => {
    const closing = context ? context.close() : browser ? browser.close() : Promise.resolve();
    const closed = await Promise.race([
      closing.then(
        () => true,
        () => false,
      ),
      new Promise((done) => setTimeout(() => done(false), 15000)),
    ]);
    if (!closed && userDataDir) stopOwnChrome(userDataDir);
    if (userDataDir) {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          rmSync(userDataDir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((done) => setTimeout(done, 500));
        }
      }
    }
    context = null;
    browser = null;
  };
  const bail = async (signal) => {
    log(`received ${signal}, cleaning up`);
    await cleanup();
    process.exit(130);
  };
  process.on('SIGINT', () => void bail('SIGINT'));
  process.on('SIGTERM', () => void bail('SIGTERM'));

  try {
    let page;
    if (onWindows) {
      userDataDir = join(tmpdir(), `origamio-shot-${Date.now()}-${randomBytes(4).toString('hex')}`);
      log(`profile ${userDataDir}`);
      context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chrome',
        headless: true,
        viewport,
        colorScheme,
        acceptDownloads: true,
      });
      page = context.pages()[0] ?? (await context.newPage());
    } else {
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext({ viewport, colorScheme, acceptDownloads: true });
      page = await context.newPage();
    }
    page.on('pageerror', (error) => log('page error:', error.message));

    const shot = async (name, options = {}) => {
      const file = join(out, `${name}.png`);
      await page.screenshot({ path: file, fullPage: args['full-page'], ...options });
      log(`saved ${file}`);
      return file;
    };
    await page.goto(args.url, { waitUntil: 'networkidle' });
    if (args.scenario) {
      const file = isAbsolute(args.scenario) ? args.scenario : resolve(args.scenario);
      const scenario = await import(pathToFileURL(file).href);
      await scenario.default(page, { shot, out, log });
    } else {
      await shot(args.name);
    }
  } finally {
    await cleanup();
  }
}

async function main() {
  if (!onWindows && args.browser === 'windows') return reexecOnWindows();
  if (onWindows || args.browser === 'wsl') return run();
  // auto: Playwright's Chromium in WSL first, Windows Chrome as the fallback.
  try {
    await run();
  } catch (error) {
    const message = String(error.message ?? error);
    const launchProblem =
      /Executable doesn't exist|error while loading shared libraries|Failed to launch|install/i;
    if (!launchProblem.test(message)) throw error;
    log(`WSL Chromium unavailable (${message.split('\n')[0]}); falling back to Windows Chrome`);
    reexecOnWindows();
  }
}

main().catch((error) => {
  console.error('[screenshot]', error);
  process.exit(1);
});
