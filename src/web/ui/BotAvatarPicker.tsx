import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { RefreshCw } from 'lucide-react';
import { avatarBatch, BOT_COLORS, type AvatarChoice } from '../lib/bot-theme';
import { useI18n } from '../i18n';
import BotAvatar from './BotAvatar';

interface Props {
  name: string;
  avatar?: string;
  color: string;
  disabled?: boolean;
  autoSelect?: boolean;
  onAvatar: (value: string) => void;
  onColor: (id: string) => void;
}

export default function BotAvatarPicker({ name, avatar, color, disabled, autoSelect = false, onAvatar, onColor }: Props) {
  const { t } = useI18n();
  const [batch, setBatch] = useState<AvatarChoice[]>(avatarBatch);

  useEffect(() => {
    if (autoSelect && !avatar && batch[0]) onAvatar(batch[0].value);
    // Only a brand-new bot needs an initial selection; editing stays fully user-controlled.
  }, [autoSelect, avatar, batch, onAvatar]);

  const refresh = () => {
    const next = avatarBatch();
    setBatch(next);
    if (autoSelect && next[0]) onAvatar(next[0].value);
  };

  return (
    <div className="avatar-picker">
      <div className="avatar-picker-head">
        <BotAvatar name={name || 'Bot'} avatar={avatar} color={color} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t('avatar.title')}</p>
          <p className="mt-0.5 text-xs text-muted">{t('avatar.hint')}</p>
        </div>
        <Button type="button" size="sm" variant="ghost" className="rounded-full" isDisabled={disabled} onPress={refresh}>
          <RefreshCw size={15} aria-hidden="true" />{t('avatar.refresh')}
        </Button>
      </div>
      <div className="avatar-grid" role="listbox" aria-label={t('avatar.title')}>
        {batch.map(choice => (
          <button
            key={choice.key}
            type="button"
            role="option"
            aria-selected={avatar === choice.value}
            aria-label={t('avatar.option')}
            className="avatar-option"
            data-selected={avatar === choice.value ? 'true' : undefined}
            disabled={disabled}
            onClick={() => onAvatar(choice.value)}
          >
            <img src={choice.src} alt="" loading="lazy" draggable={false} />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted">{t('avatar.color')}</span>
        <div className="color-swatches" role="radiogroup" aria-label={t('avatar.color')}>
          {BOT_COLORS.map(option => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={color === option.id}
              aria-label={option.label}
              className="color-swatch"
              data-selected={color === option.id ? 'true' : undefined}
              style={{ background: option.background }}
              disabled={disabled}
              onClick={() => onColor(option.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
