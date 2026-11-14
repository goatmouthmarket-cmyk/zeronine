import { getDb } from '../db/store.ts';

export type RangerAppearance = { outfit: string; color: string; accent: string; headwear: string; accessory: string };
export type RangerProfile = { name: string; appearance: RangerAppearance };
export const DEFAULT_RANGER_APPEARANCE: RangerAppearance = { outfit: 'classic', color: '#326db1', accent: '#a65b38', headwear: 'none', accessory: 'none' };

export function normalizeRangerProfile(input: unknown): RangerProfile {
  const data = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const raw = data.appearance && typeof data.appearance === 'object' ? data.appearance as Record<string, unknown> : {};
  const option = (key: string, allowed: string[], fallback: string) => typeof raw[key] === 'string' && allowed.includes(raw[key] as string) ? raw[key] as string : fallback;
  const color = (key: string, fallback: string) => typeof raw[key] === 'string' && /^#[0-9a-f]{6}$/i.test(raw[key] as string) ? raw[key] as string : fallback;
  const name = typeof data.name === 'string' ? Array.from(data.name.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 24).join('') : '';
  return { name, appearance: { outfit: option('outfit', ['classic', 'vest', 'scout', 'jacket', 'hoodie'], 'classic'), color: color('color', DEFAULT_RANGER_APPEARANCE.color), accent: color('accent', DEFAULT_RANGER_APPEARANCE.accent), headwear: option('headwear', ['none', 'cap', 'bandana', 'hat', 'hood'], 'none'), accessory: option('accessory', ['none', 'scarf', 'badge', 'glasses', 'cape'], 'none') } };
}

function profileDb() {
  const db = getDb();
  db.exec('CREATE TABLE IF NOT EXISTS ranger_profiles (account_id TEXT PRIMARY KEY, profile_json TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  return db;
}
export function getRangerProfile(accountId: string): RangerProfile | null {
  const row = profileDb().prepare('SELECT profile_json FROM ranger_profiles WHERE account_id = ?').get(accountId) as { profile_json: string } | undefined;
  if (!row) return null;
  try { return normalizeRangerProfile(JSON.parse(row.profile_json)); } catch { return null; }
}
export function saveRangerProfile(accountId: string, profile: RangerProfile): RangerProfile {
  const normalized = normalizeRangerProfile(profile);
  profileDb().prepare('INSERT INTO ranger_profiles (account_id, profile_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET profile_json=excluded.profile_json, updated_at=excluded.updated_at').run(accountId, JSON.stringify(normalized), Date.now());
  return normalized;
}
