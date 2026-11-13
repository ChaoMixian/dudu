import { useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, Label, Spinner, TextArea, TextField } from '@heroui/react';
import { Save } from 'lucide-react';
import type { BotConfig } from '../../../contracts';
import { errorText, request, segment } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { useLive } from '../../state/LiveContext';
import { useI18n } from '../../i18n';
import { botColor } from '../../lib/bot-theme';
import BotAvatarPicker from '../../ui/BotAvatarPicker';

type SettingsProps = {
  bot: BotConfig;
  onSaved?: (id: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
};

export function profileFingerprint(draft: Pick<BotConfig, 'name' | 'description' | 'avatar' | 'color'>): string {
  return JSON.stringify({ name: draft.name, description: draft.description, avatar: draft.avatar ?? '', color: draft.color ?? '' });
}

export default function SettingsTab(props: SettingsProps) {
  return <SettingsForm key={props.bot.id} {...props} />;
}

function SettingsForm({ bot, onSaved, onDirtyChange, onSavingChange }: SettingsProps) {
  const { token } = useAuth();
  const { busy, run } = useLive();
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => ({ name: bot.name, description: bot.description, avatar: bot.avatar, color: bot.color ?? botColor(undefined, bot.name).id }));
  const [baseline, setBaseline] = useState(() => profileFingerprint(draft));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const dirty = profileFingerprint(draft) !== baseline;

  useLayoutEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useLayoutEffect(() => { onSavingChange?.(saving); }, [saving, onSavingChange]);

  const submit = async () => {
    if (savingRef.current || busy) return;
    if (!draft.name.trim()) { setError(t('form.nameRequired')); return; }
    savingRef.current = true;
    setSaving(true);
    onSavingChange?.(true);
    setError('');
    const next = { ...bot, name: draft.name.trim(), description: draft.description, avatar: draft.avatar, color: draft.color };
    let saved = false;
    try {
      const ok = await run(t('bot.save'), async () => {
        try { await request(token, `/bots/${segment(bot.id)}`, 'PUT', next); }
        catch (cause) { setError(errorText(cause)); throw cause; }
      });
      if (ok) {
        setDraft({ name: next.name, description: next.description, avatar: next.avatar, color: next.color });
        setBaseline(profileFingerprint(next));
        onDirtyChange?.(false);
        saved = true;
      }
    } catch { /* error already surfaced */ }
    finally {
      savingRef.current = false;
      setSaving(false);
      onSavingChange?.(false);
    }
    if (saved) onSaved?.(bot.id);
  };

  return (
    <Form className="flex flex-col gap-5" validationBehavior="aria" aria-busy={saving} onSubmit={event => { event.preventDefault(); void submit(); }}>
      {error && <Alert status="danger" role="alert"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert>}
      <BotAvatarPicker
        name={draft.name}
        avatar={draft.avatar}
        color={draft.color ?? botColor(undefined, bot.name).id}
        disabled={saving}
        onAvatar={avatar => setDraft(current => ({ ...current, avatar }))}
        onColor={color => setDraft(current => ({ ...current, color }))}
      />
      <TextField isRequired isDisabled={saving} value={draft.name} onChange={name => setDraft(current => ({ ...current, name }))}>
        <Label>{t('bot.name')}</Label><Input maxLength={80} />
      </TextField>
      <TextField isDisabled={saving} value={draft.description} onChange={description => setDraft(current => ({ ...current, description }))}>
        <Label>{t('bot.description')}</Label><TextArea rows={4} maxLength={4000} placeholder={t('createBot.descriptionPlaceholder')} />
      </TextField>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary" className="rounded-full" isDisabled={!!busy || saving} isPending={saving}>
          {saving ? <Spinner size="sm" /> : <Save size={16} aria-hidden="true" />}{saving ? t('form.saving') : t('bot.save')}
        </Button>
      </div>
    </Form>
  );
}
