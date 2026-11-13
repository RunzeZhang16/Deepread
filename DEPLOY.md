# 部署给朋友看（Vercel，免费）

目标：朋友打开一个 https 链接就能看，不用你的电脑开着。

## 一、先在本机准备

```bash
# 1. 安装 Vercel CLI（只需一次）
npm i -g vercel

# 2. 登录（会打开浏览器）
cd /Users/zhangrunze/Documents/vibe_coding/deep_read
vercel login
```

## 二、设置两个环境变量

```bash
vercel env add DEEPSEEK_API_KEY production
# 粘贴你的 sk-...
vercel env add READONLY production
# 输入 1
```

`READONLY=1` 会关掉添加、删除、改分类、重新生成，只保留「看」和「问」。

## 三、部署

```bash
vercel --prod
```

第一次会问几个问题，一路回车即可（项目名、目录、框架自动识别）。

完成后会给你一个 `https://xxx.vercel.app` 的链接，直接发给朋友。

## 四、以后更新文章

```bash
# 本机加完文章后
vercel --prod
```

线上数据是**部署时的快照**，本地改了要重新部署才会生效。

## 已知限制

| 项 | 说明 |
|---|---|
| 国内访问 | 时快时慢，一般能打开 |
| 微信内打开 | 通常可以，偶有「非官方网页」提示 |
| 添加文章 | 线上不能加，只有你本机能加 |
| 对话 | 消耗你的 DeepSeek 额度，按次计费，一轮约 1 分钱 |
| 数据 | 只在部署包里，Vercel 运行时不可写 |

## 备选：临时隧道（不推荐）

cloudflared / ngrok 可以让本机服务临时暴露到公网，但：

- 你的 Mac 必须开着且不休眠
- 链接每次重启都会变
- 进程一断，朋友就打不开

只适合临时演示，不适合「发给朋友慢慢看」。
