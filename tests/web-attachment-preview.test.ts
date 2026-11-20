import { afterEach, expect, test } from 'bun:test';
import type { MessageAttachment } from '../src/contracts';
import { loadAttachmentPreview } from '../src/web/lib/attachment-preview';
import { attachmentKind, attachmentLabel, isMarkdown } from '../src/web/lib/preview';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const attachment: MessageAttachment = { id: 'a', name: 'note.txt', mime: 'text/plain', size: 5, url: '/api/artifacts/bot/note.txt' };

function respond(response: Response) {
  globalThis.fetch = (async () => response) as unknown as typeof fetch;
}

test('attachment loader forwards auth and cancellation and returns complete text', async () => {
  const controller = new AbortController();
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    expect(input).toBe('/api/artifacts/bot/note.txt');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-token');
    expect(init?.signal).toBe(controller.signal);
    return new Response('hello');
  }) as unknown as typeof fetch;
  const result = await loadAttachmentPreview('test-token', attachment, controller.signal);
  expect(result.text).toBe('hello');
  expect(result.truncated).toBe(false);
  expect(await result.blob.text()).toBe('hello');
});

test('attachment text truncation distinguishes exact limit from overflow', async () => {
  for (const length of [0, 20_000, 20_001]) {
    respond(new Response('x'.repeat(length)));
    const result = await loadAttachmentPreview('', attachment, new AbortController().signal);
    expect(result.text.length).toBe(Math.min(length, 20_000));
    expect(result.truncated).toBe(length > 20_000);
  }
});

test('binary attachments are not decoded as text', async () => {
  respond(new Response(new Uint8Array([0, 255, 128])));
  const result = await loadAttachmentPreview('', { ...attachment, mime: 'image/png' }, new AbortController().signal);
  expect(result.text).toBe('');
  expect(result.blob.size).toBe(3);
});

test('HTTP failures propagate so retry can issue a fresh request', async () => {
  respond(new Response('Unavailable', { status: 503 }));
  await expect(loadAttachmentPreview('', attachment, new AbortController().signal)).rejects.toThrow('Unavailable');
  respond(new Response('recovered'));
  expect((await loadAttachmentPreview('', attachment, new AbortController().signal)).text).toBe('recovered');
});

test('cancelled download cannot publish a result even if fetch resolves late', async () => {
  const controller = new AbortController();
  globalThis.fetch = (async () => { controller.abort(); return new Response('late'); }) as unknown as typeof fetch;
  await expect(loadAttachmentPreview('', attachment, controller.signal)).rejects.toThrow();
});

test('cancellation during text decoding cannot publish stale content', async () => {
  const controller = new AbortController();
  const blob = new Blob(['late']);
  blob.text = async () => { controller.abort(); return 'late'; };
  const response = new Response();
  response.blob = async () => blob;
  respond(response);
  await expect(loadAttachmentPreview('', attachment, controller.signal)).rejects.toThrow();
});

test('office formats are detected by mime or extension', () => {
  expect(attachmentKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'report.docx')).toBe('word');
  expect(attachmentKind('application/octet-stream', 'report.docx')).toBe('word');
  expect(attachmentKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'data.xlsx')).toBe('spreadsheet');
  expect(attachmentKind('application/vnd.ms-excel', 'data.xls')).toBe('spreadsheet');
  expect(attachmentKind('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'deck.pptx')).toBe('presentation');
  expect(attachmentKind('application/msword', 'legacy.doc')).toBe('file');
  expect(attachmentKind('application/pdf', 'report.pdf')).toBe('pdf');
});

test('attachment labels prefer the file extension', () => {
  expect(attachmentLabel('report.pdf', 'pdf')).toBe('PDF');
  expect(attachmentLabel('deck.pptx', 'presentation')).toBe('PPTX');
  expect(attachmentLabel('no-extension', 'word')).toBe('DOC');
});

test('text and markdown extensions preview even with a generic mime type', () => {
  expect(attachmentKind('application/octet-stream', 'notes.md')).toBe('text');
  expect(attachmentKind('application/octet-stream', 'readme.txt')).toBe('text');
  expect(attachmentKind('text/plain', 'notes.markdown')).toBe('text');
  expect(isMarkdown('notes.md')).toBe(true);
  expect(isMarkdown('NOTES.MARKDOWN')).toBe(true);
  expect(isMarkdown('notes.txt')).toBe(false);
});
