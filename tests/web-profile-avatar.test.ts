import { afterEach, expect, spyOn, test } from 'bun:test';
import { initialPreset, initialStyle, profileFingerprint, readProfileAvatarImage } from '../src/web/lib/profile-avatar';

test('profile avatar preferences restore supported values and fall back for old or invalid metadata', () => {
  expect(initialStyle({})).toBe('gaze');
  expect(initialStyle({ avatarStyle: 'unknown' })).toBe('gaze');
  expect(initialStyle({ avatarStyle: 'notionists' })).toBe('notionists');
  expect(initialPreset('gaze', {})).toBe('classic');
  expect(initialPreset('gaze', { avatarPreset: 'animated' })).toBe('animated');
  expect(initialPreset('notionists', { avatarPreset: 'animated' })).toBe('classic');
  expect(initialPreset('unknown', { avatarPreset: 'minimal' })).toBe('classic');
});

test('profile dirty fingerprint includes saved style and preset metadata', () => {
  const baseline = profileFingerprint('Chao', undefined, 'gaze', 'classic');
  expect(profileFingerprint('  Chao  ', '', 'gaze', 'classic')).toBe(baseline);
  expect(profileFingerprint('Chao', undefined, 'notionists', 'classic')).not.toBe(baseline);
  expect(profileFingerprint('Chao', undefined, 'gaze', 'animated')).not.toBe(baseline);
  expect(profileFingerprint('Chao', 'data:image/png;base64,AAAA', 'gaze', 'classic')).not.toBe(baseline);
  expect(profileFingerprint('Other', undefined, 'gaze', 'classic')).not.toBe(baseline);
});

const originalImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const restorers: (() => void)[] = [];

afterEach(() => {
  for (const restore of restorers.splice(0)) restore();
  if (originalImage) Object.defineProperty(globalThis, 'Image', originalImage);
  else Reflect.deleteProperty(globalThis, 'Image');
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else Reflect.deleteProperty(globalThis, 'document');
});

function imageEnvironment({ width = 1024, height = 512, decodeError = false, canvasError = false, encodeError = false } = {}) {
  const created = spyOn(URL, 'createObjectURL').mockReturnValue('blob:profile-upload');
  const revoked = spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  restorers.push(() => created.mockRestore(), () => revoked.mockRestore());
  let decodedSource = '';
  let drawnSize: number[] = [];
  let encoding: unknown[] = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => canvasError ? null : { drawImage: (_image: unknown, _x: number, _y: number, w: number, h: number) => { drawnSize = [w, h]; } },
    toDataURL: (...args: unknown[]) => {
      if (encodeError) throw new Error('Encoding failed');
      encoding = args;
      return 'data:image/webp;base64,resized';
    },
  };
  Object.defineProperty(globalThis, 'Image', {
    configurable: true,
    value: class {
      src = '';
      naturalWidth = width;
      naturalHeight = height;
      async decode() {
        decodedSource = this.src;
        if (decodeError) throw new Error('Decode failed');
      }
    },
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (tag: string) => {
    expect(tag).toBe('canvas');
    return canvas;
  } } });
  return { created, revoked, canvas, decodedSource: () => decodedSource, drawnSize: () => drawnSize, encoding: () => encoding };
}

test('profile uploads reject unsupported MIME types and files above 12 MiB before creating URLs', async () => {
  const env = imageEnvironment();
  await expect(readProfileAvatarImage(new File(['svg'], 'avatar.svg', { type: 'image/svg+xml' }))).rejects.toThrow('Unsupported image');
  await expect(readProfileAvatarImage(new File([new Uint8Array(12 * 1024 * 1024 + 1)], 'avatar.png', { type: 'image/png' }))).rejects.toThrow('Unsupported image');
  expect(env.created).not.toHaveBeenCalled();
  expect(env.revoked).not.toHaveBeenCalled();
});

test('profile upload accepts exactly 12 MiB, preserves aspect ratio and revokes its object URL', async () => {
  const env = imageEnvironment();
  const file = new File([new Uint8Array(12 * 1024 * 1024)], 'avatar.png', { type: 'image/png' });
  expect(await readProfileAvatarImage(file)).toBe('data:image/webp;base64,resized');
  expect(env.created).toHaveBeenCalledWith(file);
  expect(env.decodedSource()).toBe('blob:profile-upload');
  expect([env.canvas.width, env.canvas.height]).toEqual([256, 128]);
  expect(env.drawnSize()).toEqual([256, 128]);
  expect(env.encoding()).toEqual(['image/png', 0.9]);
  expect(env.revoked).toHaveBeenCalledWith('blob:profile-upload');
});

test('profile upload does not enlarge small images', async () => {
  const env = imageEnvironment({ width: 32, height: 64 });
  await readProfileAvatarImage(new File(['image'], 'avatar.png', { type: 'image/png' }));
  expect([env.canvas.width, env.canvas.height]).toEqual([32, 64]);
});

for (const type of ['image/jpeg', 'image/webp', 'image/gif']) {
  test(`profile upload converts ${type} to WebP and bounds portrait dimensions`, async () => {
    const env = imageEnvironment({ width: 1, height: 1024 });
    await readProfileAvatarImage(new File(['image'], 'avatar', { type }));
    expect([env.canvas.width, env.canvas.height]).toEqual([1, 256]);
    expect(env.encoding()).toEqual(['image/webp', 0.9]);
    expect(env.revoked).toHaveBeenCalledWith('blob:profile-upload');
  });
}

for (const [failure, message] of [
  [{ decodeError: true }, 'Decode failed'],
  [{ canvasError: true }, 'Canvas unavailable'],
  [{ encodeError: true }, 'Encoding failed'],
] as const) {
  test(`profile upload revokes its object URL after ${message}`, async () => {
    const env = imageEnvironment(failure);
    await expect(readProfileAvatarImage(new File(['image'], 'avatar.png', { type: 'image/png' }))).rejects.toThrow(message);
    expect(env.revoked).toHaveBeenCalledTimes(1);
    expect(env.revoked).toHaveBeenCalledWith('blob:profile-upload');
  });
}
