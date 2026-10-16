// AI 私教计划生成器 —— 单进程服务：API + 前端（dev 走 vite middleware，prod 服务 dist/）
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXERCISES } from './planSchema.js';
import { generatePlan } from './llm.js';
import { sendPlanEmail } from './email.js';
import { dbEnabled, initDb } from './db.js';
import {
  sendLoginCode, register, loginWithPassword, resolveUser, logout,
  guestTryUse, savePlan, listPlans, getPlan,
} from './auth.js';

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
app.set('trust proxy', 1); // 在 nginx 后面，取真实访客 IP
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

app.get('/api/health', (_req, res) => res.json({ ok: true, llm: !!process.env.LLM_API_KEY, resend: !!process.env.RESEND_API_KEY, db: dbEnabled() }));

app.get('/api/exercises', (_req, res) => res.json(EXERCISES));

// ---------- 登录 / 注册 ----------
app.post('/api/auth/code', async (req, res) => {
  try {
    if (!dbEnabled()) return res.status(503).json({ error: '服务器未配置数据库，登录暂不可用' });
    const email = String(req.body?.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: '邮箱格式不正确' });
    await sendLoginCode(email);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// 注册：验证码验证身份 + 设置密码 + 昵称
app.post('/api/auth/register', async (req, res) => {
  try {
    if (!dbEnabled()) return res.status(503).json({ error: '服务器未配置数据库，注册暂不可用' });
    const { email = '', code = '', password = '', nickname = '' } = req.body || {};
    const result = await register(String(email).trim(), String(code).trim(), String(password), String(nickname).trim());
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// 登录：邮箱 + 密码
app.post('/api/auth/login', async (req, res) => {
  try {
    if (!dbEnabled()) return res.status(503).json({ error: '服务器未配置数据库，登录暂不可用' });
    const { email = '', password = '' } = req.body || {};
    const result = await loginWithPassword(String(email).trim(), String(password));
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const m = (req.headers.authorization || '').match(/^Bearer (\S+)$/);
  if (m && dbEnabled()) await logout(m[1]).catch(() => {});
  res.json({ ok: true });
});

// ---------- 我的 ----------
app.get('/api/me', async (req, res) => {
  if (!dbEnabled()) return res.json({ user: null });
  const user = await resolveUser(req).catch(() => null);
  res.json({ user });
});

app.get('/api/me/plans', async (req, res) => {
  const user = dbEnabled() ? await resolveUser(req).catch(() => null) : null;
  if (!user) return res.status(401).json({ error: '请先登录' });
  res.json({ plans: await listPlans(user.id) });
});

app.get('/api/me/plans/:id', async (req, res) => {
  const user = dbEnabled() ? await resolveUser(req).catch(() => null) : null;
  if (!user) return res.status(401).json({ error: '请先登录' });
  const row = await getPlan(user.id, Number(req.params.id));
  if (!row) return res.status(404).json({ error: '计划不存在' });
  res.json({ plan: row.plan, source: row.source });
});

app.post('/api/plan', async (req, res) => {
  try {
    const profile = req.body || {};
    if (!profile.goal) return res.status(400).json({ error: '缺少训练目标' });
    const user = dbEnabled() ? await resolveUser(req).catch(() => null) : null;
    if (!user && dbEnabled()) {
      const ok = await guestTryUse(req.ip);
      if (!ok) return res.status(403).json({ error: '游客体验次数已用完，登录后可无限生成并保存计划', needLogin: true });
    }
    const result = await generatePlan(profile);
    if (user) await savePlan(user.id, profile, result.plan, result.source).catch((e) => console.error('[savePlan]', e));
    res.json({ ...result, saved: !!user });
  } catch (err) {
    console.error('[plan]', err);
    res.status(500).json({ error: '计划生成失败，请稍后再试' });
  }
});

// SSE 流式版：实时推送生成进度，避免用户面对死等的转圈
app.post('/api/plan/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const hb = setInterval(() => res.write(': hb\n\n'), 10_000); // 心跳防中间设备断连
  try {
    const profile = req.body || {};
    if (!profile.goal) {
      send('error', { error: '缺少训练目标' });
      return;
    }
    const user = dbEnabled() ? await resolveUser(req).catch(() => null) : null;
    if (!user && dbEnabled()) {
      const ok = await guestTryUse(req.ip);
      if (!ok) {
        send('error', { error: '游客体验次数已用完，登录后可无限生成并保存计划', needLogin: true });
        return;
      }
      send('stage', { text: '游客模式：本次计划不会被保存，登录可保存历史' });
    }
    send('stage', { text: '档案已收到，正在筛选适合你器械的动作库…' });
    const result = await generatePlan(profile, (text) => send('stage', { text }));
    if (user) await savePlan(user.id, profile, result.plan, result.source).catch((e) => console.error('[savePlan]', e));
    send('result', { ...result, saved: !!user });
  } catch (err) {
    console.error('[plan/stream]', err);
    send('error', { error: '计划生成失败，请稍后再试' });
  } finally {
    clearInterval(hb);
    res.end();
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
  initDb().catch((e) => console.error('[db] 初始化失败：', e.message));
});
