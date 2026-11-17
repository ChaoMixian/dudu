import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, Label, ListBox, Select, Spinner } from '@heroui/react';
import { RefreshCw, Upload, X } from 'lucide-react';
import { errorText } from '../lib/api';
import { avatarBatch, presetsFor, PROFILE_AVATAR_STYLES, type AvatarChoice } from '../lib/avatar-styles';
import { readProfileAvatarImage } from '../lib/profile-avatar';
import { useI18n, type TKey } from '../i18n';

export interface ProfileAvatarPickerProps {
  name: string;
  avatar?: string;
  styleId: string;
  presetId: string;
  disabled?: boolean;
  autoSelect?: boolean;
  onAvatar: (value: string | undefined) => void;
  onStyle: (id: string) => void;
  onPreset: (id: string) => void;
}

export default function ProfileAvatarPicker({ name, avatar, styleId, presetId, disabled = false, autoSelect = false, onAvatar, onStyle, onPreset }: ProfileAvatarPickerProps) {
  const { t } = useI18n();
  const [generation, setGeneration] = useState<{ batch: AvatarChoice[]; loading: boolean; error: string }>({ batch: [], loading: true, error: '' });
  const [shuffle, setShuffle] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const uploadId = useRef(0);
  const canAutoSelect = useRef(autoSelect && !avatar);
  const current = useRef({ avatar, styleId, presetId, disabled, autoSelect, onAvatar });
  const presets = presetsFor(styleId);
  const previewName = name.trim() || t('profile.defaultName');
  const initial = Array.from(previewName)[0]?.toUpperCase() ?? '?';

  useLayoutEffect(() => {
    const previous = current.current;
    if (previous.avatar !== avatar || previous.styleId !== styleId || previous.presetId !== presetId) {
      canAutoSelect.current = false;
      uploadId.current += 1;
    }
    if (disabled && !previous.disabled) uploadId.current += 1;
    current.current = { avatar, styleId, presetId, disabled, autoSelect, onAvatar };
  }, [avatar, styleId, presetId, disabled, autoSelect, onAvatar]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; uploadId.current += 1; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setGeneration({ batch: [], loading: true, error: '' });
    void avatarBatch(styleId, presetId, 8).then(batch => {
      if (cancelled) return;
      setGeneration({ batch, loading: false, error: '' });
      const latest = current.current;
      if (canAutoSelect.current && latest.autoSelect && !latest.avatar && !latest.disabled && batch[0]) {
        canAutoSelect.current = false;
        latest.onAvatar(batch[0].src);
      }
    }).catch(cause => {
      if (!cancelled) setGeneration({ batch: [], loading: false, error: errorText(cause) });
    });
    return () => { cancelled = true; };
  }, [styleId, presetId, shuffle]);

  const interact = () => { canAutoSelect.current = false; };
  const choose = (value: string | undefined) => {
    interact();
    uploadId.current += 1;
    setUploadError('');
    onAvatar(value);
  };
  const changeStyle = (next: string) => {
    interact();
    uploadId.current += 1;
    onStyle(next);
    onPreset(presetsFor(next)[0]!.id);
  };
  const changePreset = (next: string) => {
    interact();
    uploadId.current += 1;
    onPreset(next);
  };
  const upload = async (file: File | undefined) => {
    if (!file || current.current.disabled) return;
    interact();
    const operation = ++uploadId.current;
    const active = () => mounted.current && uploadId.current === operation && !current.current.disabled;
    // Reset immediately so choosing the same file also works after a cancelled read.
    if (fileRef.current) fileRef.current.value = '';
    setUploadError('');
    try {
      const value = await readProfileAvatarImage(file);
      if (active()) current.current.onAvatar(value);
    } catch {
      if (active()) setUploadError(t('profile.uploadError'));
    } finally {
      if (mounted.current && uploadId.current === operation && fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section className="rounded-2xl border border-separator bg-surface p-5" onPointerDownCapture={interact} onKeyDownCapture={interact}>
      {uploadError && <Alert className="mb-3" status="danger" role="alert"><Alert.Content><Alert.Description>{uploadError}</Alert.Description></Alert.Content></Alert>}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4 sm:flex-1">
          <span className="profile-avatar profile-avatar-lg" aria-hidden="true">
            {avatar ? <img className="profile-avatar-image" src={avatar} alt="" /> : initial}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t('profile.avatar')}</p>
            <p className="mt-0.5 text-xs text-muted">{t('profile.avatarHint')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" disabled={disabled} onChange={event => void upload(event.target.files?.[0])} />
          <Button type="button" size="sm" variant="secondary" className="rounded-full" isDisabled={disabled} onPress={() => { interact(); fileRef.current?.click(); }}>
            <Upload size={15} aria-hidden="true" />{t('profile.upload')}
          </Button>
          {avatar && (
            <Button type="button" size="sm" variant="ghost" className="rounded-full" isDisabled={disabled} onPress={() => choose(undefined)}>
              <X size={15} aria-hidden="true" />{t('profile.remove')}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Select selectedKey={styleId} isDisabled={disabled} onSelectionChange={key => { if (key !== null) changeStyle(String(key)); }}>
          <Label>{t('profile.style')}</Label>
          <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
          <Select.Popover><ListBox>{PROFILE_AVATAR_STYLES.map(style => <ListBox.Item key={style.id} id={style.id} textValue={style.label}>{style.label}</ListBox.Item>)}</ListBox></Select.Popover>
        </Select>
        <Select selectedKey={presetId} isDisabled={disabled} onSelectionChange={key => { if (key !== null) changePreset(String(key)); }}>
          <Label>{t('profile.preset')}</Label>
          <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
          <Select.Popover><ListBox>{presets.map(preset => <ListBox.Item key={preset.id} id={preset.id} textValue={t(preset.labelKey as TKey)}>{t(preset.labelKey as TKey)}</ListBox.Item>)}</ListBox></Select.Popover>
        </Select>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted">{t('avatar.hint')}</span>
        <Button type="button" size="sm" variant="ghost" className="rounded-full" isDisabled={generation.loading || disabled} onPress={() => { interact(); setShuffle(value => value + 1); }}>
          <RefreshCw size={15} aria-hidden="true" />{t('avatar.refresh')}
        </Button>
      </div>

      {generation.error && <Alert className="mt-3" status="warning"><Alert.Content><Alert.Description>{generation.error}</Alert.Description></Alert.Content></Alert>}
      {generation.loading
        ? <div className="flex h-24 items-center justify-center"><Spinner size="sm" /></div>
        : (
          <div className="avatar-grid mt-3" role="listbox" aria-label={t('profile.avatar')}>
            {generation.batch.map(choice => (
              <button
                key={choice.key}
                type="button"
                role="option"
                aria-selected={avatar === choice.src}
                aria-label={t('avatar.option')}
                className="avatar-option"
                data-selected={avatar === choice.src ? 'true' : undefined}
                disabled={disabled}
                onClick={() => choose(choice.src)}
              >
                <img src={choice.src} alt="" loading="lazy" draggable={false} />
              </button>
            ))}
          </div>
        )}
    </section>
  );
}
