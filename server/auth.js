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

export async function verifyLoginCode(email, code) {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT id FROM login_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1',
    [email, code]
  );
  if (rows.length === 0) throw new Error('验证码错误或已过期');
  await pool.query('UPDATE login_codes SET used = 1 WHERE id = ?', [rows[0].id]);

  // 找或建用户
  const [users] = await pool.query('SELECT id, email, nickname FROM users WHERE email = ?', [email]);
  let user = users[0];
  if (!user) {
    const [r] = await pool.query('INSERT INTO users (email, last_login_at) VALUES (?, NOW())', [email]);
    user = { id: r.insertId, email, nickname: '' };
  } else {
    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
  }

  const token = crypto.randomUUID();
  await pool.query(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))',
    [token, user.id, SESSION_TTL_DAYS]
  );
  return { token, user };
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
