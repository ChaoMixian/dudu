import { useEffect, useState } from 'react';
import { Spinner } from '@heroui/react';
import type { MessageAttachment } from '../../contracts';
import { errorText, fetchBlob } from '../lib/api';
import { formatBytes } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';
import Icon from './Icon';

function previewKind(mime: string): 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'file' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('text/') || ['application/json', 'application/xml', 'application/yaml', 'application/toml', 'application/x-ndjson'].includes(mime)) return 'text';
  return 'file';
}

function Attachment({ attachment }: { attachment: MessageAttachment }) {
  const { token } = useAuth();
  const { t } = useI18n();
  const [url, setUrl] = useState<string>();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const kind = previewKind(attachment.mime);

  useEffect(() => {
    let objectUrl: string | undefined;
    let cancelled = false;
    setUrl(undefined);
    setText('');
    setError('');
    void fetchBlob(token, attachment.url.replace(/^\/api/, '')).then(async blob => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
      if (kind === 'text') {
        const content = await blob.text();
        if (!cancelled) setText(content.slice(0, 20000));
      }
    }).catch(cause => { if (!cancelled) setError(errorText(cause)); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.url, kind, token]);

  return (
    <div className={`attachment attachment-${kind}`}>
      <div className="attachment-head">
        <span className="attachment-icon"><Icon name={kind === 'image' ? 'image' : 'file'} size={17} /></span>
        <span className="attachment-meta">
          <span className="attachment-name" title={attachment.name}>{attachment.name}</span>
          <span className="attachment-sub">{formatBytes(attachment.size)} · {attachment.mime}</span>
        </span>
        {url
          ? <a className="attachment-download" href={url} download={attachment.name} aria-label={t('message.downloadFile')}><Icon name="download" size={16} /></a>
          : <Spinner size="sm" />}
      </div>
      {error && <p className="attachment-error" role="alert">{t('message.attachmentFailed')}</p>}
      {!error && kind === 'image' && url && (
        <a className="attachment-image-link" href={url} target="_blank" rel="noreferrer"><img className="attachment-image" src={url} alt={attachment.name} loading="lazy" /></a>
      )}
      {!error && kind === 'video' && url && <video className="attachment-video" src={url} controls playsInline preload="metadata" />}
      {!error && kind === 'audio' && url && <audio className="attachment-audio" src={url} controls preload="metadata" />}
      {!error && kind === 'pdf' && url && <iframe className="attachment-pdf" src={url} title={attachment.name} />}
      {!error && kind === 'text' && (url
        ? <pre className="attachment-text">{text}{text.length >= 20000 ? '\n…' : ''}</pre>
        : <div className="attachment-loading"><Spinner size="sm" /></div>)}
    </div>
  );
}

export default function MessageAttachments({ attachments }: { attachments?: MessageAttachment[] }) {
  if (!attachments?.length) return null;
  return <div className="message-attachments">{attachments.map(attachment => <Attachment key={attachment.id} attachment={attachment} />)}</div>;
}
