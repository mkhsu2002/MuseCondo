import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { LocalDatabase } from "../../server/live/local-db.ts";
// Only replace the clock input. SQLite still performs its real date parsing/calendar arithmetic.
const calendar = new DatabaseSync(":memory:");
export function installDatabaseClock(db: LocalDatabase, now: () => Date) {
  db.sqlite.function("strftime", { varargs: true }, (...args) => {
    const values = args.map((v, i) =>
      i > 0 && v === "now" ? now().toISOString() : v,
    ) as SQLInputValue[];
    return calendar
      .prepare("SELECT strftime(" + values.map(() => "?").join(",") + ") value")
      .get(...values)!.value;
  });
}
