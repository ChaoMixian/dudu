import { AlertDialog, Button } from '@heroui/react';
import { useI18n } from '../i18n';

export default function DiscardChangesDialog({ isOpen, onCancel, onDiscard }: {
  isOpen: boolean; onCancel: () => void; onDiscard: () => void;
}) {
  const { t } = useI18n();
  return (
    <AlertDialog isOpen={isOpen} onOpenChange={open => { if (!open) onCancel(); }}>
      <AlertDialog.Backdrop><AlertDialog.Container><AlertDialog.Dialog>
        <AlertDialog.Header><AlertDialog.Heading>{t('common.unsavedTitle')}</AlertDialog.Heading></AlertDialog.Header>
        <AlertDialog.Body>{t('common.unsavedBody')}</AlertDialog.Body>
        <AlertDialog.Footer>
          <Button variant="tertiary" autoFocus onPress={onCancel}>{t('common.keepEditing')}</Button>
          <Button variant="danger" onPress={onDiscard}>{t('common.discard')}</Button>
        </AlertDialog.Footer>
      </AlertDialog.Dialog></AlertDialog.Container></AlertDialog.Backdrop>
    </AlertDialog>
  );
}
