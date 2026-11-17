import { useLayoutEffect, useState } from 'react';
import { Alert, Button, Form, Input, Label, TextField } from '@heroui/react';
import { Save } from 'lucide-react';
import { errorText, request } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../state/LiveContext';
import { useI18n } from '../i18n';
import { initialStyle, initialPreset, profileFingerprint } from '../lib/profile-avatar';
import ProfileAvatarPicker from '../ui/ProfileAvatarPicker';

interface Props {
  onDirtyChange?: (dirty: boolean) => void;
  onPendingChange?: (pending: boolean) => void;
}

export default function ProfilePage({ onDirtyChange, onPendingChange }: Props) {
  const { token } = useAuth();
  const { state, refresh, busy, notify } = useLive();
  const { t } = useI18n();
  const saved = state.profile ?? {};
  const [name, setName] = useState(saved.name ?? '');
  const [avatar, setAvatar] = useState<string | undefined>(saved.avatar);
  const initialStyleId = initialStyle(saved);
  const [styleId, setStyleId] = useState(initialStyleId);
  const [presetId, setPresetId] = useState(() => initialPreset(initialStyleId, saved));
  const [baseline, setBaseline] = useState(() => profileFingerprint(saved.name ?? '', saved.avatar, initialStyleId, initialPreset(initialStyleId, saved)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = profileFingerprint(name, avatar, styleId, presetId) !== baseline;

  useLayoutEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useLayoutEffect(() => { onPendingChange?.(saving); }, [saving, onPendingChange]);

  const submit = async () => {
    if (saving || busy) return;
    setSaving(true);
    setError('');
    const next = { name: name.trim(), avatar, avatarStyle: styleId, avatarPreset: presetId };
    try {
      await request(token, '/profile', 'PUT', next);
      setBaseline(profileFingerprint(next.name, next.avatar, next.avatarStyle, next.avatarPreset));
      onDirtyChange?.(false);
      await refresh();
      notify('success', t('profile.saved'));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">{t('profile.title')}</h2>
        <p className="mt-1.5 text-sm text-muted">{t('profile.desc')}</p>
      </header>

      <Form className="flex min-w-0 flex-col gap-5" validationBehavior="aria" aria-busy={saving} onSubmit={event => { event.preventDefault(); void submit(); }}>
        {error && <Alert status="danger" role="alert"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert>}

        <ProfileAvatarPicker name={name} avatar={avatar} styleId={styleId} presetId={presetId} disabled={saving} onAvatar={setAvatar} onStyle={setStyleId} onPreset={setPresetId} />

        <TextField value={name} isDisabled={saving} onChange={setName}>
          <Label>{t('profile.name')}</Label>
          <Input placeholder={t('profile.namePlaceholder')} maxLength={80} />
        </TextField>

        <div className="flex justify-end">
          <Button type="submit" className="rounded-full" variant="secondary" isDisabled={saving || !dirty} isPending={saving}>
            <Save size={16} aria-hidden="true" />{t('profile.save')}
          </Button>
        </div>
      </Form>
    </div>
  );
}
