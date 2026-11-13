import { useState } from 'react';
import SourcesPage from './SourcesPage';
import useUnsavedChanges from '../ui/useUnsavedChanges';

export default function AutomationsPage() {
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const leaveDialog = useUnsavedChanges(dirty, pending);
  return (
    <div className="page-scroll">
      <div className="page-container"><SourcesPage onDirtyChange={setDirty} onPendingChange={setPending} /></div>
      {leaveDialog}
    </div>
  );
}
