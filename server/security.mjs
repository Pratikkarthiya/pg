import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export const token = () => randomBytes(32).toString('base64url');
export const digest = value => createHash('sha256').update(value).digest('hex');
export const equalTokens = (left, right) => typeof left === 'string' && typeof right === 'string' && timingSafeEqual(Buffer.from(digest(left),'hex'),Buffer.from(digest(right),'hex'));
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  const [salt, value] = encoded.split(':');
  const key = await scrypt(password, salt, 64); const expected = Buffer.from(value, 'hex');
  return expected.length === key.length && timingSafeEqual(expected, key);
}
export function passwordError(value) {
  return typeof value !== 'string' || value.length < 12 || value.length > 128 ? 'Use a password with 12–128 characters.' : null;
}
export function imageType(data) {
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if ([137,80,78,71,13,10,26,10].every((n,i) => data[i] === n)) return 'image/png';
  if (data.subarray(0,4).toString() === 'RIFF' && data.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  return null;
}
