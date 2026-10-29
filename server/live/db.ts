/** Structural subset of Cloudflare D1, also implemented by the local SQLite harness. */
export interface QueryResult<T = Record<string, unknown>> { results: T[]; meta: { changes?: number } }
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<QueryResult<T>>;
  run(): Promise<QueryResult>;
}
export interface Database { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<QueryResult[]> }
