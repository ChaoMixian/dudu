import { resolve } from 'node:path';
import type { AppState } from '../src/web/lib/types';

// UI-only, in-memory fixtures. This server never starts a scheduler, model, or desktop.
// Set UI_PREVIEW_LANG=en to render the English fixture used by README.en.md screenshots.
const en = process.env.UI_PREVIEW_LANG === 'en';
const createdAt = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const bots = en ? [
  { id: 'assistant', name: 'Workspace Assistant', description: 'Organizes information, breaks down tasks, and follows every step.', avatar: 'dicebear:gaze:dudu-assistant', color: 'teal', provider: 'local', model: 'workspace-model', paused: false, bindings: [{ id: 'computer', connectorId: 'computer', config: { desktopId: 'workspace-desktop' } }] },
  { id: 'developer', name: 'Dev Partner', description: 'Reviews code, finds problems, and records verification results.', avatar: 'dicebear:gaze:dudu-developer', color: 'blue', provider: 'local', model: 'workspace-model', paused: true, bindings: [] },
  { id: 'ideas', name: 'Idea Notes', description: 'Turns scattered thoughts into actionable plans.', avatar: 'dicebear:gaze:dudu-ideas', color: 'amber', provider: 'local', model: 'workspace-model', paused: false, bindings: [] },
] : [
  { id: 'assistant', name: '工作助手', description: '整理信息、拆解任务，跟进每一步。', avatar: 'dicebear:gaze:dudu-assistant', color: 'teal', provider: 'local', model: 'workspace-model', paused: false, bindings: [{ id: 'computer', connectorId: 'computer', config: { desktopId: 'workspace-desktop' } }] },
  { id: 'developer', name: '开发搭档', description: '审阅代码、定位问题、记录验证结果。', avatar: 'dicebear:gaze:dudu-developer', color: 'blue', provider: 'local', model: 'workspace-model', paused: true, bindings: [] },
  { id: 'ideas', name: '灵感笔记', description: '把零散想法整理成可执行的方案。', avatar: 'dicebear:gaze:dudu-ideas', color: 'amber', provider: 'local', model: 'workspace-model', paused: false, bindings: [] },
];
const messages = en ? [
  { id: 'm1', botId: 'assistant', conversationId: 'default', sender: 'user', kind: 'message', text: 'Help me organize today\'s work, and make the interface and interaction details the priority.', status: 'sent', seq: 1, createdAt: createdAt(50) },
  { id: 'm2', botId: 'assistant', conversationId: 'default', sender: 'assistant', kind: 'message', text: 'Sure. Let\'s break it into three parts:\n\n1. Tighten navigation and keep only the entries that matter.\n2. Complete the feedback for sending, settings, and computer actions.\n3. Check desktop and mobile so transitions feel natural and continuous.', status: 'sent', seq: 2, createdAt: createdAt(49) },
  { id: 'm3', botId: 'assistant', conversationId: 'default', sender: 'assistant', kind: 'message', text: 'I will list anything that needs confirmation separately instead of running real automation for you.', status: 'sent', seq: 3, createdAt: createdAt(49) },
  { id: 'm4', botId: 'assistant', conversationId: 'default', sender: 'user', kind: 'message', text: 'Good. Animations do not need to be flashy, but they should feel smooth, with a little tension when switching.', status: 'sent', seq: 4, createdAt: createdAt(8) },
  { id: 'm5', botId: 'assistant', conversationId: 'default', sender: 'assistant', kind: 'ask', text: 'Understood. Sidebar and selected states use a quick start with a soft settle; new messages enter lightly while history stays stable.\n\nIt also respects the system\'s reduced-motion setting, so motion serves the action rather than stealing attention.', options: ['Keep polishing the UI', 'Preview computer takeover', 'Turn it into a task list'], status: 'sent', seq: 5, createdAt: createdAt(7) },
  { id: 'reaction-1', botId: 'assistant', conversationId: 'default', sender: 'assistant', kind: 'reaction', targetId: 'm4', emoji: '👍', text: '', status: 'sent', seq: 6, createdAt: createdAt(6) },
  { id: 'takeover-1', botId: 'assistant', conversationId: 'default', sender: 'assistant', kind: 'takeover', text: 'Your computer is ready. You can take over directly.', status: 'sent', seq: 7, createdAt: createdAt(5) },
  { id: 'bot-out-1', botId: 'assistant', conversationId: 'default', sender: 'assistant', kind: 'bot_out', text: 'Please check whether the computer action request bodies are consistent.', status: 'sent', seq: 8, createdAt: createdAt(4) },
  { id: 'bot-in-1', botId: 'assistant', conversationId: 'default', sender: 'developer', kind: 'bot_in', text: 'They are all explicit JSON objects now, and error messages are passed back.', status: 'sent', seq: 9, createdAt: createdAt(3) },
  { id: 'm6', botId: 'developer', conversationId: 'default', sender: 'user', kind: 'message', text: 'Check the request body and error messages for computer actions.', status: 'sent', seq: 6, createdAt: createdAt(20) },
] : [
  { id: 'm1', botId: 'assistant', conversationId: 'default', sender: 'user', kind: 'message', text: '帮我整理一下今天的工作安排，优先把界面和交互细节打磨好。', status: 'sent', seq: 1, createdAt: createdAt(50) },
  { id: 'm2', botId: 'assistant', conversationId: 'default', sender: 'assistant', kind: 'message', text: '可以。先把任务拆成三个部分：\n\n1. 收敛导航，只保留真正可用的入口。\n2. 补齐发送、配置和电脑操作的反馈。\n3. 检查桌面与移动端，让过渡自然、操作连贯。', status: 'sent', seq: 2, createdAt: createdAt(49) },
  { id: 'm3', botId: 'assistant', conversationId: 'default', sender: 'assistant', kind: 'message', text: '我会把需要确认的操作单独列出来，不替你执行真实的自动化任务。', status: 'sent', seq: 3, createdAt: createdAt(49) },
  { id: 'm4', botId: 'assistant', conversationId: 'default', sender: 'user', kind: 'message', text: '好。动画不需要花哨，但要流畅，切换的时候要有一点张力。', status: 'sent', seq: 4, createdAt: createdAt(8) },
  { id: 'm5', botId: 'assistant', conversationId: 'default', sender: 'assistant', kind: 'ask', text: '明白。侧栏和选中态采用快速启动、柔和收束的过渡；新消息轻量入场，历史记录保持稳定。\n\n同时尊重系统的“减少动态效果”设置，让动效服务于操作，而不是抢走注意力。', options: ['继续打磨界面', '先做电脑接管', '整理成任务清单'], status: 'sent', seq: 5, createdAt: createdAt(7) },
  { id: 'reaction-1', botId: 'assistant', conversationId: 'default', sender: 'assistant', kind: 'reaction', targetId: 'm4', emoji: '👍', text: '', status: 'sent', seq: 6, createdAt: createdAt(6) },
  { id: 'takeover-1', botId: 'assistant', conversationId: 'default', sender: 'assistant', kind: 'takeover', text: '电脑已经准备好，你可以直接接管。', status: 'sent', seq: 7, createdAt: createdAt(5) },
  { id: 'bot-out-1', botId: 'assistant', conversationId: 'default', sender: 'assistant', kind: 'bot_out', text: '麻烦看一下电脑操作的请求体是否统一。', status: 'sent', seq: 8, createdAt: createdAt(4) },
  { id: 'bot-in-1', botId: 'assistant', conversationId: 'default', sender: 'developer', kind: 'bot_in', text: '已经统一成 JSON 对象，错误提示也补上了。', status: 'sent', seq: 9, createdAt: createdAt(3) },
  { id: 'm6', botId: 'developer', conversationId: 'default', sender: 'user', kind: 'message', text: '检查电脑操作的请求体和错误提示。', status: 'sent', seq: 6, createdAt: createdAt(20) },
];
const thread = en ? [
  { id: 'thread-1', from: 'assistant', to: 'developer', text: 'Have you finished checking the computer action request bodies?', createdAt: createdAt(6) },
  { id: 'thread-2', from: 'developer', to: 'assistant', text: 'Done: every action sends an explicit JSON object, and errors are passed back.', createdAt: createdAt(5) },
  { id: 'thread-3', from: 'assistant', to: 'developer', text: 'Good, I will take a look.', createdAt: createdAt(4) },
  { id: 'thread-4', from: 'developer', to: 'assistant', text: 'Got it. Call me whenever a new task comes up.', createdAt: createdAt(3) },
] : [
  { id: 'thread-1', from: 'assistant', to: 'developer', text: '电脑操作的请求体检查完了吗？', createdAt: createdAt(6) },
  { id: 'thread-2', from: 'developer', to: 'assistant', text: '检查完了：所有动作都发送显式 JSON 对象，错误信息也会回传。', createdAt: createdAt(5) },
  { id: 'thread-3', from: 'assistant', to: 'developer', text: '好，我先看看。', createdAt: createdAt(4) },
  { id: 'thread-4', from: 'developer', to: 'assistant', text: '收到。有新任务随时叫我。', createdAt: createdAt(3) },
];
const state: AppState = {
  bots,
  connectors: [{ id: 'computer', name: en ? 'Workspace computer' : '工作区电脑', description: en ? 'Local desktop adapter' : '本地桌面适配器', transport: 'local', tools: [{ name: 'status', description: en ? 'Read desktop status' : '读取桌面状态', parameters: { type: 'object' } }] }],
  providers: [{ id: 'local', name: 'Local workspace', api: 'openai-completions', baseUrl: 'http://127.0.0.1:9999/v1', apiKey: 'preview-key', models: [{ id: 'workspace-model', name: 'Workspace model' }, { id: 'reasoning-model', name: 'Reasoning model' }] }],
  defaults: { provider: 'local', model: 'workspace-model' },
  autoStartComputers: true,
  sources: [{ id: 'daily-review', botId: 'assistant', kind: 'cron', enabled: true, priority: 'normal', cron: '0 9 * * 1-5', timezone: 'Asia/Shanghai', payload: { task: en ? 'Organize today\'s work list' : '整理今天的工作清单' } }],
  statuses: [{ botId: 'assistant', state: 'idle', pending: 0 }, { botId: 'developer', state: 'paused', pending: 0 }, { botId: 'ideas', state: 'idle', pending: 0 }],
  messages,
  botThreads: [{ botId: 'assistant', peerId: 'developer', count: 4, lastText: en ? 'Got it. Call me whenever a new task comes up.' : '收到。有新任务随时叫我。', lastAt: createdAt(3) }],
  desktops: [],
};
const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
const encoder = new TextEncoder();
const requests: { method: string; path: string; body: unknown }[] = [];
const publish = () => { for (const stream of streams) { try { stream.enqueue(encoder.encode(`data: ${JSON.stringify({ updated: true })}\n\n`)); } catch { streams.delete(stream); } } };
const dist = resolve(import.meta.dir, '../dist');
const desktop = { id: 'workspace-desktop', botId: 'assistant', state: 'stopped', width: 1280, height: 800 };
const server = Bun.serve({
  hostname: '127.0.0.1', port: Number(process.env.UI_PREVIEW_PORT ?? 7441), idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === '/__test/requests') return Response.json(requests);
    if (path === '/api/auth/status') return Response.json({ authRequired: process.env.UI_PREVIEW_AUTH === '1' });
    if (path === '/api/state') return Response.json(state);
    if (path === '/api/stream') {
      let current: ReadableStreamDefaultController<Uint8Array>;
      return new Response(new ReadableStream({ start(controller) { current = controller; streams.add(controller); controller.enqueue(encoder.encode(': ready\n\n')); }, cancel() { streams.delete(current); } }), { headers: { 'content-type': 'text/event-stream' } });
    }
    if (path.startsWith('/api/')) {
      let body: any;
      try { body = req.method === 'POST' || req.method === 'PUT' ? await req.json() : undefined; }
      catch { return Response.json({ error: 'Expected a JSON body' }, { status: 400 }); }
      requests.push({ method: req.method, path, body });
      if (path === '/api/messages' && req.method === 'POST') {
        if (body.text === 'simulate-error') return Response.json({ error: 'Preview: simulated send failure' }, { status: 503 });
        const seq = Math.max(...state.messages.map(message => message.seq)) + 1;
        state.messages.push({ id: `preview-${seq}`, botId: body.botId, conversationId: 'default', sender: 'user', kind: 'message', text: body.text, createdAt: new Date().toISOString(), seq, status: 'sent' });
        publish(); return Response.json({ accepted: true }, { status: 202 });
      }
      if (path.includes('/computers/')) {
        const action = path.split('/').at(-1);
        if (action === 'start') desktop.state = 'ready';
        if (action === 'stop') desktop.state = 'stopped';
        if (action === 'watch' || action === 'takeover') return Response.json({});
        if (action === 'shot') return Response.json({ error: 'Preview has no real desktop' }, { status: 503 });
        return Response.json(desktop);
      }
      if (path === '/api/providers/models') return Response.json({ models: [{ id: 'gpt-4.1-mini', name: 'GPT-4.1 mini' }, { id: 'gpt-4o', name: 'GPT-4o' }, { id: 'o3', name: 'o3' }] });
      const peers = path.match(/^\/api\/bots\/([^/]+)\/peers\/([^/]+)\/messages$/);
      if (peers) return Response.json(thread);
      if (path === '/api/providers') state.providers = body.providers;
      if (path === '/api/defaults') state.defaults = body;
      else if (path === '/api/connectors') state.connectors = [...state.connectors.filter(connector => connector.id !== body.id), body];
      else if (path === '/api/sources' && req.method === 'POST') state.sources = [...state.sources.filter(source => source.id !== body.id), body];
      else if (path.startsWith('/api/sources/')) {
        const [, , , id, action] = path.split('/');
        if (req.method === 'DELETE') state.sources = state.sources.filter(source => source.id !== id);
        else { const source = state.sources.find(source => source.id === id); if (source && action !== 'trigger') source.enabled = action === 'enable'; }
      } else if (path === '/api/bots' && req.method === 'POST') {
        const bot = { ...body, id: `bot-${Math.random().toString(36).slice(2, 6)}`, paused: false, bindings: [{ id: 'computer', connectorId: 'computer', config: { desktopId: 'preview-desktop' } }] };
        state.bots.push(bot);
        state.statuses.push({ botId: bot.id, state: 'idle', pending: 0 });
        const seq = Math.max(...state.messages.map((message) => message.seq)) + 1;
        state.messages.push({ id: `welcome-${bot.id}`, botId: bot.id, conversationId: 'default', sender: bot.id, text: en ? `Hi, I am ${bot.name}.${bot.description ? ` I can ${bot.description.replace(/[.]$/, '').toLowerCase()}.` : ''} What would you like me to start with?` : `你好，我是${bot.name}。${bot.description ? `我会${bot.description.replace(/[。.]$/, '')}。` : ''}你希望我先做什么？`, kind: 'ask', options: en ? ['Organize my notes', 'Make a plan', 'Tell me what you can do'] : ['帮我整理资料', '制定一个计划', '先介绍一下你能做什么'], status: 'sent', seq, createdAt: new Date().toISOString() });
        return Response.json(bot, { status: 201 });
      }
      else if (path.startsWith('/api/bots/')) {
        const [, , , id, action] = path.split('/'); const bot = state.bots.find(bot => bot.id === id);
        if (bot && req.method === 'PUT') Object.assign(bot, body);
        else if (bot && action) { bot.paused = action !== 'resume'; state.statuses = state.statuses.map(status => status.botId === id ? { ...status, state: bot.paused ? 'paused' : 'idle' } : status); }
      }
      publish(); return Response.json(body ?? { ok: true });
    }
    const requested = resolve(dist, `.${decodeURIComponent(path)}`);
    if (!requested.startsWith(`${dist}/`) && requested !== dist) return new Response('Invalid path', { status: 400 });
    const asset = Bun.file(requested);
    const file = await asset.exists() && !path.endsWith('/') ? asset : Bun.file(resolve(dist, 'index.html'));
    const shot = url.searchParams.get('shot');
    if (shot && await file.exists()) {
      const locale = url.searchParams.get('shot-locale') === 'en' ? 'en' : 'zh';
      let html = await file.text();
      const setup = `<script>try{localStorage.setItem('dudu.locale','${locale}');localStorage.setItem('dudu.theme','dark');localStorage.setItem('dudu.sidebar','open')}catch(e){}</script>`;
      html = html.replace('<head>', `<head>${setup}`);
      const action = shot === 'thread'
        ? `<script>addEventListener('load',()=>{let n=0;const t=setInterval(()=>{const l=document.querySelector('[role="log"]');if(l&&l.parentElement)l.parentElement.scrollTop=l.parentElement.scrollHeight;const el=document.querySelector('.bot-thread-chip');if(el){el.click();clearInterval(t)}if(++n>80)clearInterval(t)},100)})</script>`
        : `<script>addEventListener('load',()=>{const l=document.querySelector('[role="log"]');if(l&&l.parentElement)l.parentElement.scrollTop=l.parentElement.scrollHeight})</script>`;
      html = html.replace('</body>', `${action}</body>`);
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return new Response(file);
  },
});
console.log(`Isolated UI preview: http://127.0.0.1:${server.port} (${en ? 'en' : 'zh'} fixtures, in-memory only)`);
