import { describe, expect, test } from 'bun:test';
import { profileFingerprint } from '../src/web/pages/bot/SettingsTab';

const profile = { name: 'Bot', description: '', avatar: undefined, color: undefined };

describe('bot profile draft', () => {
  test('dirty comparison includes every editable profile field', () => {
    const initial = profileFingerprint(profile);
    expect(profileFingerprint({ ...profile })).toBe(initial);
    expect(profileFingerprint({ ...profile, name: 'Edited' })).not.toBe(initial);
    expect(profileFingerprint({ ...profile, description: 'Helps with research' })).not.toBe(initial);
    expect(profileFingerprint({ ...profile, avatar: 'dicebear:gaze:seed' })).not.toBe(initial);
    expect(profileFingerprint({ ...profile, color: 'teal' })).not.toBe(initial);
  });

  test('reverting each field returns to the clean state', () => {
    const initial = profileFingerprint(profile);
    expect(profileFingerprint({ ...profile, name: 'Edited', description: 'x', avatar: 'y', color: 'rose' })).not.toBe(initial);
    expect(profileFingerprint({ ...profile, name: 'Bot', description: '', avatar: undefined, color: undefined })).toBe(initial);
  });

  test('undefined and empty optional fields are equivalent', () => {
    expect(profileFingerprint(profile)).toBe(profileFingerprint({ ...profile, avatar: '', color: '' }));
  });
});
