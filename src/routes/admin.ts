import { Hono } from 'hono';
import type { Env } from '../types';
import { encodeStoreClaim, decodeStoreClaim, newUUID } from '../crypto';
import { requireAuth, requireRole, now } from '../middleware';

const admin = new Hono<{ Bindings: Env }>();

// ─── POST /admin/create-store ─────────────────────────────────
// Yeni mağaza oluştur + claim token üret
admin.post('/create-store', requireAuth, requireRole('superadmin'), async (c) => {
  const { name, address, phone, taxNumber } = await c.req.json<{
    name: string; address?: string; phone?: string; taxNumber?: string;
  }>();

  if (!name) return c.json({ success: false, error: 'Mağaza adı zorunlu' }, 400);

  const storeId = newUUID();
  const ts = now();

  await c.env.DB
    .prepare('INSERT INTO stores (id, name, address, phone, tax_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(storeId, name, address ?? null, phone ?? null, taxNumber ?? null, ts, ts)
    .run();

  const claimToken = await encodeStoreClaim(storeId, c.env.CLAIM_SECRET);

  return c.json({ success: true, storeId, claimToken });
});

// ─── POST /admin/generate-claim ───────────────────────────────
// Mevcut mağaza için yeni claim token üret
admin.post('/generate-claim', requireAuth, requireRole('superadmin', 'admin'), async (c) => {
  const { storeId } = await c.req.json<{ storeId: string }>();
  if (!storeId) return c.json({ success: false, error: 'storeId zorunlu' }, 400);

  const store = await c.env.DB
    .prepare('SELECT id FROM stores WHERE id = ?')
    .bind(storeId)
    .first<{ id: string }>();
  if (!store) return c.json({ success: false, error: 'Mağaza bulunamadı' }, 404);

  const claimToken = await encodeStoreClaim(storeId, c.env.CLAIM_SECRET);
  return c.json({ success: true, storeId, claimToken });
});

// ─── GET /admin/stores ────────────────────────────────────────
admin.get('/stores', requireAuth, requireRole('superadmin'), async (c) => {
  const result = await c.env.DB
    .prepare('SELECT id, name, address, phone, subscription_end_date, created_at FROM stores WHERE is_deleted = 0 ORDER BY created_at DESC')
    .all<{ id: string; name: string; address: string; phone: string; subscription_end_date: string; created_at: string }>();

  return c.json({ success: true, stores: result.results });
});

// ─── POST /setup/check-claim ──────────────────────────────────
// Claim token'ı çöz → storeId döndür (kurulum sırasında)
admin.post('/check-claim', async (c) => {
  const { claimToken } = await c.req.json<{ claimToken: string }>();
  if (!claimToken) return c.json({ success: false, error: 'Claim token zorunlu' }, 400);

  const storeId = await decodeStoreClaim(claimToken, c.env.CLAIM_SECRET);
  if (!storeId) return c.json({ success: false, error: 'Geçersiz veya bozulmuş kod' }, 400);

  const store = await c.env.DB
    .prepare('SELECT id, name FROM stores WHERE id = ?')
    .bind(storeId)
    .first<{ id: string; name: string }>();
  if (!store) return c.json({ success: false, error: 'Mağaza bulunamadı' }, 404);

  // İlk kullanıcı gerekiyor mu?
  const userCount = await c.env.DB
    .prepare('SELECT COUNT(*) as cnt FROM users WHERE store_id = ?')
    .bind(storeId)
    .first<{ cnt: number }>();

  return c.json({
    success: true,
    storeId,
    storeName: store.name,
    needsFirstUser: (userCount?.cnt ?? 0) === 0,
  });
});

export { admin as adminRoutes };
