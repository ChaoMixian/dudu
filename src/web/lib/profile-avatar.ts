import { presetsFor, PROFILE_AVATAR_STYLES } from './avatar-styles';

export function initialStyle(saved: { avatarStyle?: string }): string {
  return saved.avatarStyle && PROFILE_AVATAR_STYLES.some(style => style.id === saved.avatarStyle) ? saved.avatarStyle : 'gaze';
}

export function initialPreset(styleId: string, saved: { avatarPreset?: string }): string {
  return saved.avatarPreset && presetsFor(styleId).some(preset => preset.id === saved.avatarPreset) ? saved.avatarPreset : 'classic';
}

export function profileFingerprint(name: string, avatar: string | undefined, styleId: string, presetId: string): string {
  return JSON.stringify({ name: name.trim(), avatar: avatar ?? '', avatarStyle: styleId, avatarPreset: presetId });
}

export async function readProfileAvatarImage(file: File): Promise<string> {
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
