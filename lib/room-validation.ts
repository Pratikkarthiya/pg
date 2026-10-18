export const roomTypes = ['two-sharing', 'four-sharing'] as const;
export type RoomSlug = typeof roomTypes[number];
export function isRoomSlug(value: unknown): value is RoomSlug {
  return typeof value === 'string' && roomTypes.includes(value as RoomSlug);
}
export function validRent(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1000000);
}
export function imageType(data: Uint8Array): string | null {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if ([137,80,78,71,13,10,26,10].every((n,i) => data[i] === n)) return 'image/png';
  if (String.fromCharCode(...data.slice(0,4)) === 'RIFF' && String.fromCharCode(...data.slice(8,12)) === 'WEBP') return 'image/webp';
  return null;
}
