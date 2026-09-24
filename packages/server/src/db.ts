/**
 * SQLite persistence over node:sqlite (no native build). One table per entity
 * with `id TEXT PRIMARY KEY, json TEXT, updated_tick INTEGER` plus indexed
 * columns where the server queries by them (ledger.tick, tasks.status).
 */
import './warnings.js';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { DatabaseSync as DatabaseSyncType, StatementSync } from 'node:sqlite';

// Loaded at evaluation time (after the warning filter above is installed) rather
// than at link time, so the ExperimentalWarning is filtered instead of printed.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export const TABLES = ['ventures', 'agents', 'tasks', 'listings', 'approvals', 'ledger', 'directives'] as const;
export type TableName = (typeof TABLES)[number];

interface Row {
  id: string;
  json: string;
  updated_tick: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ventures   (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_tick INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS agents     (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_tick INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tasks      (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_tick INTEGER NOT NULL, status TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS listings   (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_tick INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS approvals  (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_tick INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ledger     (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_tick INTEGER NOT NULL, tick INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS directives (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_tick INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meta       (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_ledger_tick ON ledger(tick);
CREATE INDEX IF NOT EXISTS idx_ledger_seq ON ledger(seq);
`;

export class StationDb {
  private readonly db: DatabaseSyncType;
  private readonly upserts: Record<TableName, StatementSync>;
  private readonly deletes: Record<TableName, StatementSync>;
  private readonly metaGet: StatementSync;
  private readonly metaSet: StatementSync;
  private ledgerSeq = 0;
  private closed = false;

  constructor(readonly path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);
    const generic = (table: TableName) =>
      this.db.prepare(
        `INSERT INTO ${table} (id, json, updated_tick) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_tick = excluded.updated_tick`,
      );
    this.upserts = {
      ventures: generic('ventures'),
      agents: generic('agents'),
      listings: generic('listings'),
      approvals: generic('approvals'),
      directives: generic('directives'),
      tasks: this.db.prepare(
        `INSERT INTO tasks (id, json, updated_tick, status) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_tick = excluded.updated_tick, status = excluded.status`,
      ),
      ledger: this.db.prepare(
        `INSERT INTO ledger (id, json, updated_tick, tick, seq) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_tick = excluded.updated_tick, tick = excluded.tick`,
      ),
    };
    const del = (table: TableName) => this.db.prepare(`DELETE FROM ${table} WHERE id = ?`);
    this.deletes = {
      ventures: del('ventures'),
      agents: del('agents'),
      tasks: del('tasks'),
      listings: del('listings'),
      approvals: del('approvals'),
      ledger: del('ledger'),
      directives: del('directives'),
    };
    this.metaGet = this.db.prepare('SELECT value FROM meta WHERE key = ?');
    this.metaSet = this.db.prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    const seqRow = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM ledger').get() as { seq: number } | undefined;
    this.ledgerSeq = Number(seqRow?.seq ?? 0);
  }

  /** Every row of a table, parsed. Ledger rows come back in insertion order. */
  loadAll<T>(table: TableName): T[] {
    const order = table === 'ledger' ? 'ORDER BY seq ASC' : 'ORDER BY rowid ASC';
    const rows = this.db.prepare(`SELECT id, json, updated_tick FROM ${table} ${order}`).all() as unknown as Row[];
    return rows.map((row) => JSON.parse(row.json) as T);
  }

  count(table: TableName): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number } | undefined;
    return Number(row?.n ?? 0);
  }

  isEmpty(): boolean {
    return TABLES.every((table) => this.count(table) === 0);
  }

  upsert(table: TableName, id: string, value: unknown, tick: number): void {
    const json = JSON.stringify(value);
    if (table === 'tasks') {
      const status = (value as { status?: string }).status ?? '';
      this.upserts.tasks.run(id, json, tick, status);
    } else if (table === 'ledger') {
      const entryTick = Number((value as { tick?: number }).tick ?? tick);
      this.ledgerSeq += 1;
      this.upserts.ledger.run(id, json, tick, entryTick, this.ledgerSeq);
    } else {
      this.upserts[table].run(id, json, tick);
    }
  }

  remove(table: TableName, id: string): void {
    this.deletes[table].run(id);
  }

  /** Ledger entries with tick >= sinceTick, oldest first, capped at limit. */
  ledgerSince<T>(sinceTick: number, limit: number): T[] {
    const rows = this.db
      .prepare('SELECT json FROM ledger WHERE tick >= ? ORDER BY seq ASC LIMIT ?')
      .all(sinceTick, limit) as unknown as Array<{ json: string }>;
    return rows.map((row) => JSON.parse(row.json) as T);
  }

  getMeta<T>(key: string): T | undefined {
    const row = this.metaGet.get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  setMeta(key: string, value: unknown): void {
    this.metaSet.run(key, JSON.stringify(value));
  }

  /** Runs fn inside BEGIN/COMMIT; rolls back and rethrows on failure. */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
