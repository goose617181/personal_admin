// 本地启动入口：先初始化数据库，再监听端口
const config = require('./config');
const app = require('./app');
const db = require('./db');

db.init()
  .then(() => {
    app.listen(config.port, () => {
      console.log('管理后台已启动：http://localhost:' + config.port + '/login');
    });
  })
  .catch((err) => {
    console.error('数据库初始化失败：', err.message);
    console.error('请检查 DB_HOST / DB_USER / DB_PASSWORD / DB_SSL 等环境变量。');
    process.exit(1);
  });
