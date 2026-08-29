import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { config } from '../config.ts';

const KEY = createHash('sha256').update(config.sessionSecret).digest();

function keyFor(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), encrypted.toString('base64'), tag.toString('base64')].join('.');
}

function decrypt(ciphertext: string, key: Buffer): string {
  const [ivB64, dataB64, tagB64] = ciphertext.split('.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

export function encryptToken(plaintext: string): string {
  return encrypt(plaintext, KEY);
}

export function decryptToken(ciphertext: string): string {
  return decrypt(ciphertext, KEY);
}

/** Gold OAuth is encrypted under an independent Railway secret. */
export function encryptGoldToken(plaintext: string, secret: string): string {
  if (secret.length < 32) throw new Error('Gold token encryption secret is invalid');
  return encrypt(plaintext, keyFor(secret));
}

export function decryptGoldToken(ciphertext: string, secret: string): string {
  if (secret.length < 32) throw new Error('Gold token encryption secret is invalid');
  return decrypt(ciphertext, keyFor(secret));
}
