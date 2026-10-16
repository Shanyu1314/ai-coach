// 邮箱验证码登录：免密码体系，复用 Resend 发信通道
import crypto from 'node:crypto';
import { getPool } from './db.js';
import { sendCodeEmail } from './email.js';

const CODE_TTL_MIN = 10; // 验证码 10 分钟有效
const SESSION_TTL_DAYS = 30; // 登录态 30 天

// 每邮箱每分钟最多发 1 次验证码（内存限流即可，重启清零无所谓）
const sendBuckets = new Map();

export async function sendLoginCode(email) {
  const now = Date.now();
  const b = sendBuckets.get(email) || 0;
  if (now - b < 60_000) throw new Error('验证码已发送，请 1 分钟后再试');
  sendBuckets.set(email, now);

  const code = String(crypto.randomInt(100000, 999999));
  const pool = getPool();
  await pool.query(
    'INSERT INTO login_codes (email, code, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))',
    [email, code, CODE_TTL_MIN]
  );
  await sendCodeEmail(email, code, CODE_TTL_MIN);
}

// 密码散列：scrypt（Node 内置，无需额外依赖）
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function checkPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

// 注册专用：校验验证码并焚毁，成功返回 true（不建用户，由注册接口建）
async function consumeCode(email, code) {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT id FROM login_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1',
    [email, code]
  );
  if (rows.length === 0) throw new Error('验证码错误或已过期');
  await pool.query('UPDATE login_codes SET used = 1 WHERE id = ?', [rows[0].id]);
}

async function createSession(userId) {
  const token = crypto.randomUUID();
  const pool = getPool();
  await pool.query(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))',
    [token, userId, SESSION_TTL_DAYS]
  );
  return token;
}

// 注册：邮箱验证码验证身份 + 设置密码 + 昵称
export async function register(email, code, password, nickname) {
  if (String(password).length < 6) throw new Error('密码至少 6 位');
  const pool = getPool();
  const [exists] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if (exists.length > 0) throw new Error('该邮箱已注册，请直接登录');
  await consumeCode(email, code);
  const [r] = await pool.query(
    'INSERT INTO users (email, nickname, password_hash, last_login_at) VALUES (?, ?, ?, NOW())',
    [email, String(nickname || '').slice(0, 20), hashPassword(password)]
  );
  const token = await createSession(r.insertId);
  return { token, user: { id: r.insertId, email, nickname: nickname || '' } };
}

// 登录：邮箱 + 密码
export async function loginWithPassword(email, password) {
  const pool = getPool();
  const [users] = await pool.query('SELECT id, email, nickname, password_hash FROM users WHERE email = ?', [email]);
  const user = users[0];
  if (!user || !checkPassword(password, user.password_hash)) throw new Error('邮箱或密码不正确');
  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
  const token = await createSession(user.id);
  return { token, user: { id: user.id, email: user.email, nickname: user.nickname } };
}

// 从请求头解析登录态；返回 null 表示游客
export async function resolveUser(req) {
  const m = (req.headers.authorization || '').match(/^Bearer ([0-9a-f-]{36})$/i);
  if (!m) return null;
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT u.id, u.email, u.nickname FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > NOW()`,
    [m[1]]
  );
  return rows[0] || null;
}

export async function logout(token) {
  const pool = getPool();
  await pool.query('DELETE FROM sessions WHERE token = ?', [token]);
}

// 游客闸门：每 IP 免费体验 1 次；返回 true 表示放行
export async function guestTryUse(ip) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT uses FROM guest_usage WHERE ip = ?', [ip]);
  if (rows.length > 0 && rows[0].uses >= 1) return false;
  await pool.query(
    'INSERT INTO guest_usage (ip, uses) VALUES (?, 1) ON DUPLICATE KEY UPDATE uses = uses + 1',
    [ip]
  );
  return true;
}

export async function savePlan(userId, profile, plan, source) {
  const pool = getPool();
  await pool.query('INSERT INTO plans (user_id, title, profile, plan, source) VALUES (?, ?, ?, ?, ?)', [
    userId, plan.title || '', JSON.stringify(profile), JSON.stringify(plan), source,
  ]);
  // 顺手把最新档案存到用户身上，下次登录自动回填
  await pool.query('UPDATE users SET profile = ?, nickname = COALESCE(NULLIF(?, ""), nickname) WHERE id = ?', [
    JSON.stringify(profile), profile.nickname || '', userId,
  ]);
}

export async function listPlans(userId) {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT id, title, source, created_at FROM plans WHERE user_id = ? ORDER BY id DESC LIMIT 50',
    [userId]
  );
  return rows;
}

export async function getPlan(userId, planId) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT plan, source FROM plans WHERE id = ? AND user_id = ?', [planId, userId]);
  return rows[0] || null;
}
