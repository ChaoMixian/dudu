import { useEffect, useId, useRef, useState } from 'react';
import { Alert, Button, Form, Input, Label, Modal, Spinner, TextArea, TextField } from '@heroui/react';
import { Plus, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { BotConfig } from '../../contracts';
import { errorText, request } from '../lib/api';
import { randomBotColor } from '../lib/bot-theme';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../state/LiveContext';
import { useI18n } from '../i18n';
import IconButton from './IconButton';
import BotAvatarPicker from './BotAvatarPicker';

export const CREATE_BOT_EVENT = 'dudu:create-bot';
export const openCreateBot = () => window.dispatchEvent(new Event(CREATE_BOT_EVENT));

export default function CreateBotDialog({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const { token } = useAuth();
  const { refresh } = useLive();
  const { t } = useI18n();
  const navigate = useNavigate();
  const formId = useId();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState<string | undefined>();
  const [color, setColor] = useState(() => randomBotColor().id);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setDescription('');
    setAvatar(undefined);
    setColor(randomBotColor().id);
    setGeneration(value => value + 1);
    setError('');
    setSaving(false);
    requestAnimationFrame(() => nameRef.current?.focus());
  }, [isOpen]);

  const create = async () => {
    if (saving) return;
    if (!name.trim()) { setError(t('createBot.nameRequired')); return; }
    setSaving(true);
    setError('');
    try {
      const bot = await request<BotConfig>(token, '/bots', 'POST', { name: name.trim(), description: description.trim(), avatar, color });
      await refresh();
      onOpenChange(false);
      navigate(`/bots/${bot.id}`);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={open => { if (!saving) onOpenChange(open); }}>
      <Modal.Backdrop isDismissable={!saving} isKeyboardDismissDisabled={saving}>
        <Modal.Container size="lg" scroll="inside" placement="center">
          <Modal.Dialog>
            <Modal.Header>
              <div className="flex w-full items-start justify-between gap-4">
                <div>
                  <Modal.Heading>{t('createBot.title')}</Modal.Heading>
                  <p className="mt-1 text-sm text-muted">{t('createBot.hint')}</p>
                </div>
                <IconButton label={t('common.close')} isDisabled={saving} onPress={() => onOpenChange(false)}><X size={18} /></IconButton>
              </div>
            </Modal.Header>
            <Modal.Body>
              <Form id={formId} className="flex min-w-0 flex-col gap-5" validationBehavior="aria" onSubmit={event => { event.preventDefault(); void create(); }}>
                {error && <Alert status="danger" role="alert"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert>}
                <BotAvatarPicker key={generation} name={name} avatar={avatar} color={color} disabled={saving} autoSelect onAvatar={setAvatar} onColor={setColor} />
                <TextField isRequired isDisabled={saving} value={name} onChange={setName}>
                  <Label>{t('bot.name')}</Label><Input ref={nameRef} placeholder={t('createBot.namePlaceholder')} maxLength={80} />
                </TextField>
                <TextField isDisabled={saving} value={description} onChange={setDescription}>
                  <Label>{t('createBot.description')}</Label><TextArea rows={3} placeholder={t('createBot.descriptionPlaceholder')} maxLength={4000} />
                </TextField>
              </Form>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={saving} onPress={() => onOpenChange(false)}>{t('common.cancel')}</Button>
              <Button className="rounded-full" type="submit" form={formId} variant="secondary" isDisabled={saving || !name.trim()} isPending={saving}>
                {saving ? <Spinner size="sm" /> : <Plus size={16} aria-hidden="true" />}{t('createBot.submit')}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
