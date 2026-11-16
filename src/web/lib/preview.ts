export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'file';

export function previewKind(mime: string): PreviewKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('text/') || ['application/json', 'application/xml', 'application/yaml', 'application/toml', 'application/x-ndjson'].includes(mime)) return 'text';
  return 'file';
}

export const TEXT_PREVIEW_LIMIT = 100_000;
