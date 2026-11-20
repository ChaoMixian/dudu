import { useEffect, useRef, useState } from 'react';
import { Spinner } from '@heroui/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { MessageAttachment } from '../../contracts';
import { downloadAttachment, loadAttachmentPreview } from '../lib/attachment-preview';
import { errorText } from '../lib/api';
import { formatBytes } from '../lib/format';
import { attachmentKind, attachmentLabel, isMarkdown } from '../lib/preview';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';
import { useLive } from '../state/LiveContext';
import AttachmentPreviewDialog from './AttachmentPreviewDialog';
import Icon from './Icon';
import OfficePreview from './OfficePreview';
import PdfThumbnail from './PdfThumbnail';

type Thumbnail = { status: 'loading' } | { status: 'error' } | { status: 'ready'; url?: string; blob?: Blob; text?: string };

function Attachment({ attachment, token }: { attachment: MessageAttachment; token: string }) {
  const { t } = useI18n();
  const { notify } = useLive();
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [thumbnail, setThumbnail] = useState<Thumbnail>({ status: 'loading' });
  const hostRef = useRef<HTMLDivElement>(null);
  const kind = attachmentKind(attachment.mime, attachment.name);
  const label = attachmentLabel(attachment.name, kind);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: '400px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const office = kind === 'word' || kind === 'spreadsheet' || kind === 'presentation';
    if (!visible || (kind !== 'image' && kind !== 'pdf' && kind !== 'text' && !office)) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setThumbnail({ status: 'loading' });
    void loadAttachmentPreview(token, attachment, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (kind === 'image') {
        objectUrl = URL.createObjectURL(result.blob);
        setThumbnail({ status: 'ready', url: objectUrl });
      } else if (kind === 'text') {
        setThumbnail({ status: 'ready', text: result.text });
      } else {
        setThumbnail({ status: 'ready', blob: result.blob });
      }
    }).catch(() => { if (!controller.signal.aborted) setThumbnail({ status: 'error' }); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [visible, kind, token, attachment.url, attachment.mime, attachment.name]);

  const download = async () => {
    try { await downloadAttachment(token, attachment); }
    catch (cause) { notify('error', errorText(cause)); }
  };

  return <div ref={hostRef} className="attachment-card-wrap">
    {kind === 'image' || kind === 'pdf' || kind === 'word' || kind === 'spreadsheet' || kind === 'presentation' || kind === 'text' ? <div className={`attachment-card attachment-card-${kind === 'image' ? 'image' : kind === 'pdf' ? 'pdf' : kind === 'text' ? 'text' : 'office'}`}>
      {kind === 'image' && <button type="button" className="attachment-card-hit" aria-label={`${t('message.preview')}: ${attachment.name}`} title={t('message.preview')} onClick={() => setOpen(true)} />}
      {kind === 'image' && (thumbnail.status === 'ready' && thumbnail.url
        ? <img src={thumbnail.url} alt={attachment.name} />
        : <span className="attachment-card-placeholder">{thumbnail.status === 'error' ? <Icon name="file" size={22} /> : <Spinner size="sm" aria-label={t('message.attachmentLoading')} />}</span>)}
      {kind === 'pdf' && (thumbnail.status === 'ready' && thumbnail.blob
        ? <PdfThumbnail blob={thumbnail.blob} />
        : <span className="attachment-card-placeholder">{thumbnail.status === 'error' ? <Icon name="file" size={22} /> : <Spinner size="sm" aria-label={t('message.attachmentLoading')} />}</span>)}
      {(kind === 'word' || kind === 'spreadsheet' || kind === 'presentation') && (thumbnail.status === 'ready' && thumbnail.blob
        ? <OfficePreview kind={kind} blob={thumbnail.blob} />
        : <span className="attachment-card-placeholder">{thumbnail.status === 'error' ? <Icon name="file" size={22} /> : <Spinner size="sm" aria-label={t('message.attachmentLoading')} />}</span>)}
      {kind === 'text' && (thumbnail.status === 'ready' && thumbnail.text !== undefined
        ? isMarkdown(attachment.name)
          ? <div className="chat-markdown attachment-card-markdown"><Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{thumbnail.text}</Markdown></div>
          : <pre className="attachment-card-text-content">{thumbnail.text}</pre>
        : <span className="attachment-card-placeholder">{thumbnail.status === 'error' ? <Icon name="file" size={22} /> : <Spinner size="sm" aria-label={t('message.attachmentLoading')} />}</span>)}
      <span className="attachment-card-caption"><span className="attachment-card-name" title={attachment.name}>{attachment.name}</span></span>
      <button type="button" className="attachment-card-expand" aria-label={t('message.preview')} title={t('message.preview')} onClick={() => setOpen(true)}><Icon name="expand" size={14} /></button>
      <button type="button" className="attachment-card-download" aria-label={t('message.downloadFile')} title={t('message.downloadFile')} onClick={() => void download()}><Icon name="download" size={15} /></button>
    </div> : <div className="attachment-card attachment-file-card">
      <button type="button" className="attachment-card-hit" aria-label={`${t('message.preview')}: ${attachment.name}`} title={t('message.preview')} onClick={() => setOpen(true)} />
      <span className="attachment-format" data-kind={kind}>{label}</span>
      <span className="attachment-file-meta"><span className="attachment-card-name" title={attachment.name}>{attachment.name}</span><span className="attachment-card-sub">{formatBytes(attachment.size)} · {label}</span></span>
      <span className="attachment-file-open" aria-hidden="true"><Icon name="chevron" size={14} /></span>
      <button type="button" className="attachment-card-download attachment-card-download-file" aria-label={t('message.downloadFile')} title={t('message.downloadFile')} onClick={() => void download()}><Icon name="download" size={15} /></button>
    </div>}
    {open && <AttachmentPreviewDialog attachment={attachment} imageUrl={kind === 'image' && thumbnail.status === 'ready' ? thumbnail.url : undefined} onClose={() => setOpen(false)} />}
  </div>;
}

export default function MessageAttachments({ attachments }: { attachments?: MessageAttachment[] }) {
  const { token } = useAuth();
  if (!attachments?.length) return null;
  return <div className="message-attachments">{attachments.map(attachment => <Attachment key={`${attachment.id}:${attachment.url}:${attachment.mime}:${token}`} attachment={attachment} token={token} />)}</div>;
}
