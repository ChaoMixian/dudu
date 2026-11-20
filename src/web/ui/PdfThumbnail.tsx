import { useEffect, useRef, useState } from 'react';
import { Spinner } from '@heroui/react';

type PdfjsModule = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function loadPdfjs() {
  pdfjsPromise ??= (async () => {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })();
  return pdfjsPromise;
}

export default function PdfThumbnail({ blob }: { blob: Blob }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loading: ReturnType<PdfjsModule['getDocument']> | undefined;
    void loadPdfjs().then(async pdfjs => {
      loading = pdfjs.getDocument({ data: await blob.arrayBuffer() });
      const loaded = await loading.promise;
      if (cancelled || !canvasRef.current) return;
      const page = await loaded.getPage(1);
      if (cancelled || !canvasRef.current) return;
      const base = page.getViewport({ scale: 1 });
      const width = Math.max(240, canvasRef.current.clientWidth || 320);
      const scale = width / base.width;
      const viewport = page.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      await page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale: scale * ratio }) }).promise;
      if (!cancelled) setReady(true);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; void loading?.destroy(); };
  }, [blob]);

  if (failed) return <span className="pdf-thumb-fallback">PDF</span>;
  return <div className="pdf-thumb"><canvas ref={canvasRef} />{!ready && <span className="pdf-thumb-loading"><Spinner size="sm" /></span>}</div>;
}
