import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Input, Label, ListBox, Select, Spinner, TextField } from '@heroui/react';
import { RefreshCw, Save, Upload, X } from 'lucide-react';
import { errorText, request } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../state/LiveContext';
import { useI18n, type TKey } from '../i18n';
import { avatarBatch, presetsFor, PROFILE_AVATAR_STYLES, type AvatarChoice } from '../lib/avatar-styles';

interface Props {
  onDirtyChange?: (dirty: boolean) => void;
  onPendingChange?: (pending: boolean) => void;
}

const fingerprint = (name: string, avatar?: string) => JSON.stringify({ name: name.trim(), avatar: avatar ?? '' });
const initial = (name: string) => Array.from(name.trim())[0]?.toUpperCase() ?? '?';
const initialStyle = (saved: { avatarStyle?: string }) =>
  saved.avatarStyle && PROFILE_AVATAR_STYLES.some(style => style.id === saved.avatarStyle) ? saved.avatarStyle : 'gaze';
const initialPreset = (styleId: string, saved: { avatarPreset?: string }) =>
  saved.avatarPreset && presetsFor(styleId).some(preset => preset.id === saved.avatarPreset) ? saved.avatarPreset : 'classic';

async function readImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 12 * 1024 * 1024) {
    throw new Error('Unsupported image');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/webp', 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ProfilePage({ onDirtyChange, onPendingChange }: Props) {
  const { token } = useAuth();
  const { state, refresh, busy, notify } = useLive();
  const { t } = useI18n();
  const saved = state.profile ?? {};
  const [name, setName] = useState(saved.name ?? '');
  const [avatar, setAvatar] = useState<string | undefined>(saved.avatar);
  const [baseline, setBaseline] = useState(() => fingerprint(saved.name ?? '', saved.avatar));
  const initialStyleId = initialStyle(saved);
  const [styleId, setStyleId] = useState(initialStyleId);
  const [presetId, setPresetId] = useState(() => initialPreset(initialStyleId, saved));
  const [batch, setBatch] = useState<AvatarChoice[]>([]);
  const [batchLoading, setBatchLoading] = useState(true);
  const [batchError, setBatchError] = useState('');
  const [shuffle, setShuffle] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const presets = presetsFor(styleId);
  const dirty = fingerprint(name, avatar) !== baseline;
  const previewName = name.trim() || t('profile.defaultName');

  useLayoutEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useLayoutEffect(() => { onPendingChange?.(saving); }, [saving, onPendingChange]);

  useEffect(() => {
    let cancelled = false;
    setBatchLoading(true);
    setBatchError('');
    void avatarBatch(styleId, presetId, 8)
      .then(next => { if (!cancelled) setBatch(next); })
      .catch(cause => { if (!cancelled) setBatchError(errorText(cause)); })
      .finally(() => { if (!cancelled) setBatchLoading(false); });
    return () => { cancelled = true; };
  }, [styleId, presetId, shuffle]);

  const changeStyle = (next: string) => {
    setStyleId(next);
    setPresetId(presetsFor(next)[0]!.id);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      setAvatar(await readImage(file));
      setError('');
    } catch {
      setError(t('profile.uploadError'));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submit = async () => {
    if (saving || busy) return;
    setSaving(true);
    setError('');
    const next = { name: name.trim(), avatar, avatarStyle: styleId, avatarPreset: presetId };
    try {
      await request(token, '/profile', 'PUT', next);
      setBaseline(fingerprint(next.name, next.avatar));
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

        <section className="rounded-2xl border border-separator bg-surface p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4 sm:flex-1">
              <span className="profile-avatar profile-avatar-lg" aria-hidden="true">
                {avatar ? <img className="profile-avatar-image" src={avatar} alt="" /> : initial(previewName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t('profile.avatar')}</p>
                <p className="mt-0.5 text-xs text-muted">{t('profile.avatarHint')}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={event => void upload(event.target.files?.[0])} />
              <Button type="button" size="sm" variant="secondary" className="rounded-full" isDisabled={saving} onPress={() => fileRef.current?.click()}>
                <Upload size={15} aria-hidden="true" />{t('profile.upload')}
              </Button>
              {avatar && (
                <Button type="button" size="sm" variant="ghost" className="rounded-full" isDisabled={saving} onPress={() => setAvatar(undefined)}>
                  <X size={15} aria-hidden="true" />{t('profile.remove')}
                </Button>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Select selectedKey={styleId} isDisabled={saving} onSelectionChange={key => { if (key !== null) changeStyle(String(key)); }}>
              <Label>{t('profile.style')}</Label>
              <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
              <Select.Popover><ListBox>{PROFILE_AVATAR_STYLES.map(style => <ListBox.Item key={style.id} id={style.id} textValue={style.label}>{style.label}</ListBox.Item>)}</ListBox></Select.Popover>
            </Select>
            <Select selectedKey={presetId} isDisabled={saving} onSelectionChange={key => { if (key !== null) setPresetId(String(key)); }}>
              <Label>{t('profile.preset')}</Label>
              <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
              <Select.Popover><ListBox>{presets.map(preset => <ListBox.Item key={preset.id} id={preset.id} textValue={t(preset.labelKey as TKey)}>{t(preset.labelKey as TKey)}</ListBox.Item>)}</ListBox></Select.Popover>
            </Select>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted">{t('avatar.hint')}</span>
            <Button type="button" size="sm" variant="ghost" className="rounded-full" isDisabled={batchLoading || saving} onPress={() => setShuffle(value => value + 1)}>
              <RefreshCw size={15} aria-hidden="true" />{t('avatar.refresh')}
            </Button>
          </div>

          {batchError && <Alert className="mt-3" status="warning"><Alert.Content><Alert.Description>{batchError}</Alert.Description></Alert.Content></Alert>}
          {batchLoading
            ? <div className="flex h-24 items-center justify-center"><Spinner size="sm" /></div>
            : (
              <div className="avatar-grid mt-3" role="listbox" aria-label={t('profile.avatar')}>
                {batch.map(choice => (
                  <button
                    key={choice.key}
                    type="button"
                    role="option"
                    aria-selected={avatar === choice.src}
                    aria-label={t('avatar.option')}
                    className="avatar-option"
                    data-selected={avatar === choice.src ? 'true' : undefined}
                    disabled={saving}
                    onClick={() => setAvatar(choice.src)}
                  >
                    <img src={choice.src} alt="" loading="lazy" draggable={false} />
                  </button>
                ))}
              </div>
            )}
        </section>

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
