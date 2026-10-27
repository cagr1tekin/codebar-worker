import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { authRoutes } from './routes/auth';
import { syncRoutes } from './routes/sync';
import { adminRoutes } from './routes/admin';

const app = new Hono<{ Bindings: Env }>();

// CORS — Electron app + web panel + landing page erişimi için
app.use('*', cors({
  origin: ['http://localhost:5173', 'https://codebar.com', 'app://localhost', 'https://codebar-landing.pages.dev'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

// ─── Routes ──────────────────────────────────────────────────

app.route('/auth', authRoutes);
app.route('/', syncRoutes);       // /sync-push, /sync-pull (SyncManager ile uyumlu)
app.route('/admin', adminRoutes); // /admin/*, /admin/check-claim

// ─── Health Check ─────────────────────────────────────────────
app.get('/', (c) => c.json({ ok: true, service: 'CodeBar API', version: '1.0.0' }));

// ─── Latest Release (landing page için) ───────────────────────
app.get('/latest', async (c) => {
  try {
    const obj = await c.env.UPDATES.get('latest.yml');
    if (!obj) return c.json({ success: false, error: 'latest.yml bulunamadı' }, 404);
    const text = await obj.text();
    const versionMatch = text.match(/^version:\s*(.+)$/m);
    const pathMatch = text.match(/^path:\s*(.+)$/m);
    if (!versionMatch) return c.json({ success: false, error: 'Versiyon bulunamadı' }, 502);
    const version = versionMatch[1].trim();
    const fileName = pathMatch ? pathMatch[1].trim() : `CodeBar V2 Setup ${version}.exe`;
    const base = new URL(c.req.url).origin;
    return c.json({
      success: true,
      version,
      downloadUrl: `${base}/download/${encodeURIComponent(fileName)}`,
    });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 502);
  }
});

// ─── Download Proxy (r2.dev yerine workers.dev üzerinden) ────
app.get('/download/:filename', async (c) => {
  const filename = decodeURIComponent(c.req.param('filename'));
  const obj = await c.env.UPDATES.get(filename);
  if (!obj) return c.json({ error: 'Dosya bulunamadı' }, 404);
  const headers = new Headers();
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('Content-Disposition', `attachment; filename="${filename}"`);
  if (obj.size) headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { headers });
});

// ─── 404 ─────────────────────────────────────────────────────
app.notFound((c) => c.json({ success: false, error: 'Endpoint bulunamadı' }, 404));

// ─── Hata Yakalama ────────────────────────────────────────────
app.onError((err, c) => {
  console.error('[Worker Error]', err);
  return c.json({ success: false, error: 'Sunucu hatası' }, 500);
});

export default app;
