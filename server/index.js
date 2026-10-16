// AI 私教计划生成器 —— 单进程服务：API + 前端（dev 走 vite middleware，prod 服务 dist/）
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXERCISES } from './planSchema.js';
import { generatePlan } from './llm.js';
import { sendPlanEmail } from './email.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const isProd = process.env.NODE_ENV === 'production';

// 转发 CLI 参数：npm run dev -- --port 7100 --host 0.0.0.0
function argVal(name, dft) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dft;
}
const PORT = Number(argVal('port', process.env.PORT || 3000));
const HOST = argVal('host', process.env.HOST || '0.0.0.0');

const app = express();
app.use(express.json({ limit: '256kb' }));

// 简单限流：每 IP 每分钟最多 10 次生成请求
const buckets = new Map();
app.use('/api/plan', (req, res, next) => {
  const now = Date.now();
  const b = buckets.get(req.ip) || { count: 0, reset: now + 60_000 };
  if (now > b.reset) { b.count = 0; b.reset = now + 60_000; }
  b.count += 1;
  buckets.set(req.ip, b);
  if (b.count > 10) return res.status(429).json({ error: '请求太频繁，请一分钟后再试' });
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true, llm: !!process.env.LLM_API_KEY, resend: !!process.env.RESEND_API_KEY }));

app.get('/api/exercises', (_req, res) => res.json(EXERCISES));

app.post('/api/plan', async (req, res) => {
  try {
    const profile = req.body || {};
    if (!profile.goal) return res.status(400).json({ error: '缺少训练目标' });
    const result = await generatePlan(profile);
    res.json(result);
  } catch (err) {
    console.error('[plan]', err);
    res.status(500).json({ error: '计划生成失败，请稍后再试' });
  }
});

app.post('/api/email', async (req, res) => {
  try {
    const { to, plan } = req.body || {};
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: '邮箱格式不正确' });
    if (!plan || !plan.weeks) return res.status(400).json({ error: '缺少计划内容' });
    const data = await sendPlanEmail(to, plan);
    res.json({ ok: true, id: data?.id });
  } catch (err) {
    console.error('[email]', err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

if (isProd) {
  const dist = path.join(ROOT, 'dist');
  app.use(express.static(dist, { maxAge: '7d', index: false }));
  app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({ root: ROOT, server: { middlewareMode: true }, appType: 'custom' });
  app.use(vite.middlewares);
  app.use(async (req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    try {
      const html = await vite.transformIndexHtml(req.originalUrl, readFileSync(path.join(ROOT, 'index.html'), 'utf-8'));
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}

app.listen(PORT, HOST, () => {
  console.log(`[ai-coach] ${isProd ? 'prod' : 'dev'} listening on http://${HOST}:${PORT}`);
});
