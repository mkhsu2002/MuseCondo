import type { LocalDatabase } from "../../server/live/local-db.ts";

/** Replace only the explicit creation-time read; atomic SQL clocks stay native. */
export function replaceCreationClock(db: LocalDatabase, read: () => Promise<unknown>) {
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const statement = prepare(sql);
    if (sql.endsWith(" AS identity_now"))
      statement.first = async <T>() => await read() as T | null;
    return statement;
  };
}
