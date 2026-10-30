// 配置：全部通过环境变量注入，代码里不写任何账号密码
module.exports = {
  port: Number(process.env.PORT || 3000),
  sessionSecret: process.env.SESSION_SECRET || 'personal-admin-dev-secret',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'personal_admin',
    // 云数据库（TiDB / 云 MySQL）需要 TLS，本地 MySQL 不需要
    ssl: process.env.DB_SSL === 'true'
  },
  // 首次启动时若 users 表为空，用此密码创建管理员；未设置则随机生成并打印在日志
  initAdminUsername: process.env.ADMIN_USERNAME || 'admin',
  initAdminPassword: process.env.ADMIN_INIT_PASSWORD || ''
};
