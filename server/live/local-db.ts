import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Database, QueryResult, Statement } from './db.ts';
class LocalStatement implements Statement {
  readonly db: DatabaseSync; readonly sql: string; readonly values: unknown[];
  constructor(db: DatabaseSync, sql: string, values: unknown[] = []) { this.db=db;this.sql=sql;this.values=values; }
  bind(...values: unknown[]) { return new LocalStatement(this.db,this.sql,values); }
  parameters() { return this.values.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v) as SQLInputValue[]; }
  async first<T>() { return (this.db.prepare(this.sql).get(...this.parameters()) ?? null) as T | null; }
  async all<T>(): Promise<QueryResult<T>> { return {results:this.db.prepare(this.sql).all(...this.parameters()) as T[],meta:{}}; }
  execute(): QueryResult {const r=this.db.prepare(this.sql).run(...this.parameters());return {results:[],meta:{changes:Number(r.changes)}};}
  async run(): Promise<QueryResult> { return this.execute(); }
}
export class LocalDatabase implements Database {
  readonly sqlite: DatabaseSync;
  constructor(file: string) { this.sqlite=new DatabaseSync(file);this.sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;'); }
  prepare(sql:string){return new LocalStatement(this.sqlite,sql);}
  async batch(statements:Statement[]){
    // All SQLite statements execute synchronously: no await/microtask can interleave a transaction.
    if(!statements.every(s=>s instanceof LocalStatement&&s.db===this.sqlite))throw new Error('foreign statement');
    this.sqlite.exec('BEGIN IMMEDIATE');
    try{const results=statements.map(s=>(s as LocalStatement).execute());this.sqlite.exec('COMMIT');return results;}
    catch(error){this.sqlite.exec('ROLLBACK');throw error;}
  }
  close(){this.sqlite.close();}
}
