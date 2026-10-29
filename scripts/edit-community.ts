import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { residents } from '../src/residents.ts';
import { editCommunity, metaEditor, publishEdition, ruleEditor } from '../server/community.ts';
const args = process.argv.slice(2);
function option(name: string, fallback: string) { const i = args.indexOf(`--${name}`); if (i >= 0 && (!args[i + 1] || args[i + 1].startsWith('--'))) throw new Error(`Missing --${name} value`); return i < 0 ? fallback : args[i + 1]; }
for (let i = 0; i < args.length; i += 2) if (!['--input', '--out', '--as-of', '--edited-at', '--editor'].includes(args[i])) throw new Error(`Unknown option ${args[i]}`);
const now = new Date().toISOString();
const editorKind = option('editor', 'rules');
if (!['rules', 'meta'].includes(editorKind)) throw new Error('Editor must be rules or meta');
const editor = editorKind === 'rules' ? ruleEditor : metaEditor({
  apiKey: process.env.MODEL_API_KEY, approvedPaidCalls: process.env.MUSE_META_APPROVED_PAID_CALLS === 'true',
  model: process.env.MUSE_META_MODEL && process.env.MUSE_META_METADATA_SOURCE && process.env.MUSE_META_METADATA_VERIFIED_AT ? { id: process.env.MUSE_META_MODEL, metadataSource: process.env.MUSE_META_METADATA_SOURCE, verifiedAt: process.env.MUSE_META_METADATA_VERIFIED_AT } : undefined,
});
const input = JSON.parse(await readFile(resolve(option('input', 'fixtures/resident-activities.json')), 'utf8')) as unknown;
const result = await editCommunity(input, residents.map(r => r.id), { asOf: option('as-of', now), editedAt: option('edited-at', now), editor });
const index = await publishEdition(resolve(option('out', 'public/community')), result);
console.log(JSON.stringify({ ...index, events: result.eventsFile.events.length, editor: result.edition.editor, sourceDigest: result.edition.sourceDigest, asOf: result.edition.asOf, editedAt: result.edition.editedAt }, null, 2));
