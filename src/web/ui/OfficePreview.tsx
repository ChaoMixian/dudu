import { useEffect, useRef, useState } from 'react';
import { Alert, Spinner } from '@heroui/react';
import { errorText } from '../lib/api';
import type { OfficeKind } from '../lib/preview';
import { useI18n } from '../i18n';

type Sheet = { name: string; rows: unknown[][] };

export default function OfficePreview({ kind, blob }: { kind: OfficeKind; blob: Blob }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [activeSheet, setActiveSheet] = useState('');
  const [wordHtml, setWordHtml] = useState('');
  const presentationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading'); setError('');
    const fail = (cause: unknown) => { if (!cancelled) { setError(errorText(cause)); setStatus('error'); } };
    if (kind === 'word') {
      void import('mammoth').then(async ({ default: mammoth }) => {
        const result = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
        if (cancelled) return;
        setWordHtml(result.value); setStatus('ready');
      }).catch(fail);
    } else if (kind === 'spreadsheet') {
      void import('xlsx').then(async XLSX => {
        const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
        const parsed = workbook.SheetNames.map(name => ({
          name,
          rows: XLSX.utils.sheet_to_json(workbook.Sheets[name]!, { header: 1, raw: false, defval: '', blankrows: false }) as unknown[][],
        }));
        if (cancelled) return;
        setSheets(parsed); setActiveSheet(parsed[0]?.name ?? ''); setStatus('ready');
      }).catch(fail);
    } else {
      let viewer: { destroy: () => void } | undefined;
      let disposed = false;
      const dispose = () => { if (!viewer || disposed) return; disposed = true; viewer.destroy(); };
      void import('@aiden0z/pptx-renderer').then(async ({ PptxViewer, RECOMMENDED_ZIP_LIMITS }) => {
        if (!presentationRef.current || cancelled) return;
        presentationRef.current.innerHTML = '';
        viewer = await PptxViewer.open(await blob.arrayBuffer(), presentationRef.current, {
          zipLimits: RECOMMENDED_ZIP_LIMITS,
          lazySlides: true,
          lazyMedia: true,
          listOptions: { windowed: true, initialSlides: 4, batchSize: 4 },
        });
        if (!cancelled) setStatus('ready'); else dispose();
      }).catch(fail);
      return () => { cancelled = true; dispose(); };
    }
    return () => { cancelled = true; };
  }, [kind, blob]);

  if (kind === 'presentation') return <div className="office-preview office-preview-slides">
    <div ref={presentationRef} className="office-pptx" />
    {status === 'loading' && <div className="office-pptx-loading"><Spinner size="sm" />{t('message.attachmentLoading')}</div>}
    {status === 'error' && <div className="office-preview-error"><Alert status="danger"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert></div>}
  </div>;

  if (status === 'loading') return <div className="office-preview-loading"><Spinner size="sm" />{t('message.attachmentLoading')}</div>;
  if (status === 'error') return <div className="office-preview-error"><Alert status="danger"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert></div>;

  if (kind === 'word') return <div className="office-preview office-preview-word"><article className="office-word" dangerouslySetInnerHTML={{ __html: wordHtml }} /></div>;

  if (kind === 'spreadsheet') {
    const sheet = sheets.find(item => item.name === activeSheet) ?? sheets[0];
    const rows = sheet?.rows ?? [];
    const columns = Math.min(40, Math.max(0, ...rows.slice(0, 200).map(row => row.length)));
    const clipped = rows.length > 200 || rows.some(row => row.length > 40);
    return <div className="office-preview office-preview-sheet">
      {sheets.length > 1 && <div className="office-sheet-tabs" role="tablist">{sheets.map(item => <button key={item.name} type="button" role="tab" aria-selected={item.name === sheet?.name} className="office-sheet-tab" data-active={item.name === sheet?.name ? 'true' : undefined} onClick={() => setActiveSheet(item.name)}>{item.name}</button>)}</div>}
      <div className="office-sheet-scroll">
        {!rows.length ? <p className="office-empty">{t('message.emptySheet')}</p> : <table className="office-sheet-table">
          <tbody>{rows.slice(0, 200).map((row, rowIndex) => <tr key={rowIndex}>{Array.from({ length: columns }).map((_, columnIndex) => rowIndex === 0
            ? <th key={columnIndex}>{String(row[columnIndex] ?? '')}</th>
            : <td key={columnIndex}>{String(row[columnIndex] ?? '')}</td>)}</tr>)}</tbody>
        </table>}
      </div>
      {clipped && <p className="office-note">{t('message.sheetClipped')}</p>}
    </div>;
  }

}
