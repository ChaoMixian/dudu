import { useMemo, type CSSProperties } from 'react';
import { avatarSrc, botColor } from '../lib/bot-theme';

function glyph(name: string): string {
  const trimmed = name.trim();
  return Array.from(trimmed)[0]?.toUpperCase() ?? '?';
}

export default function BotAvatar({ name, avatar, color, size = 'sm' }: { name: string; avatar?: string; color?: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const palette = botColor(color, name);
  const src = useMemo(() => avatarSrc(avatar), [avatar]);
  return (
    <span
      className={`bot-avatar bot-avatar-${size}`}
      style={{ '--bot-bg': palette.background, '--bot-fg': palette.foreground } as CSSProperties}
      aria-hidden="true"
    >
      <span className="bot-avatar-glyph">{glyph(name)}</span>
      {src && <img className="bot-avatar-image" src={src} alt="" loading="lazy" draggable={false} onError={event => { event.currentTarget.style.display = 'none'; }} />}
    </span>
  );
}
