// MySQL 数据层：不配 MYSQL_URL 时整体降级（游客模式照常，登录接口返回 503）
import mysql from 'mysql2/promise';

let pool = null;

export function dbEnabled() {
  return !!process.env.MYSQL_URL;
}

export function getPool() {
  if (!pool) {
    if (!dbEnabled()) throw new Error('未配置 MYSQL_URL');
    pool = mysql.createPool({
      uri: process.env.MYSQL_URL,
      connectionLimit: 5,
      charset: 'utf8mb4',
      namedPlaceholders: true,
    });
  }
  return pool;
}

// 启动时建表（IF NOT EXISTS，幂等）
export async function initDb() {
  if (!dbEnabled()) {
    console.log('[db] 未配置 MYSQL_URL，用户体系停用（游客模式不受影响）');
    return;
  }
  const p = getPool();
  await p.query(`CREATE TABLE IF NOT EXISTS users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(190) UNIQUE NOT NULL,
    nickname VARCHAR(50) DEFAULT '',
    profile JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await p.query(`CREATE TABLE IF NOT EXISTS login_codes (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(190) NOT NULL,
    code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used TINYINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email (email)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await p.query(`CREATE TABLE IF NOT EXISTS sessions (
    token CHAR(36) PRIMARY KEY,
    user_id BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    INDEX idx_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await p.query(`CREATE TABLE IF NOT EXISTS plans (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    title VARCHAR(120),
    profile JSON,
    plan JSON,
    source VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // 游客只记 IP 和使用次数，不存任何档案/计划数据
  await p.query(`CREATE TABLE IF NOT EXISTS guest_usage (
    ip VARCHAR(45) PRIMARY KEY,
    uses INT DEFAULT 0,
    last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  console.log('[db] MySQL 已连接，表结构就绪');
}
