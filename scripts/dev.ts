import { resolve } from 'node:path';
import { createApp } from '../src/server';

const root = resolve(import.meta.dir, '..');
const node = Bun.which('node');
if (!node) throw new Error('Node.js is required to build the frontend.');
const vite = resolve(root, 'node_modules/vite/bin/vite.js');

// Finish the initial build before accepting requests. Vite runs under Node;
// Bun serves the API and static files through the only HTTP listener.
const initial = Bun.spawn([node, vite, 'build'], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
if (await initial.exited !== 0) process.exit(1);
const build = Bun.spawn([node, vite, 'build', '--watch', '--emptyOutDir', 'false'], {
  cwd: root, stdout: 'inherit', stderr: 'inherit',
});
const app = createApp(undefined, undefined, { autoStart: true });
const server = Bun.serve({
  hostname: process.env.DUDU_HOST ?? '0.0.0.0',
  port: Number(process.env.DUDU_PORT ?? 5173),
  idleTimeout: 0,
  fetch: app.fetch,
  websocket: app.websocket as any,
});
app.bindServer(server);
console.log(`dudu dev http://${server.hostname}:${server.port} workspace=${app.config.root}`);
let closing = false;
async function close() {
  if (closing) { process.exit(1); return; }
  closing = true;
  build.kill();
  server.stop(true);
  const force = setTimeout(() => process.exit(1), 10000);
  force.unref();
  try { await app.close(); } finally { clearTimeout(force); process.exit(0); }
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void close());
void build.exited.then(code => {
  if (!closing) { console.error(`Frontend watcher exited with code ${code}`); void close(); }
});
