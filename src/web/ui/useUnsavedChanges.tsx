import { useCallback, useEffect } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router-dom';
import DiscardChangesDialog from './DiscardChangesDialog';

export default function useUnsavedChanges(dirty: boolean, pending = false) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (dirty || pending)
    && `${currentLocation.pathname}${currentLocation.search}` !== `${nextLocation.pathname}${nextLocation.search}`);
  useEffect(() => {
    if (blocker.state === 'blocked' && pending) blocker.reset();
  }, [blocker, pending]);
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (dirty || pending) { event.preventDefault(); event.returnValue = ''; }
  }, [dirty, pending]));
  return <DiscardChangesDialog isOpen={blocker.state === 'blocked' && !pending}
    onCancel={() => { if (blocker.state === 'blocked') blocker.reset(); }}
    onDiscard={() => { if (blocker.state === 'blocked') blocker.proceed(); }} />;
}
