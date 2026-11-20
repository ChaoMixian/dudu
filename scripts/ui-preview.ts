import { resolve } from 'node:path';
import type { AppState } from '../src/web/lib/types';
import { renderAvatar } from '../src/web/lib/avatar-styles';

// UI-only, in-memory fixtures. This server never starts a scheduler, model, or desktop.
// Set UI_PREVIEW_LANG=en to render the English fixture used by README.en.md screenshots.
const en = process.env.UI_PREVIEW_LANG === 'en';
const createdAt = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const bots = en ? [
  { id: 'assistant', name: 'Workspace Assistant', description: 'Organizes information, breaks down tasks, and follows every step.', avatar: 'dicebear:gaze:dudu-assistant', color: 'teal', provider: 'local', model: 'workspace-model', paused: false, computer: { desktopId: 'workspace-desktop', width: 1280, height: 800 } },
  { id: 'developer', name: 'Dev Partner', description: 'Reviews code, finds problems, and records verification results.', avatar: 'dicebear:gaze:dudu-developer', color: 'blue', provider: 'local', model: 'workspace-model', paused: true, computer: {} },
  { id: 'ideas', name: 'Idea Notes', description: 'Turns scattered thoughts into actionable plans.', avatar: 'dicebear:gaze:dudu-ideas', color: 'amber', provider: 'local', model: 'workspace-model', paused: false, computer: {} },
] : [
  { id: 'assistant', name: '工作助手', description: '整理信息、拆解任务，跟进每一步。', avatar: 'dicebear:gaze:dudu-assistant', color: 'teal', provider: 'local', model: 'workspace-model', paused: false, computer: { desktopId: 'workspace-desktop', width: 1280, height: 800 } },
  { id: 'developer', name: '开发搭档', description: '审阅代码、定位问题、记录验证结果。', avatar: 'dicebear:gaze:dudu-developer', color: 'blue', provider: 'local', model: 'workspace-model', paused: true, computer: {} },
  { id: 'ideas', name: '灵感笔记', description: '把零散想法整理成可执行的方案。', avatar: 'dicebear:gaze:dudu-ideas', color: 'amber', provider: 'local', model: 'workspace-model', paused: false, computer: {} },
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
  profile: { name: en ? 'Chao' : '炒米线', avatar: await renderAvatar('gaze', 'classic', 'dudu-profile', 80), avatarStyle: 'gaze', avatarPreset: 'classic' },
  connectors: [],
  providers: [{ id: 'local', name: 'Local workspace', api: 'openai-completions', baseUrl: 'http://127.0.0.1:9999/v1', apiKey: 'preview-key', models: [{ id: 'workspace-model', name: 'Workspace model' }, { id: 'reasoning-model', name: 'Reasoning model' }] }],
  defaults: { provider: 'local', model: 'workspace-model' },
  autoStartComputers: true,
  setupCompleted: true,
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
const previewCatalog = [
  { id: 'bark', name: 'Bark', description: '发送 Bark / iOS 推送。', category: 'notify', fields: [{ key: 'pushUrl', label: '推送地址', type: 'password', required: true, placeholder: 'https://api.day.app/your-key' }], tools: [] },
  { id: 'weather', name: '天气', description: '查询天气、预报和空气质量。', category: 'utility', fields: [{ key: 'city', label: '城市', type: 'text', required: true, placeholder: '例如：杭州' }], tools: [] },
  { id: 'caldav', name: 'CalDAV', description: '读写 iCloud 或标准 CalDAV 日历。', category: 'calendar', fields: [{ key: 'preset', label: '服务商', type: 'select', defaultValue: 'icloud', options: [{ value: 'icloud', label: 'iCloud' }, { value: 'custom', label: '自定义 CalDAV' }] }, { key: 'serverUrl', label: '服务器地址', type: 'url', visibleWhen: { key: 'preset', equals: 'custom' } }, { key: 'username', label: '用户名', type: 'text', required: true }, { key: 'password', label: 'App 专用密码', type: 'password', required: true }], tools: [] },
  { id: 'outlook', name: 'Outlook Calendar', description: '读写 Outlook / Microsoft 365 日历。', category: 'calendar', connect: { kind: 'device-code', credentials: ['refreshToken'] }, fields: [], tools: [] },
  { id: 'weixin', name: '微信', description: '接入个人微信，收发消息。', category: 'message', connect: { kind: 'qr', credentials: ['token'] }, fields: [{ key: 'botId', label: '绑定 Bot', type: 'bot', required: true }], tools: [] },
];
const previewPopular = [
  { id: 'vercel-labs/skills/find-skills', name: 'find-skills', source: 'vercel-labs/skills', skillId: 'find-skills', installs: 4413641 },
  { id: 'mattpocock/skills/grill-me', name: 'grill-me', source: 'mattpocock/skills', skillId: 'grill-me', installs: 1568415 },
  { id: 'vercel-labs/agent-browser/agent-browser', name: 'agent-browser', source: 'vercel-labs/agent-browser', skillId: 'agent-browser', installs: 1503442 },
  { id: 'designed-by-ai/skills/design-mobile-apps', name: 'design-mobile-apps', source: 'designed-by-ai/skills', skillId: 'design-mobile-apps', installs: 1483875 },
  { id: 'flowkit-labs/skills/reddit-automation', name: 'reddit-automation', source: 'flowkit-labs/skills', skillId: 'reddit-automation', installs: 1431227 },
  { id: 'mattpocock/skills/tdd', name: 'tdd', source: 'mattpocock/skills', skillId: 'tdd', installs: 1252860 },
];

function pdfFixture(): Uint8Array {
  const stream = 'BT /F1 24 Tf 72 720 Td (dudu PDF preview) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

async function officeFixture(kind: 'docx' | 'xlsx'): Promise<{ bytes: Uint8Array; mime: string }> {
  if (kind === 'xlsx') {
    const XLSX = await import('xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Name', 'Value'], ['Alpha', 1], ['Beta', 2], ['Gamma', 3]]), 'Data');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['A', 'B'], ['one', 'two']]), 'Notes');
    return { bytes: new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  if (kind === 'docx') {
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>dudu Office preview</w:t></w:r></w:p><w:p><w:r><w:t>Word documents render in the preview box.</w:t></w:r></w:p><w:p><w:r><w:t>This text comes from a minimal DOCX fixture.</w:t></w:r></w:p></w:body></w:document>');
    return { bytes: await zip.generateAsync({ type: 'uint8array' }), mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }
}
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
    if (/^\/api\/connectors\/[^/]+\/disconnect$/.test(path) && req.method === 'POST') {
      const connector = state.connectors.find(item => item.id === decodeURIComponent(path.split('/')[3]!));
      if (connector) { connector.credentialsSet = []; connector.runtime = { state: 'stopped' }; publish(); }
      return Response.json({ ok: true });
    }
    if (/^\/api\/connectors\/[^/]+\/weixin\/login\/start$/.test(path) && req.method === 'POST') return Response.json({ sessionKey: 'preview-login', qrUrl: 'https://example.com/weixin-preview' });
    if (/^\/api\/connectors\/[^/]+\/weixin\/login\/poll$/.test(path) && req.method === 'POST') return Response.json({ state: 'wait', message: en ? 'Waiting for scan…' : '等待扫码…' });
    if (/^\/api\/connectors\/[^/]+\/outlook\/device\/start$/.test(path) && req.method === 'POST') return Response.json({ deviceCode: 'preview-device', userCode: 'ABC123', verificationUri: 'https://microsoft.com/devicelogin', interval: 5 });
    if (/^\/api\/connectors\/[^/]+\/outlook\/device\/poll$/.test(path) && req.method === 'POST') return Response.json({ status: 'pending', message: en ? 'Waiting for Microsoft sign-in…' : '等待 Microsoft 登录…' });
    if (path === '/api/preview/attachments/sample.md' && req.method === 'GET') return new Response('# Markdown preview\n\n- **bold**\n- [link](https://example.com)\n\n```js\nconsole.log("dudu")\n```\n', { headers: { 'content-type': 'text/markdown' } });
    if (path === '/api/preview/attachments/sample.txt' && req.method === 'GET') return new Response('Plain text preview\nSecond line\n', { headers: { 'content-type': 'text/plain' } });
    if (path === '/api/preview/attachments/sample.pdf' && req.method === 'GET') return new Response(pdfFixture(), { headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store' } });
    if (/^\/api\/preview\/attachments\/sample\.(docx|xlsx)$/.test(path) && req.method === 'GET') {
      const result = await officeFixture(path.split('.').pop() as 'docx' | 'xlsx');
      return new Response(result.bytes, { headers: { 'content-type': result.mime, 'cache-control': 'no-store' } });
    }
    if (path === '/api/preview/attachments/tall.svg' && req.method === 'GET') {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1600" viewBox="0 0 800 1600"><rect width="800" height="1600" fill="#f8fafc"/><rect x="48" y="48" width="704" height="1504" rx="18" fill="#fff" stroke="#dbe3ee" stroke-width="4"/><g fill="#334155" font-family="sans-serif"><text x="90" y="140" font-size="42" font-weight="700">Long screenshot</text>${Array.from({length:12},(_,i)=>`<text x="90" y="${230+i*100}" font-size="26">Row ${i+1}: mobile preview content</text>`).join('')}</g></svg>`;
      return new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' } });
    }
    if (path.startsWith('/api/preview/attachments/') && req.method === 'GET') {
      const label = path.endsWith('/board.svg') ? 'Experiment board' : 'Whiteboard';
      const color = path.endsWith('/board.svg') ? '#1d4ed8' : '#e5e7eb';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="${color}"/><rect x="80" y="80" width="1040" height="640" rx="18" fill="#ffffff" stroke="#94a3b8" stroke-width="8"/><g fill="#334155" font-family="sans-serif"><text x="140" y="190" font-size="54" font-weight="700">${label}</text><text x="140" y="280" font-size="32">DR · BUS · M = 0</text><text x="140" y="340" font-size="32">PCout / PCin / LADR</text><text x="140" y="400" font-size="32">实验结果表改成三列</text><text x="140" y="460" font-size="32">检查白板与实验设备</text></g></svg>`;
      return new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' } });
    }
    if (path === '/api/weixin/login/start' && req.method === 'POST') return Response.json({ sessionKey: 'preview-login', qrUrl: 'https://example.com/weixin-preview' });
    if (path === '/api/weixin/login/poll' && req.method === 'POST') return Response.json({ state: 'wait', message: en ? 'Waiting for scan…' : '等待扫码…' });
    if (path === '/api/outlook/device/start' && req.method === 'POST') return Response.json({ deviceCode: 'preview-device', userCode: 'ABC123', verificationUri: 'https://microsoft.com/devicelogin', interval: 5 });
    if (path === '/api/outlook/device/poll' && req.method === 'POST') return Response.json({ status: 'pending', message: en ? 'Waiting for Microsoft sign-in…' : '等待 Microsoft 登录…' });
    if (path.startsWith('/api/')) {
      let body: any;
      try { body = req.method === 'POST' || req.method === 'PUT' ? await req.json() : undefined; }
      catch { return Response.json({ error: 'Expected a JSON body' }, { status: 400 }); }
      requests.push({ method: req.method, path, body });
      if (path === '/api/connectors/catalog') return Response.json({ providers: previewCatalog });
      if (path === '/api/skills') return Response.json({ skills: [] });
      if (path === '/api/skills/popular') return Response.json({ skills: previewPopular });
      if (path === '/api/skills/describe') return Response.json({ descriptions: {} });
      if (path === '/api/skills/search') return Response.json({ skills: [] });
      if (path.startsWith('/api/connectors/') && req.method === 'DELETE') {
        const id = path.split('/')[3];
        state.connectors = state.connectors.filter(connector => connector.id !== id);
        publish(); return Response.json({ removed: true });
      }
      if (path === '/api/messages' && req.method === 'POST') {
        if (body.text === 'simulate-error') return Response.json({ error: 'Preview: simulated send failure' }, { status: 503 });
        const seq = Math.max(...state.messages.map(message => message.seq)) + 1;
        state.messages.push({ id: `preview-${seq}`, botId: body.botId, conversationId: 'default', sender: 'user', kind: 'message', text: body.text, createdAt: new Date().toISOString(), seq, status: 'sent', ...(Array.isArray(body.attachments) ? { attachments: body.attachments } : {}) });
        publish(); return Response.json({ accepted: true }, { status: 202 });
      }
      if (path === '/api/computer/doctor') return Response.json({
        doctor: { dependencies: Object.fromEntries(['Xvfb', 'xfce4-session', 'xfwm4', 'xfce4-panel', 'xfdesktop', 'xauth', 'xdpyinfo', 'xprop', 'xdotool', 'xclip', 'ffmpeg', 'dbus-daemon'].map(key => [key, `/usr/bin/${key}`]).concat([['voxl', null]])) },
        desktops: [desktop],
        bots: bots.map(bot => ({ id: bot.id, name: bot.name })),
      });
      if (path.includes('/computer/')) {
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
      else if (path === '/api/connectors') { const previous = state.connectors.find(connector => connector.id === body.id); state.connectors = [...state.connectors.filter(connector => connector.id !== body.id), previous ? { ...previous, ...body, runtime: body.runtime ?? previous.runtime, credentialsSet: body.credentialsSet ?? previous.credentialsSet } : body]; }
      else if (path === '/api/sources' && req.method === 'POST') state.sources = [...state.sources.filter(source => source.id !== body.id), body];
      else if (path.startsWith('/api/sources/')) {
        const [, , , id, action] = path.split('/');
        if (req.method === 'DELETE') state.sources = state.sources.filter(source => source.id !== id);
        else { const source = state.sources.find(source => source.id === id); if (source && action !== 'trigger') source.enabled = action === 'enable'; }
      } else if (path === '/api/bots' && req.method === 'POST') {
        const bot = { ...body, id: `bot-${Math.random().toString(36).slice(2, 6)}`, paused: false, computer: { desktopId: 'preview-desktop', width: 1280, height: 800 } };
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
