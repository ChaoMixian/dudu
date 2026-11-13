// Local fixture model for dudu end-to-end verification without a real provider.
// Implements the OpenAI chat completions streaming API:
//  - First turn: emits a message_send tool call routed to the replyTo of the input event.
//  - After the tool result: emits a short plain-text finish so the run settles.
// Usage: bun examples/fixtures/model-fixture.ts [port]
import { serve } from 'bun';

const port = Number(process.argv[2] ?? 7340);
const enc = new TextEncoder();
const sse = (obj: unknown) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);

serve({
  hostname: '127.0.0.1',
  port,
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) {
      return Response.json({ error: `fixture only implements chat/completions, got ${req.method} ${url.pathname}` }, { status: 404 });
    }
    const body = await req.json() as { messages?: { role: string; content: unknown }[] };
    const text = (m: { content: unknown }) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
    const messages = body.messages ?? [];
    // Only the message immediately before this request decides the turn: after a tool result
    // we finish with text, otherwise we issue the message_send call. Older history is ignored.
    const sawToolResult = messages.length > 0 && messages[messages.length - 1]!.role === 'tool';
    const lastInput = messages.filter(m => m.role === 'user').map(text).join('\n').match(/\{[\s\S]*\}/);
    let userText = '';
    try { userText = String(JSON.parse(lastInput ? lastInput[0] : '{}').payload?.text ?? ''); } catch { /* keep empty */ }
    // “截图”请求改走 computer 工具，演示 agent 通过连接器操作专属桌面。
    const wantsShot = /截图|screenshot|shot/i.test(userText);
    if (wantsShot && !sawToolResult) {
      const args = JSON.stringify({});
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(sse({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_fixture_shot', type: 'function', function: { name: 'computer__screenshot', arguments: '' } }] }, finish_reason: null }] }));
          controller.enqueue(sse({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] }, finish_reason: null }] }));
          controller.enqueue(sse({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }));
          controller.enqueue(enc.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
    }
    let route = { kind: 'web', id: 'default' };
    let correlationId: string | undefined;
    try {
      const event = JSON.parse(lastInput ? lastInput[0] : '{}');
      if (event.replyTo?.kind && event.replyTo?.id) route = event.replyTo;
      if (event.correlationId) correlationId = event.correlationId;
    } catch { /* keep defaults */ }
    const stream = new ReadableStream({
      start(controller) {
        if (sawToolResult) {
          controller.enqueue(sse({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'fixture run complete' }, finish_reason: null }] }));
          controller.enqueue(sse({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
        } else {
          const args = JSON.stringify({ route, text: 'fixture reply via message_send', ...(correlationId ? { correlationId } : {}) });
          controller.enqueue(sse({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_fixture_1', type: 'function', function: { name: 'message_send', arguments: '' } }] }, finish_reason: null }] }));
          controller.enqueue(sse({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] }, finish_reason: null }] }));
          controller.enqueue(sse({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }));
        }
        controller.enqueue(enc.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
  },
});
console.log(`model fixture listening on http://127.0.0.1:${port}`);
