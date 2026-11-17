# 部署

公网只走 80（有证书后走 443）。应用容器不映射 3000。容器名是 `deepread`，周五的定时任务用 `docker exec deepread` 进容器跑脚本。脚本打在镜像里，改脚本要重新部署。

数据库在仓库的 `data/deepread.db`，挂进容器的 `/app/data`。服务器上把仓库放在 `/opt/deepread`，这样路径和现在的数据目录一致。

## 第一次切换

在服务器上：

```bash
cd /opt/deepread
git pull
cp .env.example .env          # 还没有 .env 时。填入密钥
# SITE_URL=http://124.220.163.131    不要带 :3000
# 授权码里如果有 $，写成 $$
sudo bash ops/deploy.sh
```

`deploy.sh` 会：内存不足时加 2G swap、拉代码、构建镜像，构建完成后再停掉以前 `docker run` 的旧容器，然后用 compose 启动应用和 nginx。

然后做两件手工的事：

1. 腾讯云安全组只留 **22、80、443**，关掉 **3000**。
2. 把 crontab 换成仓库里的脚本（**先删掉旧的那行 `/opt/deepread/deploy/run-daily.sh`，否则周五会跑两次**）：

```
0 19 * * 5 /opt/deepread/ops/run-weekly.sh >> /var/log/deepread.log 2>&1
```

如果 80 端口被宿主机 nginx 占着，部署脚本会停下来。执行 `sudo systemctl disable --now nginx` 后再跑一次。

## 以后每次发布

```bash
cd /opt/deepread
sudo bash ops/deploy.sh
```

## 证书

备案通过、域名解析到这台机器之后：

```bash
sudo apt-get install -y certbot
sudo certbot certonly --webroot -w /opt/deepread/ops/certbot \
  -d 你的域名 --email 你的邮箱 --agree-tos --no-eff-email
sudo cp /etc/letsencrypt/live/你的域名/fullchain.pem /opt/deepread/ops/certs/
sudo cp /etc/letsencrypt/live/你的域名/privkey.pem /opt/deepread/ops/certs/
```

把 `.env` 里的 `SITE_URL` 改成 `https://你的域名`，再跑一次 `sudo bash ops/deploy.sh`。脚本看到 `ops/certs/` 里的两个 pem 就会换成 HTTPS，80 会跳转到 443。

## 备份

周五流水线最后一步会调用 `ops/backup.sh`，在容器里执行 `VACUUM INTO`，保留最近 8 份，文件在 `data/backups/`。

这份备份和数据库在同一块磁盘上。要再拷到别的机器，在 `.env` 里加：

```
BACKUP_RSYNC_DEST=user@另一台机器:/var/backups/deepread
```

手动备份：`bash ops/backup.sh`

## 常用命令

```bash
docker compose ps
docker compose logs -f app
sudo tail -50 /var/log/deepread.log
sudo bash /opt/deepread/ops/run-weekly.sh
docker exec deepread npm run stats
```
