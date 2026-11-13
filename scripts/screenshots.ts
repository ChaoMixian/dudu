import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Regenerate the README screenshots from the isolated UI preview.
// Requires a local Chrome/Chromium; set CHROME_PATH if it is not in a standard location.
const root = resolve(import.meta.dir, '..');
const output = join(root, 'docs/assets');
const WIDTH = 1440;
const HEIGHT = 900;

function chromeBinary(): string {
  const candidates = [
    process.env.CHROME_PATH,
    '/opt/google/chrome/chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ];
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate;
  throw new Error('Chrome/Chromium not found. Set CHROME_PATH to the browser executable.');
}

async function buildFrontend() {
  const build = Bun.spawn([process.execPath, 'run', 'build'], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
  if (await build.exited !== 0) throw new Error('Frontend build failed');
}

async function waitForPreview(port: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/state`)).ok) return; } catch { /* not ready yet */ }
    await Bun.sleep(100);
  }
  throw new Error(`UI preview on port ${port} did not start`);
}

async function capture(chrome: string, port: number, locale: 'zh' | 'en', view: 'chat' | 'thread', file: string) {
  const target = join(output, file);
  rmSync(target, { force: true });
  const profile = mkdtempSync(join(tmpdir(), 'dudu-shot-'));
  const url = `http://127.0.0.1:${port}/bots/assistant?shot=${view}&shot-locale=${locale}`;
  try {
    const process = Bun.spawn([
      chrome,
      '--headless=new',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${WIDTH},${HEIGHT}`,
      `--user-data-dir=${profile}`,
      '--virtual-time-budget=9000',
      '--run-all-compositor-stages-before-draw',
      `--screenshot=${target}`,
      url,
    ], { stdout: 'ignore', stderr: 'ignore' });
    const code = await process.exited;
    if (code !== 0 || !existsSync(target)) throw new Error(`Chrome failed for ${file} (exit ${code})`);
    console.log(`${file}  <-  ${url}`);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

const chrome = chromeBinary();
await buildFrontend();

const previews = [
  Bun.spawn([process.execPath, 'scripts/ui-preview.ts'], { cwd: root, env: { ...process.env, UI_PREVIEW_PORT: '7451' }, stdout: 'ignore', stderr: 'ignore' }),
  Bun.spawn([process.execPath, 'scripts/ui-preview.ts'], { cwd: root, env: { ...process.env, UI_PREVIEW_PORT: '7452', UI_PREVIEW_LANG: 'en' }, stdout: 'ignore', stderr: 'ignore' }),
];

try {
  await Promise.all([waitForPreview(7451), waitForPreview(7452)]);
  await capture(chrome, 7451, 'zh', 'chat', 'dudu-chat.png');
  await capture(chrome, 7451, 'zh', 'thread', 'dudu-bot-thread.png');
  await capture(chrome, 7452, 'en', 'chat', 'dudu-chat.en.png');
  await capture(chrome, 7452, 'en', 'thread', 'dudu-bot-thread.en.png');
  console.log(`\nScreenshots written to ${output}`);
} finally {
  for (const preview of previews) preview.kill();
}
