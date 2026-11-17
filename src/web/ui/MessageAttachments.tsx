import { useEffect, useRef, useState } from 'react';
import { Spinner } from '@heroui/react';
import type { MessageAttachment } from '../../contracts';
import { loadAttachmentPreview } from '../lib/attachment-preview';
import { previewKind } from '../lib/preview';
import { formatBytes } from '../lib/format';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';
import Icon from './Icon';

type Resource = { status: 'loading' } | { status: 'error' } | { status: 'ready'; url: string; text: string; truncated: boolean };

function Attachment({ attachment, token }: { attachment: MessageAttachment; token: string }) {
  const { t } = useI18n();
  const [resource, setResource] = useState<Resource>({ status: 'loading' });
  const [media, setMedia] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const kind = previewKind(attachment.mime);

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
    if (!visible) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setResource({ status: 'loading' });
    setMedia('loading');
    void loadAttachmentPreview(token, attachment, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(result.blob);
      setResource({ status: 'ready', url: objectUrl, text: result.text, truncated: result.truncated });
    }).catch(() => { if (!controller.signal.aborted) setResource({ status: 'error' }); });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [visible, attachment.url, attachment.mime, token, attempt]);

  const retry = () => {
    setResource({ status: 'loading' });
    setMedia('loading');
    setAttempt(value => value + 1);
  };
  const failed = resource.status === 'error' || media === 'error';
  const loading = !failed && (resource.status === 'loading'
    || (kind !== 'file' && kind !== 'text' && media === 'loading'));
  const failure = t(resource.status === 'error' ? 'message.attachmentFailed' : 'message.previewFailed');

  return (
    <div ref={hostRef} className="attachment">
      <div className="attachment-head">
        <span className="attachment-icon"><Icon name={kind === 'image' ? 'image' : 'file'} size={17} /></span>
        <span className="attachment-meta">
          <span className="attachment-name" title={attachment.name}>{attachment.name}</span>
          <span className={`attachment-sub${failed && kind === 'file' ? ' attachment-error-text' : ''}`} title={failed && kind === 'file' ? failure : attachment.mime} role={failed && kind === 'file' ? 'alert' : undefined}>
            {failed && kind === 'file' ? failure : `${formatBytes(attachment.size)} · ${attachment.mime}`}
          </span>
        </span>
        <span className="attachment-action">
          {resource.status === 'ready'
            ? <a className="attachment-download" href={resource.url} download={attachment.name} aria-label={t('message.downloadFile')} title={t('message.downloadFile')}><Icon name="download" size={16} /></a>
            : resource.status === 'error'
              ? <button className="attachment-download" type="button" onClick={retry} aria-label={t('common.retry')} title={t('common.retry')}><Icon name="refresh" size={16} /></button>
              : <Spinner size="sm" aria-label={t('message.attachmentLoading')} />}
        </span>
      </div>
      {kind !== 'file' && (
        <div className={`attachment-preview attachment-preview-${kind}`} data-error={failed ? 'true' : undefined} aria-busy={loading}>
          {resource.status === 'ready' && media !== 'error' && (kind === 'image'
            ? <a className="attachment-image-link" href={resource.url} target="_blank" rel="noreferrer"><img className="attachment-image" src={resource.url} alt={attachment.name} onLoad={() => setMedia('ready')} onError={() => setMedia('error')} /></a>
            : kind === 'video'
              ? <video className="attachment-video" src={resource.url} controls playsInline preload="metadata" onLoadedMetadata={() => setMedia('ready')} onError={() => setMedia('error')} />
              : kind === 'audio'
                ? <audio className="attachment-audio" src={resource.url} controls preload="metadata" onLoadedMetadata={() => setMedia('ready')} onError={() => setMedia('error')} />
                : kind === 'pdf'
                  ? <iframe className="attachment-pdf" src={resource.url} title={attachment.name} onLoad={() => setMedia('ready')} onError={() => setMedia('error')} />
                  : <pre className="attachment-text">{resource.text}{resource.truncated ? '\n…' : ''}</pre>)}
          {loading && <div className="attachment-placeholder"><Spinner size="sm" aria-label={t('message.attachmentLoading')} /></div>}
          {failed && <div className="attachment-placeholder attachment-error">
            <span role="alert">{failure}</span>
            <button className="attachment-retry" type="button" onClick={retry}>{t('common.retry')}</button>
          </div>}
        </div>
      )}
    </div>
  );
}

export default function MessageAttachments({ attachments }: { attachments?: MessageAttachment[] }) {
  const { token } = useAuth();
  if (!attachments?.length) return null;
  return <div className="message-attachments">{attachments.map(attachment => <Attachment key={`${attachment.id}:${attachment.url}:${attachment.mime}:${token}`} attachment={attachment} token={token} />)}</div>;
}
