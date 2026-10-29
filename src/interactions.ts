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
  if (input.giftId && (input.kind !== 'gift' || !giftCatalog.some(gift => gift.id === input.giftId))) throw new Error('這份原型禮物無效。');
  if (!kinds.includes(input.kind) || !/^[a-z0-9]{6,32}$/.test(input.residentId)) throw new Error('這個投遞地址無效。');
  if (!name || name.length > 24 || !text || text.length > 280) throw new Error('請填寫稱呼（1–24 字）與內容（1–280 字）。');
  if (/(https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i.test(text)) throw new Error('示範留言請勿包含連結或電子郵件，保護彼此的隱私。');
  const items = readInteractions(storage);
  if (items.some(x => x.residentId === input.residentId && x.kind === input.kind && x.text === text && x.name === name)) throw new Error('這份心意已經留下了，不需要重複投遞。');
  if (items.some(x => now - x.createdAt < 30_000)) throw new Error('請稍等 30 秒，再留下一份心意。');
  if (items.length >= 100) throw new Error('這個瀏覽器的示範信箱已滿，請先清除本機紀錄。');
  const entry = { ...input, name, text, createdAt: now, id: crypto.randomUUID() };
  try { storage.setItem(STORAGE_KEY, JSON.stringify([...items, entry])); }
  catch { throw new Error('瀏覽器無法保存，尚未送出。請檢查儲存空間或隱私設定。'); }
  return entry;
}
