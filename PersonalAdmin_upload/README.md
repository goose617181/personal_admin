# Personal Admin（个人管理后台）

登录、个人信息、头像上传、修改密码、工作经历管理的轻量后台。Node.js + Express + MySQL（本地 MySQL 或 TiDB Cloud 均可）。

## 本地运行

```powershell
setx DB_PASSWORD 617181     # 只需设置一次
cd D:\PersonalAdmin
npm start
```

访问 http://localhost:3000/login

## 环境变量

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| DB_HOST | 数据库地址 | 127.0.0.1 |
| DB_PORT | 端口 | 3306 |
| DB_USER | 用户名 | root |
| DB_PASSWORD | 密码 | 空 |
| DB_NAME | 库名（不存在会自动创建） | personal_admin |
| DB_SSL | 云数据库需设为 true | false |
| SESSION_SECRET | 会话签名密钥 | dev 默认值 |
| ADMIN_USERNAME | 初始管理员用户名 | admin |
| ADMIN_INIT_PASSWORD | 初始管理员密码 | 随机生成并打印 |

## 部署到 Vercel

1. 把本目录推到 GitHub 仓库
2. Vercel → Add New → Project → 选仓库 → 在 Environment Variables 填入上表（DB_SSL=true）
3. Deploy，访问 Vercel 给出的域名

头像以 MEDIUMBLOB 存库，会话用签名 Cookie（`cookie-session`），无需外部 Redis。

## 表结构

- `users`：登录账号（bcrypt 哈希密码）
- `profiles`：姓名 / 职位 / 介绍 / 邮箱 / 地区 / 简历路径 / 简介 / 头像二进制
- `experiences`：工作经历

服务启动会自动建库建表并初始化管理员。
