import type { MessageAttachment } from '../../contracts';
import { fetchBlob } from './api';
import { previewKind } from './preview';

const TEXT_LIMIT = 20_000;

export async function loadAttachmentPreview(token: string, attachment: MessageAttachment, signal: AbortSignal) {
  const blob = await fetchBlob(token, attachment.url.replace(/^\/api/, ''), signal);
  signal.throwIfAborted();
  const content = previewKind(attachment.mime) === 'text' ? await blob.text() : '';
  signal.throwIfAborted();
  return { blob, text: content.slice(0, TEXT_LIMIT), truncated: content.length > TEXT_LIMIT };
}
