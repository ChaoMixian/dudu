import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const httpPort = Number(process.env.DUDU_HTTP_PORT ?? 5173);
const tlsPort = Number(process.env.DUDU_TLS_PORT ?? 5443);
const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
const certPath = process.env.DUDU_TLS_CERT ?? join(configHome, 'dudu', 'tls.crt');
const keyPath = process.env.DUDU_TLS_KEY ?? join(configHome, 'dudu', 'tls.key');
const targetBase = `http://127.0.0.1:${httpPort}`;

const server = Bun.serve({
  hostname: process.env.DUDU_TLS_HOST ?? '0.0.0.0',
  port: tlsPort,
  // SSE is idle between heartbeats; Bun's HTTP default (10s) would close it.
  idleTimeout: 0,
  tls: { cert: readFileSync(certPath), key: readFileSync(keyPath) },
  async fetch(req, server) {
    const url = new URL(req.url);
    if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      const target = `ws://127.0.0.1:${httpPort}${url.pathname}${url.search}`;
      return server.upgrade(req, { data: { target, queue: [] } }) ? undefined : new Response('WebSocket upgrade failed', { status: 400 });
    }
    const headers = new Headers(req.headers);
    headers.set('host', `127.0.0.1:${httpPort}`);
    headers.delete('connection');
    const init: RequestInit = { method: req.method, headers, redirect: 'manual' };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = req.body;
      (init as any).duplex = 'half';
    }
    const upstream = await fetch(`${targetBase}${url.pathname}${url.search}`, init);
    const out = new Headers();
    for (const [name, value] of upstream.headers) {
      if (['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(name.toLowerCase())) continue;
      out.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
  websocket: {
    open(ws: any) {
      const upstream = new WebSocket(ws.data.target);
      upstream.binaryType = 'arraybuffer';
      ws.data.upstream = upstream;
      upstream.addEventListener('open', () => { for (const message of ws.data.queue.splice(0)) upstream.send(message); });
      upstream.addEventListener('message', (event: any) => ws.send(event.data));
      upstream.addEventListener('close', () => { try { ws.close(); } catch {} });
      upstream.addEventListener('error', () => { try { ws.close(); } catch {} });
    },
    message(ws: any, message: any) {
      const upstream = ws.data.upstream;
      if (upstream && upstream.readyState === WebSocket.OPEN) upstream.send(message);
      else ws.data.queue.push(message);
    },
    close(ws: any) { try { ws.data.upstream?.close(); } catch {} },
  },
});

console.log(`dudu https proxy https://0.0.0.0:${server.port} -> ${targetBase}`);
