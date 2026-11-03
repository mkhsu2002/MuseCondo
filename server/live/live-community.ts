import type { Database } from './db.ts';
import type { Room, Post } from './live-types.ts';
import type { ManagerSnapshot } from './tower-manager.ts';
import { digest } from './live-contract.ts';
import { publicEvents, validateCommunity, type Edition, type EventFile, type PublicEvent } from '../../src/community/schema.ts';
import { ruleSections } from '../../src/community/rules.ts';
/** Projection reads only consented sources; persistence and notification are explicit. */
export function createLiveCommunity(env: {
    db: Database;
    stamp: () => string;
    towerEnabled?: boolean;
    onCommunityChanged?: (snapshot: ManagerSnapshot) => Promise<void>;
}) {
    const { db, stamp } = env;
    const one = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).first<T>();
    const all = async <T>(sql: string, ...args: unknown[]) => (await db.prepare(sql).bind(...args).all<T>()).results;
    const run = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).run();
    async function editBuilding(persist = true) {
        const rooms = await all<Room>('SELECT * FROM rooms WHERE published=1 ORDER BY created_at DESC');
        const ids = rooms.map(r => r.id);
        const saved = await one<{
            id: string;
            events_json: string;
            edition_json: string;
        }>('SELECT id,events_json,edition_json FROM community_editions WHERE id=(SELECT edition_id FROM community_current WHERE id=1)');
        const previousEvents = saved ? (JSON.parse(saved.events_json) as EventFile).events : [];
        const publishedArrivals = new Map(previousEvents.filter(e => e.type === 'arrival').map(e => [e.id, e]));
        const towerRows = new Map(env.towerEnabled ? (await all<{
            room_id: string;
            announcement_consent: number;
            publication_epoch: number;
            published_at: string | null;
        }>('SELECT room_id,announcement_consent,publication_epoch,published_at FROM tower_residencies')).map(r => [r.room_id, r]) : []);
        const events: PublicEvent[] = rooms.filter(r => !towerRows.has(r.id) || towerRows.get(r.id)?.announcement_consent === 1).map(r => ({
            id: `${r.id}-arrival${towerRows.has(r.id) ? '-' + towerRows.get(r.id)!.publication_epoch : ''}`, residentId: r.id, type: 'arrival', occurredAt: r.created_at, publishedAt: towerRows.get(r.id)?.published_at ?? r.created_at, visibility: 'public', publicationConsent: true, origin: 'resident-authorized', isFixture: false, title: `${r.name} has moved in`, summary: r.intro.slice(0, 300), body: r.intro
        }));
        // Keep a previously published arrival verbatim while its source tuple is unchanged. New arrivals use English.
        for (const event of events) {
            const previous = publishedArrivals.get(event.id);
            if (previous && ([
                'residentId', 'type', 'occurredAt', 'publishedAt', 'visibility', 'publicationConsent', 'origin', 'isFixture', 'summary', 'body'
            ] as const).every(key => previous[key] === event[key]))
                event.title = previous.title;
        }
        const posts = await all<Post>("SELECT p.* FROM posts p JOIN rooms r ON r.id=p.room_id WHERE p.is_public=1 AND p.withdrawn_at IS NULL AND p.kind IN ('journal','status','seeking') AND r.published=1 ORDER BY p.created_at DESC");
        for (const p of posts.filter(p => !towerRows.has(p.room_id) || towerRows.get(p.room_id)?.announcement_consent === 1))
            events.push({
                id: p.id, residentId: p.room_id, type: p.kind as PublicEvent['type'], occurredAt: p.created_at, publishedAt: p.created_at, visibility: 'public', publicationConsent: true, origin: 'resident-authorized', isFixture: false, title: p.title, summary: p.body.slice(0, 300), body: p.body
            });
        const asOf = stamp(), publicInput = publicEvents(events, ids, asOf), sourceDigest = await digest(JSON.stringify(publicInput));
        if (saved) {
            const previous = JSON.parse(saved.edition_json) as Edition;
            if (previous.sourceDigest === sourceDigest) {
                if (persist)
                    await run('INSERT INTO community_current(id,edition_id) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET edition_id=excluded.edition_id', saved.id);
                return { events: publicInput, edition: previous };
            }
        }
        const edition: Edition = {
            schemaVersion: 1, id: `edition-${crypto.randomUUID()}`, sourceDigest, asOf, editedAt: asOf, editor: {
                kind: 'rules', version: 'public-community-four-sections-v2-en', model: null
            }, isFixture: publicInput.every(e => e.isFixture), sections: ruleSections(publicInput)
        };
        const eventFile = {
            schemaVersion: 1 as const, sourceDigest, events: publicInput
        };
        validateCommunity(eventFile, edition, ids);
        if (persist)
            await db.batch([db.prepare('INSERT INTO community_editions(id,events_json,edition_json,created_at) VALUES(?,?,?,?)').bind(edition.id, JSON.stringify(eventFile), JSON.stringify(edition), asOf), db.prepare('INSERT INTO community_current(id,edition_id) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET edition_id=excluded.edition_id').bind(edition.id)]);
        if (persist && env.onCommunityChanged)
            await env.onCommunityChanged({
                events: publicInput, residentIds: ids, sourceDigest, asOf
            });
        return { events: publicInput, edition };
    }
    return { editBuilding };
}
