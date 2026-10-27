import { Hono } from 'hono';
import type { Env } from '../types';
import { hashPassword, verifyPassword, signJWT, newUUID } from '../crypto';
import { requireAuth, now } from '../middleware';

const auth = new Hono<{ Bindings: Env }>();

const JWT_EXPIRES_IN = 60 * 60 * 24 * 30; // 30 gün (saniye)

// ─── POST /auth/login ─────────────────────────────────────────
auth.post('/login', async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>();
  if (!email || !password) return c.json({ success: false, error: 'Email ve şifre gerekli' }, 400);

  const user = await c.env.DB
    .prepare('SELECT id, store_id, email, password_hash, salt, full_name, role, is_active FROM users WHERE email = ?')
    .bind(email.toLowerCase().trim())
    .first<{ id: string; store_id: string; email: string; password_hash: string; salt: string; full_name: string; role: string; is_active: number }>();

  if (!user || !(await verifyPassword(password, user.password_hash, user.salt))) {
    return c.json({ success: false, error: 'E-posta veya şifre hatalı' }, 401);
  }

  if (!user.is_active) {
    return c.json({ success: false, error: 'Hesabınız devre dışı bırakılmış' }, 403);
  }

  const sessionId  = newUUID();
  const expiresAt  = new Date(Date.now() + JWT_EXPIRES_IN * 1000).toISOString();

  await c.env.DB
    .prepare('INSERT INTO sessions (id, user_id, store_id, expires_at) VALUES (?, ?, ?, ?)')
    .bind(sessionId, user.id, user.store_id ?? '', expiresAt)
    .run();

  const token = await signJWT(
    { userId: user.id, storeId: user.store_id, email: user.email, role: user.role, sessionId, exp: Math.floor(Date.now() / 1000) + JWT_EXPIRES_IN },
    c.env.JWT_SECRET,
  );

  const employee = await c.env.DB
    .prepare('SELECT id, full_name, role FROM employees WHERE user_id = ? AND store_id = ? AND is_deleted = 0')
    .bind(user.id, user.store_id)
    .first<{ id: string; full_name: string; role: string }>();

  return c.json({
    success: true,
    token,
    user: {
      id:       user.id,
      username: user.email,
      fullName: employee?.full_name ?? user.full_name,
      role:     user.role,
      storeId:  user.store_id,
    },
  });
});

// ─── POST /auth/register ──────────────────────────────────────
auth.post('/register', async (c) => {
  const body = await c.req.json<{
    email: string; password: string; fullName: string;
    storeId: string; role?: string; claimToken?: string;
  }>();

  const { email, password, fullName, storeId } = body;
  if (!email || !password || !fullName || !storeId) {
    return c.json({ success: false, error: 'Tüm alanlar zorunlu' }, 400);
  }

  const store = await c.env.DB
    .prepare('SELECT id FROM stores WHERE id = ?')
    .bind(storeId)
    .first<{ id: string }>();
  if (!store) return c.json({ success: false, error: 'Mağaza bulunamadı' }, 404);

  const existing = await c.env.DB
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(email.toLowerCase().trim())
    .first<{ id: string }>();
  if (existing) return c.json({ success: false, error: 'Bu e-posta zaten kayıtlı' }, 409);

  // İlk kullanıcı ise admin, değilse cashier
  const userCount = await c.env.DB
    .prepare('SELECT COUNT(*) as cnt FROM users WHERE store_id = ?')
    .bind(storeId)
    .first<{ cnt: number }>();

  const role     = (userCount?.cnt ?? 0) === 0 ? 'admin' : (body.role ?? 'cashier');
  const userId   = newUUID();
  const empId    = newUUID();
  const { hash, salt } = await hashPassword(password);
  const ts       = now();

  // users tablosu: admin/manager/cashier — employees tablosu: CASHIER/MANAGER/STOCK/OTHER
  const EMP_ROLE_MAP: Record<string, string> = { superadmin: 'OTHER', admin: 'OTHER', manager: 'MANAGER', cashier: 'CASHIER' };
  const empRole = EMP_ROLE_MAP[role.toLowerCase()] ?? (['CASHIER','MANAGER','STOCK','OTHER'].includes(role.toUpperCase()) ? role.toUpperCase() : 'OTHER');

  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO users (id, store_id, email, password_hash, salt, full_name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(userId, storeId, email.toLowerCase().trim(), hash, salt, fullName, role, ts, ts),
    c.env.DB.prepare('INSERT INTO employees (id, store_id, user_id, full_name, email, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(empId, storeId, userId, fullName, email.toLowerCase().trim(), empRole, ts, ts),
  ]);

  return c.json({ success: true, userId, employeeId: empId });
});

// ─── GET /auth/session ────────────────────────────────────────
auth.get('/session', requireAuth, async (c) => {
  const { userId, storeId } = c.get('auth');

  const user = await c.env.DB
    .prepare('SELECT id, email, full_name, role FROM users WHERE id = ? AND store_id = ?')
    .bind(userId, storeId)
    .first<{ id: string; email: string; full_name: string; role: string }>();

  if (!user) return c.json({ success: false, error: 'Kullanıcı bulunamadı' }, 404);

  const employee = await c.env.DB
    .prepare('SELECT id, full_name, role FROM employees WHERE user_id = ? AND store_id = ? AND is_deleted = 0')
    .bind(userId, storeId)
    .first<{ id: string; full_name: string; role: string }>();

  return c.json({
    success: true,
    user: {
      id:       user.id,
      username: user.email,
      fullName: employee?.full_name ?? user.full_name,
      role:     user.role,
      storeId,
    },
  });
});

// ─── POST /auth/logout ────────────────────────────────────────
auth.post('/logout', requireAuth, async (c) => {
  const { sessionId } = c.get('auth');
  await c.env.DB
    .prepare('UPDATE sessions SET is_revoked = 1 WHERE id = ?')
    .bind(sessionId)
    .run();
  return c.json({ success: true });
});

// ─── POST /auth/reset-password ────────────────────────────────
// Basit versiyon: yeni şifre doğrudan gönderilir (email yok, Electron app üzerinden)
auth.post('/reset-password', requireAuth, async (c) => {
  const { userId } = c.get('auth');
  const { newPassword } = await c.req.json<{ newPassword: string }>();
  if (!newPassword || newPassword.length < 4) {
    return c.json({ success: false, error: 'Şifre en az 4 karakter olmalı' }, 400);
  }

  const { hash, salt } = await hashPassword(newPassword);
  await c.env.DB
    .prepare('UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?')
    .bind(hash, salt, now(), userId)
    .run();

  // Tüm diğer oturumları iptal et
  await c.env.DB
    .prepare('UPDATE sessions SET is_revoked = 1 WHERE user_id = ? AND id != ?')
    .bind(userId, c.get('auth').sessionId)
    .run();

  return c.json({ success: true });
});

export { auth as authRoutes };
