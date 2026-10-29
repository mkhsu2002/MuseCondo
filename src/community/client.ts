import { canonicalEvents, validateCommunity, type Community, type CommunityIndex, type Edition, type EventFile } from './schema';
export async function loadCommunity(base: string, residentIds: readonly string[]): Promise<Community> {
  const read = async <T>(file: string): Promise<T> => {
    const response = await fetch(`${base}/community/${file}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('無法讀取公開佈告檔案');
    return response.json() as Promise<T>;
  };
  const index = await read<CommunityIndex>('index.json');
  if (index.schemaVersion !== 1 || !/^events-[a-f0-9]{64}\.json$/.test(index.eventsFile) || !/^edition-[a-f0-9-]{36}\.json$/.test(index.editionFile) || `${index.editionId}.json` !== index.editionFile) throw new Error('選輯索引格式不符');
  const [events, edition] = await Promise.all([read<EventFile>(index.eventsFile), read<Edition>(index.editionFile)]);
  if (edition.id !== index.editionId) throw new Error('選輯索引不一致');
  const result = validateCommunity(events, edition, residentIds);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalEvents(result.events)));
  const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  if (hex !== edition.sourceDigest) throw new Error('公開活動來源驗證失敗');
  return result;
}
