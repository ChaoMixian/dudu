import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string };
const builtAt = new Date().toISOString();
const buildId = process.env.DUDU_BUILD_ID ?? builtAt.replace(/[-:]/g, '').slice(0, 15);

function git(args: string[]) {
  try { return execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
}
const commit = git(['rev-parse', '--short', 'HEAD']) || 'unknown';
const dirty = Boolean(git(['status', '--porcelain', '--untracked-files=no']));

function buildInfo() {
  return {
    name: 'dudu-build-info',
    apply: 'build' as const,
    closeBundle() {
      const dir = resolve(process.cwd(), 'dist');
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, 'build.json'), JSON.stringify({
        version: pkg.version,
        build: buildId,
        commit,
        dirty,
        builtAt,
      }, null, 2) + '\n');
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), buildInfo()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(buildId),
    __BUILD_COMMIT__: JSON.stringify(commit),
    __BUILD_DIRTY__: JSON.stringify(dirty),
    __BUILD_TIME__: JSON.stringify(builtAt),
  },
  server: { host: true, proxy: { '/api': { target: 'http://127.0.0.1:7331', changeOrigin: true } } },
  build: { outDir: 'dist' },
});
