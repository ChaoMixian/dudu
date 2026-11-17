import { Avatar, Style } from '@dicebear/core';
import gazeDefinition from '@dicebear/styles/gaze.json';
import { randomId } from './random';

export interface BotColor { id: string; background: string; foreground: string; label: string }

/** Muted, high-contrast accents shared by avatars and the user's own message bubbles. */
export const BOT_COLORS: BotColor[] = [
  { id: 'teal', background: '#3f9e8e', foreground: '#06201c', label: '青' },
  { id: 'amber', background: '#c98a3c', foreground: '#241604', label: '琥珀' },
  { id: 'rose', background: '#c2687c', foreground: '#2a0d14', label: '玫红' },
  { id: 'blue', background: '#5a7fc4', foreground: '#081326', label: '蓝' },
  { id: 'violet', background: '#8a76c8', foreground: '#150f29', label: '紫' },
  { id: 'green', background: '#5f9e63', foreground: '#081e0b', label: '绿' },
  { id: 'orange', background: '#c47a4a', foreground: '#260f04', label: '橙' },
  { id: 'cyan', background: '#4f9dae', foreground: '#031d22', label: '青蓝' },
];

const byId = new Map(BOT_COLORS.map(color => [color.id, color]));

function hash(value: string): number {
  let result = 0;
  for (const character of value) result = (result * 31 + character.codePointAt(0)!) % 360;
  return result;
}

export function botColor(id: string | undefined, seed: string): BotColor {
  return (id && byId.get(id)) || BOT_COLORS[hash(seed) % BOT_COLORS.length];
}

export function randomBotColor(): BotColor {
  return BOT_COLORS[Math.floor(Math.random() * BOT_COLORS.length)];
}

/** The product uses one bundled DiceBear style: Gaze, animated with the medium-speed preset. */
export const AVATAR_STYLE = 'gaze';
const ANIMATION_PRESET = 'medium';
const gaze = new Style(gazeDefinition);

export function dicebearAvatar(seed: string): string {
  return `dicebear:${AVATAR_STYLE}:${encodeURIComponent(seed)}`;
}

function parse(avatar: string): { style: string; seed: string } | undefined {
  const match = /^dicebear:([a-z0-9-]+):(.+)$/.exec(avatar);
  if (!match) return undefined;
  try { return { style: match[1]!, seed: decodeURIComponent(match[2]!) }; } catch { return undefined; }
}

const cache = new Map<string, string>();

export function dicebearDataUri(seed: string, size = 128): string {
  const key = `${seed}:${size}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const svg = new Avatar(gaze, { seed, size, animationVariant: ANIMATION_PRESET }).toString();
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(key, uri);
  return uri;
}

/** Resolve a stored avatar descriptor, legacy remote URL, or data URL to something an <img> can render. */
export function avatarSrc(avatar?: string): string | undefined {
  if (!avatar) return undefined;
  const parsed = parse(avatar);
  if (!parsed) return avatar;
  return parsed.style === AVATAR_STYLE ? dicebearDataUri(parsed.seed) : undefined;
}

export interface AvatarChoice { key: string; value: string; src: string }

function randomSeed(): string {
  return randomId().slice(0, 8);
}

export function avatarBatch(count = 8): AvatarChoice[] {
  return Array.from({ length: count }, () => {
    const seed = randomSeed();
    const value = dicebearAvatar(seed);
    return { key: seed, value, src: avatarSrc(value)! };
  });
}
