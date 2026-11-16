import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { Spinner } from '@heroui/react';
import '../lib/monaco';

const OPTIONS = {
  readOnly: true,
  domReadOnly: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 11.5,
  lineHeight: 17,
  lineNumbersMinChars: 3,
  lineDecorationsWidth: 8,
  glyphMargin: false,
  folding: true,
  wordWrap: 'on' as const,
  wrappingIndent: 'same' as const,
  automaticLayout: true,
  renderLineHighlight: 'none' as const,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9 },
  padding: { top: 8, bottom: 8 },
  occurrencesHighlight: 'off' as const,
  selectionHighlight: false,
  tabSize: 2,
  stickyScroll: { enabled: false },
};

const theme = () => document.documentElement.classList.contains('dark') ? 'vs-dark' : 'light';

export default function MonacoViewer({ value, language }: { value: string; language: string }) {
  const [current, setCurrent] = useState(theme);
  useEffect(() => {
    const observer = new MutationObserver(() => setCurrent(theme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return (
    <div className="files-monaco">
      <Editor
        height="100%"
        language={language}
        theme={current}
        value={value}
        options={OPTIONS}
        loading={<div className="file-preview-loading"><Spinner size="sm" /></div>}
      />
    </div>
  );
}
