// Express 应用：登录 / 仪表盘 / 个人信息 / 账号安全 / 工作经历
// 本地与 Vercel Serverless 共用，不含 listen，方便两端复用
const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const config = require('./config');
const db = require('./db');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// 会话用签名 Cookie 保存，天然适配 Serverless（无需服务端内存存储）
app.use(cookieSession({
  name: 'pa_session',
  keys: [config.sessionSecret],
  maxAge: 2 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax'
}));

// 上传配置：头像直接存数据库，仅图片，最大 2MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allow = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allow.includes(file.mimetype)) return cb(new Error('只支持 jpg / png / webp 图片'));
    cb(null, true);
  }
});

// 每个请求前确保数据库已初始化（幂等）
app.use(async (req, res, next) => {
  try {
    await db.init();
    next();
  } catch (err) {
    console.error('数据库初始化失败：', err.message);
    next(err);
  }
});

// ===== 工具函数 =====
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function setFlash(req, type, text) {
  req.session.flash = { type, text };
}

function takeFlash(req) {
  const f = req.session.flash || null;
  delete req.session.flash;
  return f;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function loadProfile(userId) {
  const pool = db.getPool();
  const [rows] = await pool.query('SELECT * FROM profiles WHERE user_id = ?', [userId]);
  return rows[0] || {};
}

// ===== 登录 / 退出 =====
app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('login', { flash: takeFlash(req) });
});

app.post('/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!username || !password) {
    setFlash(req, 'error', '请输入用户名和密码');
    return res.redirect('/login');
  }
  const pool = db.getPool();
  const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    setFlash(req, 'error', '用户名或密码不正确');
    return res.redirect('/login');
  }
  req.session.userId = user.id;
  res.redirect('/dashboard');
});

app.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

// ===== 仪表盘 =====
app.get('/', (req, res) => res.redirect('/dashboard'));

app.get('/dashboard', requireLogin, async (req, res) => {
  const pool = db.getPool();
  const [userRows] = await pool.query('SELECT username, created_at FROM users WHERE id = ?', [req.session.userId]);
  const [expRows] = await pool.query('SELECT * FROM experiences WHERE user_id = ? ORDER BY id DESC', [req.session.userId]);
  const profile = await loadProfile(req.session.userId);
  res.render('dashboard', {
    page: 'dashboard',
    profile,
    user: userRows[0],
    expCount: expRows.length,
    flash: takeFlash(req)
  });
});

// ===== 个人信息 =====
app.get('/profile', requireLogin, async (req, res) => {
  const pool = db.getPool();
  const [expRows] = await pool.query('SELECT * FROM experiences WHERE user_id = ? ORDER BY id DESC', [req.session.userId]);
  res.render('profile', {
    page: 'profile',
    profile: await loadProfile(req.session.userId),
    experiences: expRows,
    flash: takeFlash(req)
  });
});

app.post('/profile', requireLogin, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const position = String(req.body.position || '').trim();
  const tagline = String(req.body.tagline || '').trim();
  const email = String(req.body.email || '').trim();
  const region = String(req.body.region || '').trim();
  const resumePath = String(req.body.resume_path || '').trim();
  const bio = String(req.body.bio || '').trim();

  if (!name) {
    setFlash(req, 'error', '姓名不能为空');
    return res.redirect('/profile');
  }
  if (!EMAIL_RE.test(email)) {
    setFlash(req, 'error', '邮箱格式不正确');
    return res.redirect('/profile');
  }

  const pool = db.getPool();
  await pool.query(
    `UPDATE profiles SET name = ?, position = ?, tagline = ?, email = ?, region = ?,
       resume_path = ?, bio = ?, updated_at = NOW() WHERE user_id = ?`,
    [name, position, tagline, email, region, resumePath, bio, req.session.userId]
  );
  setFlash(req, 'success', '个人信息已保存');
  res.redirect('/profile');
});

// 头像上传：仅存数据库（avatar_data + avatar_mime）
app.post('/profile/avatar', requireLogin, (req, res) => {
  upload.single('avatar')(req, res, async (err) => {
    if (err) {
      setFlash(req, 'error', err.message === 'File too large' ? '图片不能超过 2MB' : err.message);
      return res.redirect('/profile');
    }
    if (!req.file) {
      setFlash(req, 'error', '请选择要上传的图片');
      return res.redirect('/profile');
    }
    const pool = db.getPool();
    await pool.query('UPDATE profiles SET avatar_data = ?, avatar_mime = ?, updated_at = NOW() WHERE user_id = ?',
      [req.file.buffer, req.file.mimetype, req.session.userId]);
    setFlash(req, 'success', '头像已更新');
    res.redirect('/profile');
  });
});

// 头像读取：从数据库取出二进制直接输出
app.get('/avatar', requireLogin, async (req, res) => {
  const pool = db.getPool();
  const [rows] = await pool.query('SELECT avatar_data, avatar_mime FROM profiles WHERE user_id = ?', [req.session.userId]);
  if (!rows[0] || !rows[0].avatar_data) return res.status(404).end();
  res.set('Content-Type', rows[0].avatar_mime || 'image/png');
  res.set('Cache-Control', 'no-store');
  res.end(rows[0].avatar_data);
});

// ===== 账号安全：修改密码 =====
app.get('/password', requireLogin, (req, res) => {
  res.render('password', { page: 'password', flash: takeFlash(req) });
});

app.post('/password', requireLogin, async (req, res) => {
  const oldPassword = String(req.body.old_password || '');
  const newPassword = String(req.body.new_password || '');
  const confirmPassword = String(req.body.confirm_password || '');

  if (!oldPassword || !newPassword) {
    setFlash(req, 'error', '请填写原密码和新密码');
    return res.redirect('/password');
  }
  if (newPassword.length < 8) {
    setFlash(req, 'error', '新密码至少 8 位');
    return res.redirect('/password');
  }
  if (newPassword !== confirmPassword) {
    setFlash(req, 'error', '两次输入的新密码不一致');
    return res.redirect('/password');
  }
  if (newPassword === oldPassword) {
    setFlash(req, 'error', '新密码不能与原密码相同');
    return res.redirect('/password');
  }

  const pool = db.getPool();
  const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.session.userId]);
  if (!rows[0] || !(await bcrypt.compare(oldPassword, rows[0].password_hash))) {
    setFlash(req, 'error', '原密码不正确');
    return res.redirect('/password');
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?',
    [newHash, req.session.userId]);
  setFlash(req, 'success', '密码已修改，下次请用新密码登录');
  res.redirect('/password');
});

// ===== 工作经历：新增 / 删除 =====
app.post('/experiences', requireLogin, async (req, res) => {
  const company = String(req.body.company || '').trim();
  const role = String(req.body.role || '').trim();
  const period = String(req.body.period || '').trim();
  const description = String(req.body.description || '').trim();

  if (!company) {
    setFlash(req, 'error', '公司 / 组织名称不能为空');
    return res.redirect('/profile');
  }
  const pool = db.getPool();
  await pool.query(
    'INSERT INTO experiences (user_id, company, role, period, description) VALUES (?, ?, ?, ?, ?)',
    [req.session.userId, company, role, period, description]
  );
  setFlash(req, 'success', '工作经历已添加');
  res.redirect('/profile');
});

app.post('/experiences/:id/delete', requireLogin, async (req, res) => {
  const pool = db.getPool();
  await pool.query('DELETE FROM experiences WHERE id = ? AND user_id = ?',
    [req.params.id, req.session.userId]);
  setFlash(req, 'success', '已删除该条经历');
  res.redirect('/profile');
});

// 统一错误处理
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('服务器错误：' + err.message);
});

module.exports = app;
