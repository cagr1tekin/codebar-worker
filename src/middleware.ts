import type { Context, Next } from 'hono';
import type { Env, JWTPayload, AuthContext } from './types';
import { verifyJWT } from './crypto';

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

export async function requireAuth(c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Token gerekli' }, 401);
  }

  const token = authHeader.slice(7);
  try {
    const payload = await verifyJWT<JWTPayload>(token, c.env.JWT_SECRET);

    // Session iptal kontrolü
    const session = await c.env.DB
      .prepare('SELECT is_revoked FROM sessions WHERE id = ? AND user_id = ?')
      .bind(payload.sessionId, payload.userId)
      .first<{ is_revoked: number }>();

    if (!session || session.is_revoked === 1) {
      return c.json({ success: false, code: 'session_revoked', error: 'Oturum başka bir cihazda açıldı. Lütfen tekrar giriş yapın.' }, 401);
    }

    c.set('auth', {
      userId:    payload.userId,
      storeId:   payload.storeId,
      email:     payload.email,
      role:      payload.role,
      sessionId: payload.sessionId,
    });

    await next();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Geçersiz token';
    return c.json({ success: false, error: msg }, 401);
  }
}

export function requireRole(...roles: string[]) {
  return async (c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> => {
    const auth = c.get('auth');
    if (!roles.includes(auth.role)) {
      return c.json({ success: false, error: 'Bu işlem için yetkiniz yok' }, 403);
    }
    await next();
  };
}

export function now(): string {
  return new Date().toISOString();
}
