import { Avatar, Style } from '@dicebear/core';
import gazeDefinition from '@dicebear/styles/gaze.json';
import { randomId } from './random';

export interface ProfileAvatarStyle {
  id: string;
  label: string;
}

export interface ProfileAvatarPreset {
  id: string;
  labelKey: string;
  options: Record<string, unknown>;
}

export interface AvatarChoice {
  key: string;
  src: string;
}

/** A small, curated set of DiceBear styles. Each style is loaded only when selected. */
export const PROFILE_AVATAR_STYLES: ProfileAvatarStyle[] = [
  { id: 'gaze', label: 'Gaze' },
  { id: 'notionists', label: 'Notionists' },
  { id: 'adventurer', label: 'Adventurer' },
  { id: 'avataaars', label: 'Avataaars' },
  { id: 'personas', label: 'Personas' },
  { id: 'lorelei', label: 'Lorelei' },
  { id: 'micah', label: 'Micah' },
  { id: 'bottts', label: 'Bottts' },
  { id: 'fun-emoji', label: 'Fun Emoji' },
  { id: 'thumbs', label: 'Thumbs' },
  { id: 'pixel-art', label: 'Pixel Art' },
  { id: 'miniavs', label: 'Miniavs' },
];

const STYLE_LOADERS: Record<string, () => Promise<unknown>> = {
  gaze: () => Promise.resolve(gazeDefinition),
  notionists: () => import('@dicebear/styles/notionists.json').then(module => module.default),
  adventurer: () => import('@dicebear/styles/adventurer.json').then(module => module.default),
  avataaars: () => import('@dicebear/styles/avataaars.json').then(module => module.default),
  personas: () => import('@dicebear/styles/personas.json').then(module => module.default),
  lorelei: () => import('@dicebear/styles/lorelei.json').then(module => module.default),
  micah: () => import('@dicebear/styles/micah.json').then(module => module.default),
  bottts: () => import('@dicebear/styles/bottts.json').then(module => module.default),
  'fun-emoji': () => import('@dicebear/styles/fun-emoji.json').then(module => module.default),
  thumbs: () => import('@dicebear/styles/thumbs.json').then(module => module.default),
  'pixel-art': () => import('@dicebear/styles/pixel-art.json').then(module => module.default),
  miniavs: () => import('@dicebear/styles/miniavs.json').then(module => module.default),
};

const CLASSIC: ProfileAvatarPreset = { id: 'classic', labelKey: 'avatarPreset.classic', options: {} };

const PRESETS: Record<string, ProfileAvatarPreset[]> = {
  gaze: [
    CLASSIC,
    { id: 'animated', labelKey: 'avatarPreset.animated', options: { animationVariant: 'medium' } },
    { id: 'still', labelKey: 'avatarPreset.still', options: { animationVariant: 'none' } },
    { id: 'round', labelKey: 'avatarPreset.round', options: { shapeVariant: 'circle' } },
    { id: 'square', labelKey: 'avatarPreset.square', options: { shapeVariant: 'square' } },
    { id: 'happy', labelKey: 'avatarPreset.happy', options: { eyesVariant: 'happy' } },
  ],
  notionists: [
    CLASSIC,
    { id: 'minimal', labelKey: 'avatarPreset.minimal', options: { glassesProbability: 0, beardProbability: 0 } },
  ],
  adventurer: [
    CLASSIC,
    { id: 'minimal', labelKey: 'avatarPreset.minimal', options: { glassesProbability: 0, earringsProbability: 0 } },
  ],
  avataaars: [
    CLASSIC,
    { id: 'minimal', labelKey: 'avatarPreset.minimal', options: { accessoriesProbability: 0, facialHairProbability: 0 } },
    { id: 'happy', labelKey: 'avatarPreset.happy', options: { eyesVariant: 'happy' } },
  ],
  personas: [
    CLASSIC,
    { id: 'minimal', labelKey: 'avatarPreset.minimal', options: { facialHairProbability: 0 } },
    { id: 'happy', labelKey: 'avatarPreset.happy', options: { eyesVariant: 'happy' } },
  ],
  lorelei: [
    CLASSIC,
    { id: 'minimal', labelKey: 'avatarPreset.minimal', options: { glassesProbability: 0, frecklesProbability: 0, earringsProbability: 0 } },
  ],
  micah: [
    CLASSIC,
    { id: 'minimal', labelKey: 'avatarPreset.minimal', options: { glassesProbability: 0, earringsProbability: 0, facialHairProbability: 0 } },
    { id: 'smiling', labelKey: 'avatarPreset.smiling', options: { eyesVariant: 'smiling' } },
  ],
  bottts: [
    CLASSIC,
    { id: 'minimal', labelKey: 'avatarPreset.minimal', options: { topProbability: 0 } },
    { id: 'happy', labelKey: 'avatarPreset.happy', options: { eyesVariant: 'happy' } },
  ],
  'fun-emoji': [
    CLASSIC,
    { id: 'love', labelKey: 'avatarPreset.love', options: { eyesVariant: 'love', mouthVariant: 'kissHeart' } },
  ],
  thumbs: [
    CLASSIC,
    { id: 'animated', labelKey: 'avatarPreset.animated', options: { animationVariant: 'medium' } },
    { id: 'still', labelKey: 'avatarPreset.still', options: { animationVariant: 'none' } },
  ],
  'pixel-art': [
    CLASSIC,
    { id: 'minimal', labelKey: 'avatarPreset.minimal', options: { glassesProbability: 0, hatProbability: 0, accessoriesProbability: 0, beardProbability: 0 } },
    { id: 'happy', labelKey: 'avatarPreset.happy', options: { mouthVariant: 'happy01' } },
  ],
  miniavs: [
    CLASSIC,
    { id: 'minimal', labelKey: 'avatarPreset.minimal', options: { glassesProbability: 0, mustacheProbability: 0, blushProbability: 0 } },
    { id: 'happy', labelKey: 'avatarPreset.happy', options: { eyesVariant: 'happy' } },
  ],
};

export function presetsFor(styleId: string): ProfileAvatarPreset[] {
  return PRESETS[styleId] ?? [CLASSIC];
}

const styleCache = new Map<string, Promise<Style>>();
const renderCache = new Map<string, string>();

function loadStyle(styleId: string): Promise<Style> {
  const cached = styleCache.get(styleId);
  if (cached) return cached;
  const loader = STYLE_LOADERS[styleId];
  if (!loader) return Promise.reject(new Error(`Unknown avatar style: ${styleId}`));
  const promise = loader().then(definition => new Style(definition));
  styleCache.set(styleId, promise);
  return promise;
}

function randomSeed(): string {
  return randomId().slice(0, 8);
}

export async function renderAvatar(styleId: string, presetId: string, seed: string, size = 160): Promise<string> {
  const key = `${styleId}|${presetId}|${seed}|${size}`;
  const cached = renderCache.get(key);
  if (cached) return cached;
  const style = await loadStyle(styleId);
  const preset = presetsFor(styleId).find(item => item.id === presetId) ?? presetsFor(styleId)[0]!;
  const src = new Avatar(style, { seed, size, ...preset.options } as any).toDataUri();
  if (renderCache.size > 240) {
    const oldest = renderCache.keys().next().value;
    if (oldest) renderCache.delete(oldest);
  }
  renderCache.set(key, src);
  return src;
}

export async function avatarBatch(styleId: string, presetId: string, count = 8): Promise<AvatarChoice[]> {
  const seeds = Array.from({ length: count }, randomSeed);
  const sources = await Promise.all(seeds.map(seed => renderAvatar(styleId, presetId, seed, 160)));
  return seeds.map((seed, index) => ({ key: seed, src: sources[index]! }));
}
