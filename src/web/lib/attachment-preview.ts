import type { MessageAttachment } from '../../contracts';
import { fetchBlob } from './api';
import { attachmentKind } from './preview';

const TEXT_LIMIT = 20_000;

export async function loadAttachmentPreview(token: string, attachment: MessageAttachment, signal: AbortSignal) {
  const blob = await fetchBlob(token, attachment.url.replace(/^\/api/, ''), signal);
  signal.throwIfAborted();
  const content = attachmentKind(attachment.mime, attachment.name) === 'text' ? await blob.text() : '';
  signal.throwIfAborted();
  return { blob, text: content.slice(0, TEXT_LIMIT), truncated: content.length > TEXT_LIMIT };
}

export async function downloadAttachment(token: string, attachment: MessageAttachment): Promise<void> {
  const blob = await fetchBlob(token, attachment.url.replace(/^\/api/, ''), new AbortController().signal);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
