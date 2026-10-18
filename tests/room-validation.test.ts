import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validRent, isRoomSlug, imageType } from '../lib/room-validation.ts';

test('rent permits clearing and rejects invalid or excessive amounts', () => {
  for (const value of [null, 1, 8500, 1000000]) assert.equal(validRent(value), true);
  for (const value of [0, -1, 1.5, '8500', undefined, NaN, Infinity, 1000001]) assert.equal(validRent(value), false);
});
test('room IDs restrict writes to the two advertised room types', () => {
  assert.equal(isRoomSlug('two-sharing'), true); assert.equal(isRoomSlug('four-sharing'), true);
  for (const value of ['single', '../admin', '', null]) assert.equal(isRoomSlug(value), false);
});
test('uploads inspect file signatures and reject executable image formats', () => {
  assert.equal(imageType(new Uint8Array([255,216,255,224])), 'image/jpeg');
  assert.equal(imageType(new Uint8Array([137,80,78,71,13,10,26,10])), 'image/png');
  assert.equal(imageType(new TextEncoder().encode('RIFF1234WEBP')), 'image/webp');
  for (const value of ['<svg onload=alert(1)>', '<script>alert(1)</script>', '']) assert.equal(imageType(new TextEncoder().encode(value)), null);
});
