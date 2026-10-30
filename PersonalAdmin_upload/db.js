// MySQL 连接池 + 自动建库建表 + 初始化管理员（支持本地 MySQL 与 TiDB Cloud 等云库）
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const config = require('./config');
const CA_PEM = require('./certs');

let pool = null;
let initPromise = null;

// 组装连接参数：云数据库加 SSL 与公共 CA
function connOptions(withDatabase) {
  const opts = {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    connectTimeout: 20000,
    multipleStatements: false
  };
  if (withDatabase) opts.database = config.db.database;
  if (config.db.ssl) opts.ssl = { ca: CA_PEM, rejectUnauthorized: true };
  return opts;
}

async function ensureDatabase() {
  const conn = await mysql.createConnection(connOptions(false));
  try {
    await conn.query(
      'CREATE DATABASE IF NOT EXISTS `' + config.db.database + '` DEFAULT CHARACTER SET utf8mb4'
    );
  } finally {
    await conn.end();
  }
}

async function ensureTables(poolInstance) {
  await poolInstance.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await poolInstance.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      user_id INT PRIMARY KEY,
      name VARCHAR(50) NOT NULL DEFAULT '',
      position VARCHAR(50) NOT NULL DEFAULT '',
      tagline VARCHAR(200) NOT NULL DEFAULT '',
      email VARCHAR(100) NOT NULL DEFAULT '',
      region VARCHAR(50) NOT NULL DEFAULT '',
      resume_path VARCHAR(200) NOT NULL DEFAULT '',
      bio TEXT,
      avatar_data MEDIUMBLOB NULL,
      avatar_mime VARCHAR(50) NOT NULL DEFAULT '',
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await poolInstance.query(`
    CREATE TABLE IF NOT EXISTS experiences (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      company VARCHAR(100) NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT '',
      period VARCHAR(50) NOT NULL DEFAULT '',
      description TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_exp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

// 初始化管理员：优先用 ADMIN_INIT_PASSWORD，未设置则随机生成并打印
async function ensureAdmin(poolInstance) {
  const [rows] = await poolInstance.query('SELECT id FROM users LIMIT 1');
  if (rows.length > 0) return;

  const initPassword = config.initAdminPassword || crypto.randomBytes(9).toString('base64url');
  const hash = await bcrypt.hash(initPassword, 10);
  const [result] = await poolInstance.query(
    'INSERT INTO users (username, password_hash) VALUES (?, ?)',
    [config.initAdminUsername, hash]
  );
  await poolInstance.query('INSERT INTO profiles (user_id) VALUES (?)', [result.insertId]);
  console.log('=== 初始管理员账号已创建 ===');
  console.log('用户名：' + config.initAdminUsername);
  if (!config.initAdminPassword) console.log('密码：' + initPassword + '（只打印这一次）');
  console.log('请登录后到“账号安全”页面修改密码。');
}

// 幂等初始化：Serverless 冷启动会重复调用，用缓存 Promise 保证只执行一次
function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await ensureDatabase();
    pool = mysql.createPool({
      ...connOptions(true),
      waitForConnections: true,
      connectionLimit: 2,
      maxIdle: 2,
      idleTimeout: 60000,
      charset: 'utf8mb4'
    });
    await ensureTables(pool);
    await ensureAdmin(pool);
    return pool;
  })().catch((err) => {
    initPromise = null;
    throw err;
  });
  return initPromise;
}

function getPool() {
  if (!pool) throw new Error('数据库尚未初始化');
  return pool;
}

module.exports = { init, getPool };
