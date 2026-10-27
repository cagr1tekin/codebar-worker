import { Hono } from 'hono';
import type { Env, SyncChange } from '../types';
import { SYNCABLE_TABLES } from '../types';
import { requireAuth, now } from '../middleware';

const sync = new Hono<{ Bindings: Env }>();

// ─── POST /sync-push ──────────────────────────────────────────
// SyncManager'ın mevcut interface'i: { storeId, changes[] }
sync.post('/sync-push', requireAuth, async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json<{ storeId: string; changes: SyncChange[] }>();

  if (body.storeId !== auth.storeId) {
    return c.json({ success: false, error: 'Yetkisiz mağaza erişimi' }, 403);
  }

  const syncedIds: string[] = [];
  const errors: string[] = [];

  for (const change of body.changes) {
    if (!SYNCABLE_TABLES.includes(change.table_name as typeof SYNCABLE_TABLES[number])) {
      errors.push(`Bilinmeyen tablo: ${change.table_name}`);
      continue;
    }
    if (change.store_id !== auth.storeId) {
      errors.push(`Yetkisiz store_id: ${change.id}`);
      continue;
    }

    try {
      await upsertRecord(c.env.DB, change.table_name, change.record_id, change.data);
      syncedIds.push(change.id);
    } catch (err) {
      errors.push(`${change.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return c.json({ success: true, syncedIds, errors });
});

// ─── POST /sync-pull ──────────────────────────────────────────
// SyncManager'ın mevcut interface'i: { storeId, lastSync: { tableName: timestamp } }
sync.post('/sync-pull', requireAuth, async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json<{ storeId: string; lastSync: Record<string, string> }>();

  if (body.storeId !== auth.storeId) {
    return c.json({ success: false, error: 'Yetkisiz mağaza erişimi' }, 403);
  }

  const tables: Record<string, Record<string, unknown>[]> = {};

  for (const tableName of SYNCABLE_TABLES) {
    const lastSync = body.lastSync[tableName] ?? '1970-01-01T00:00:00.000Z';
    const tsColumn = getTimestampColumn(tableName);

    // stores tablosu store_id sütunu yok, id'ye göre filtrele
    const query = tableName === 'stores'
      ? `SELECT * FROM stores WHERE id = ? AND ${tsColumn} > ?`
      : `SELECT * FROM ${tableName} WHERE store_id = ? AND ${tsColumn} > ?`;

    const result = await c.env.DB
      .prepare(query)
      .bind(auth.storeId, lastSync)
      .all<Record<string, unknown>>();

    if (result.results.length > 0) {
      tables[tableName] = result.results;
    }
  }

  return c.json({ success: true, tables, pulledAt: now() });
});

// ─── Yardımcılar ─────────────────────────────────────────────

async function upsertRecord(
  db: D1Database,
  tableName: string,
  recordId: string,
  data: Record<string, unknown>,
): Promise<void> {
  // Tabloda hangi kolonların var olduğunu sorgula (şema uyumsuzluklarına karşı)
  const tableInfo = await db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all<{ name: string }>();
  const validCols = new Set(tableInfo.results.map(r => r.name));

  // Sadece D1'de var olan kolonları al, updated_at'i server zamanıyla güncelle
  const raw = { ...data, updated_at: now() };
  const safeData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (validCols.has(k)) safeData[k] = v;
  }
  safeData['id'] = recordId;

  // Mevcut kayıt var mı?
  const existing = await db
    .prepare(`SELECT id FROM ${tableName} WHERE id = ?`)
    .bind(recordId)
    .first<{ id: string }>();

  if (existing) {
    // UPDATE
    const cols = Object.keys(safeData).filter(k => k !== 'id');
    const sets = cols.map(k => `${k} = ?`).join(', ');
    const vals = cols.map(k => toSQLValue(safeData[k]));
    await db.prepare(`UPDATE ${tableName} SET ${sets} WHERE id = ?`)
      .bind(...vals, recordId)
      .run();
  } else {
    // INSERT
    const cols = Object.keys(safeData);
    const placeholders = cols.map(() => '?').join(', ');
    const vals = cols.map(k => toSQLValue(safeData[k]));
    await db.prepare(`INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})`)
      .bind(...vals)
      .run();
  }
}

function toSQLValue(val: unknown): string | number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'number') return val;
  return String(val);
}

function getTimestampColumn(tableName: string): string {
  const createdAtOnly = ['customer_transactions', 'pos_transactions', 'pos_transaction_items'];
  return createdAtOnly.includes(tableName) ? 'created_at' : 'updated_at';
}

export { sync as syncRoutes };
