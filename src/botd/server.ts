import { BotdSupervisor } from './supervisor';
import { BotdError, type BotdOptions } from './types';
import { object } from '../contracts';
const json = (data: unknown, status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
/** Standalone loopback HTTP surface. dudu itself uses BotdSupervisor directly. */
export function createBotdHandler(supervisor: BotdSupervisor) {
  return async (request: Request): Promise<Response> => {
    try {
      await supervisor.init();
      const u = new URL(request.url), segments = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const body = async () => { const s = await request.text(); if (Buffer.byteLength(s)>2*1024*1024) throw new BotdError('JSON body exceeds 2 MiB',413); try {return object(JSON.parse(s || '{}'));} catch {throw new BotdError('Invalid JSON object');} };
      if (request.method === 'GET' && u.pathname === '/healthz') return json({ok:true,service:'botd',version:1});
      if (request.method === 'GET' && u.pathname === '/v1/doctor') return json(await supervisor.doctor());
      if (segments[0] !== 'v1' || segments[1] !== 'desktops') throw new BotdError('Not found',404);
      if (segments.length === 2) {
        if (request.method === 'GET') return json(await supervisor.list());
        if (request.method === 'POST') return json(await supervisor.start(await body() as any),201);
        throw new BotdError('Method not allowed',405);
      }
      const id = segments[2]!;
      if (segments.length === 3) {
        if (request.method === 'GET') return json(await supervisor.get(id));
        if (request.method === 'DELETE') return json(await supervisor.stop(id));
        throw new BotdError('Method not allowed',405);
      }
      const action = segments[3];
      // ── cua-aligned surface: POST /v1/desktops/:id/cua/<method> ──
      if (action === 'cua') {
        if (segments.length !== 5) throw new BotdError('Not found',404);
        const method = segments[4]!;
        if (request.method !== 'POST') throw new BotdError('Method not allowed',405);
        const b = await body();
        const call = async (): Promise<Response> => {
          switch (method) {
            case 'screenshot': {
              const bytes = await supervisor.screenshot(id, b as any);
              const format = (b.format as string) ?? 'png';
              return new Response(bytes as BodyInit,{headers:{'Content-Type':`image/${format === 'jpeg' ? 'jpeg' : format}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
            }
            case 'screen_size': return json(await supervisor.screen_size(id));
            case 'displays': return json(await supervisor.displays(id));
            case 'move': await supervisor.move(id,b.x,b.y); return json({ok:true});
            case 'click': await supervisor.click(id,{x:b.x,y:b.y,button:{left:1,middle:2,right:3}[b.button as string] ?? 1}); return json({ok:true});
            case 'double_click': await supervisor.double_click(id,b.x,b.y); return json({ok:true});
            case 'right_click': await supervisor.right_click(id,b.x,b.y); return json({ok:true});
            case 'drag': await supervisor.drag(id,b.start_x,b.start_y,b.end_x,b.end_y,b.button); return json({ok:true});
            case 'scroll': await supervisor.scrollAt(id,b.x ?? 0,b.y ?? 0,b.scroll_x ?? 0,b.scroll_y ?? 3); return json({ok:true});
            case 'mouse_down': await supervisor.mouse_down(id,b.button); return json({ok:true});
            case 'mouse_up': await supervisor.mouse_up(id,b.button); return json({ok:true});
            case 'key_down': await supervisor.key_down(id,b.key); return json({ok:true});
            case 'key_up': await supervisor.key_up(id,b.key); return json({ok:true});
            case 'keypress': await supervisor.keypress(id,b.keys ?? b.key); return json({ok:true});
            case 'type': await supervisor.type(id,b.text); return json({ok:true});
            case 'cursor_position': return json(await supervisor.cursor_position(id));
            case 'clipboard_get': return json({text: await supervisor.clipboard_get(id)});
            case 'clipboard_set': await supervisor.clipboard_set(id,b.text); return json({ok:true});
            case 'run': return json(await supervisor.run(id,b as any));
            case 'process_list': return json(await supervisor.process_list(id));
            case 'process_kill': return json(await supervisor.process_kill(id,b.pid));
            case 'process_read': return json(await supervisor.process_read(id,b.pid));
            case 'terminal_create': return json(await supervisor.terminal_create(id,b as any));
            case 'terminal_send': await supervisor.terminal_send(id,b.pid,b.data); return json({ok:true});
            case 'terminal_read': return json({output: await supervisor.terminal_read(id,b.pid)});
            case 'terminal_info': return json(await supervisor.terminal_info(id,b.pid));
            case 'terminal_close': await supervisor.terminal_close(id,b.pid); return json({ok:true});
            case 'window_list': return json(await supervisor.window_list(id));
            case 'window_active_title': return json({title: await supervisor.window_active_title(id)});
            case 'window_activate': await supervisor.window_activate(id,b.window_id ?? b.id); return json({ok:true});
            case 'files_read_text': return json({content: await supervisor.files_read_text(id,b.path)});
            case 'files_write_text': await supervisor.files_write_text(id,b.path,b.content); return json({ok:true});
            case 'files_read_bytes': return json({data_base64: Buffer.from(await supervisor.files_read_bytes(id,b.path,b.offset,b.length)).toString('base64')});
            case 'files_write_bytes': await supervisor.files_write_bytes(id,b.path,new Uint8Array(Buffer.from(String(b.data_base64 ?? ''),'base64'))); return json({ok:true});
            case 'files_list': return json(await supervisor.files_list(id,b.path));
            case 'files_make_dir': await supervisor.files_make_dir(id,b.path); return json({ok:true});
            case 'files_remove': await supervisor.files_remove(id,b.path); return json({ok:true});
            case 'files_remove_dir': await supervisor.files_remove_dir(id,b.path); return json({ok:true});
            case 'files_exists': return json(await supervisor.files_exists(id,b.path));
            case 'files_is_dir': return json(await supervisor.files_is_dir(id,b.path));
            case 'files_size': return json(await supervisor.files_size(id,b.path));
            default: throw new BotdError(`Unknown cua method: ${method}`,404);
          }
        };
        return call();
      }
      if (segments.length !== 4) throw new BotdError('Not found',404);
      if (request.method === 'GET') {
        if (action === 'watch') return json(await supervisor.watch(id));
        if (action === 'shot') return new Response(await supervisor.shot(id) as BodyInit,{headers:{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
        if (action === 'files') return new Response(await supervisor.download(id,u.searchParams.get('path') ?? '') as BodyInit,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'attachment'}});
        if (action === 'recording') return new Response(await supervisor.recording(id,u.searchParams.get('id') ?? '') as BodyInit,{headers:{'Content-Type':'video/x-matroska','Cache-Control':'no-store','Content-Disposition':'attachment'}});
      }
      if (request.method === 'PUT' && action === 'files') return json(await supervisor.upload(id,u.searchParams.get('path') ?? '',new Uint8Array(await request.arrayBuffer())));
      if (request.method === 'POST') {
        if (action === 'stop') return json(await supervisor.stop(id));
        if (action === 'restart') return json(await supervisor.restart(id));
        const b = await body();
        if (action === 'start') return json(await supervisor.start({...b,id} as any));
        if (action === 'click') {await supervisor.click(id,b as any);return json({ok:true});}
        if (action === 'key') {await supervisor.key(id,b.key);return json({ok:true});}
        if (action === 'scroll') {await supervisor.scroll(id,b as any);return json({ok:true});}
        if (action === 'type') {await supervisor.type(id,b.text);return json({ok:true});}
        if (action === 'exec') return json(await supervisor.exec(id,b as any));
        if (action === 'record-start') return json(await supervisor.recordStart(id,b));
        if (action === 'record-stop') return json(await supervisor.recordStop(id));
      }
      throw new BotdError('Not found',404);
    } catch (e) {
      return json({error:e instanceof Error ? e.message : String(e)}, e instanceof BotdError ? e.status : e instanceof SyntaxError || e instanceof URIError ? 400 : 500);
    }
  };
}
export async function startBotdServer(options: BotdOptions = {}) {
  const supervisor = new BotdSupervisor(options); await supervisor.init();
  if (!['127.0.0.1','::1','localhost'].includes(supervisor.host)) {await supervisor.close();throw new BotdError('botd binds loopback only; use an authenticated SSH tunnel for remote access');}
  let server: ReturnType<typeof Bun.serve>;
  try {server = Bun.serve({hostname:supervisor.host,port:supervisor.port,maxRequestBodySize:64*1024*1024,idleTimeout: 255,fetch:createBotdHandler(supervisor)});} catch(e) {await supervisor.close();throw e;}
  const baseUrl = `http://${supervisor.host === '::1' ? '[::1]' : supervisor.host}:${server.port}`;
  return {server,supervisor,baseUrl,async close() {await server.stop(true);await supervisor.close();}};
}
