import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Spinner } from '@heroui/react';
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
import Icon from './Icon';
import IconButton from './IconButton';
import OfficePreview from './OfficePreview';

type Resource = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; url: string; text: string; blob: Blob | null };

export default function AttachmentPreviewDialog({ attachment, imageUrl, onClose }: { attachment: MessageAttachment; imageUrl?: string; onClose: () => void }) {
  const { token } = useAuth();
  const { t } = useI18n();
  const { notify } = useLive();
  const [resource, setResource] = useState<Resource>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const kind = attachmentKind(attachment.mime, attachment.name);
  const label = attachmentLabel(attachment.name, kind);

  useEffect(() => {
    if (kind === 'image' && imageUrl) { setResource({ status: 'ready', url: imageUrl, text: '', blob: null }); return; }
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setResource({ status: 'loading' });
    void loadAttachmentPreview(token, attachment, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(result.blob);
      setResource({ status: 'ready', url: objectUrl, text: result.text, blob: result.blob });
    }).catch(cause => { if (!controller.signal.aborted) setResource({ status: 'error', message: errorText(cause) }); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [token, attachment.url, attachment.mime, attachment.name, kind, imageUrl, attempt]);

  const download = async () => {
    try { await downloadAttachment(token, attachment); }
    catch (cause) { notify('error', errorText(cause)); }
  };

  return <Modal isOpen onOpenChange={open => { if (!open) onClose(); }}>
    <Modal.Backdrop><Modal.Container size="lg" scroll="inside" placement="center"><Modal.Dialog className="flex flex-col" style={{ maxWidth: '76rem', height: 'min(90vh, 60rem)' }}>
      <Modal.Header>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="attachment-format attachment-format-modal">{label}</span>
            <div className="min-w-0"><Modal.Heading className="truncate">{attachment.name}</Modal.Heading><p className="truncate text-xs text-muted">{formatBytes(attachment.size)} · {label}</p></div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="secondary" aria-label={t('message.downloadFile')} onPress={() => void download()}><Icon name="download" size={15} /><span className="hidden sm:inline">{t('message.downloadFile')}</span></Button>
            <IconButton label={t('common.close')} onPress={onClose}><Icon name="close" size={17} /></IconButton>
          </div>
        </div>
      </Modal.Header>
      <Modal.Body className="min-h-0 flex-1 overflow-hidden p-0">
        {resource.status === 'loading' ? <div className="attachment-modal-loading"><Spinner size="sm" />{t('message.attachmentLoading')}</div> : resource.status === 'error' ? <div className="attachment-modal-loading"><Alert status="danger"><Alert.Content><Alert.Description>{resource.message || t('message.previewFailed')}</Alert.Description></Alert.Content></Alert><Button size="sm" variant="secondary" onPress={() => setAttempt(value => value + 1)}>{t('common.retry')}</Button></div> : <>
          {kind === 'image' && <div className="attachment-modal-image"><img src={resource.url} alt={attachment.name} /></div>}
          {kind === 'video' && <div className="attachment-modal-media"><video src={resource.url} controls playsInline autoPlay /></div>}
          {kind === 'audio' && <div className="attachment-modal-media"><audio src={resource.url} controls autoPlay /></div>}
          {kind === 'pdf' && <iframe className="attachment-modal-pdf" src={`${resource.url}#toolbar=0&navpanes=0&view=FitH`} title={attachment.name} />}
          {kind === 'text' && (isMarkdown(attachment.name)
            ? <div className="chat-markdown attachment-modal-markdown"><Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{resource.text}</Markdown></div>
            : <pre className="attachment-modal-text">{resource.text}</pre>)}
          {(kind === 'word' || kind === 'spreadsheet' || kind === 'presentation') && resource.blob && <OfficePreview kind={kind} blob={resource.blob} />}
          {kind === 'file' && <div className="attachment-modal-empty"><Icon name="file" size={28} /><p>{t('message.noPreview')}</p><Button variant="secondary" size="sm" onPress={() => void download()}><Icon name="download" size={15} />{t('message.downloadFile')}</Button></div>}
        </>}
      </Modal.Body>
    </Modal.Dialog></Modal.Container></Modal.Backdrop>
  </Modal>;
}
