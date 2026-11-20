export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'file';
export type OfficeKind = 'word' | 'spreadsheet' | 'presentation';
export type AttachmentKind = PreviewKind | OfficeKind;

export function previewKind(mime: string): PreviewKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('text/') || ['application/json', 'application/xml', 'application/yaml', 'application/toml', 'application/x-ndjson'].includes(mime)) return 'text';
  return 'file';
}

const textExtensions = new Set(['md', 'markdown', 'txt', 'log', 'json', 'yaml', 'yml', 'xml', 'csv', 'toml', 'ini', 'conf', 'ts', 'tsx', 'js', 'jsx', 'css', 'html', 'sh', 'py', 'go', 'rs']);

export function attachmentKind(mime: string, name: string): AttachmentKind {
  if (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/') || mime === 'application/pdf') return previewKind(mime);
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || extension === 'docx') return 'word';
  if (['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'].includes(mime) || extension === 'xlsx' || extension === 'xls') return 'spreadsheet';
  if (mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || extension === 'pptx') return 'presentation';
  if (textExtensions.has(extension)) return 'text';
  return previewKind(mime);
}

export function isMarkdown(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

export function attachmentLabel(name: string, kind: AttachmentKind): string {
  const extension = name.split('.').pop()?.toUpperCase() ?? '';
  return extension && extension.length <= 5 ? extension : ({ word: 'DOC', spreadsheet: 'SHEET', presentation: 'SLIDE', image: 'IMAGE', video: 'VIDEO', audio: 'AUDIO', pdf: 'PDF', text: 'TEXT', file: 'FILE' } satisfies Record<AttachmentKind, string>)[kind];
}

export const TEXT_PREVIEW_LIMIT = 100_000;
