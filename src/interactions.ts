import { giftCatalog } from './artwork.ts';
export type InteractionKind = 'message' | 'gift' | 'invitation';
export interface Interaction {
  id: string; giftId?: string; residentId: string; kind: InteractionKind; name: string; text: string; createdAt: number;
}
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export const STORAGE_KEY = 'musecondo.demo.interactions.v1';
const kinds = ['message', 'gift', 'invitation'];
export function readInteractions(storage: StorageLike): Interaction[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((x): x is Interaction => Boolean(x && typeof x === 'object' &&
      typeof x.id === 'string' && typeof x.residentId === 'string' && kinds.includes(x.kind) &&
      typeof x.name === 'string' && x.name.length <= 24 && typeof x.text === 'string' &&
      x.text.length <= 280 && typeof x.createdAt === 'number' && Number.isFinite(x.createdAt)));
  } catch { return []; }
}
export function addInteraction(storage: StorageLike, input: Omit<Interaction, 'id' | 'createdAt'>, now = Date.now()): Interaction {
  const name = input.name.trim(); const text = input.text.trim();
  if (input.giftId && (input.kind !== 'gift' || !giftCatalog.some(gift => gift.id === input.giftId))) throw new Error('This demo gift is invalid.');
  if (!kinds.includes(input.kind) || !/^[a-z0-9]{6,32}$/.test(input.residentId)) throw new Error('This delivery address is invalid.');
  if (!name || name.length > 24 || !text || text.length > 280) throw new Error('Enter a name (1–24 characters) and a message (1–280 characters)。');
  if (/(https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i.test(text)) throw new Error('Keep links and email addresses out of demo messages to protect everyone\'s privacy.');
  const items = readInteractions(storage);
  if (items.some(x => x.residentId === input.residentId && x.kind === input.kind && x.text === text && x.name === name)) throw new Error('This greeting is already saved. There is no need to submit it again.');
  if (items.some(x => now - x.createdAt < 30_000)) throw new Error('Wait 30 seconds before leaving another entry.');
  if (items.length >= 100) throw new Error('This browser\'s demo inbox is full. Clear local entries first.');
  const entry = { ...input, name, text, createdAt: now, id: crypto.randomUUID() };
  try { storage.setItem(STORAGE_KEY, JSON.stringify([...items, entry])); }
  catch { throw new Error('Your browser could not save this entry. Nothing was sent. Check your storage or privacy settings.'); }
  return entry;
}
