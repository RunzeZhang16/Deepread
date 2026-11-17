# 从 docker run 迁移到 docker compose

一次性操作。做完之后，发布统一走 `sudo bash ops/deploy.sh`。

## 前置检查

```bash
docker compose version          # 没有就 apt-get install -y docker-compose-v2
sudo ss -ltn | grep -E ':(80|443) '   # 应该没有输出
```

## 一、把 /opt/deepread 变成 git 仓库

现有目录是 tar 包铺开的，没有 `.git`。用 `git init` + `reset --hard` 接管，
`.env`、`data/*.db`、`ops/certs` 都在 `.gitignore` 里，不会被覆盖。

```bash
cd /opt/deepread
sudo git init -q
sudo git remote add origin https://github.com/RunzeZhang16/Deepread.git
sudo git fetch --depth 1 origin main
sudo git reset --hard origin/main
sudo git branch --set-upstream-to=origin/main main
```

如果服务器拉 GitHub 太慢/失败，从本地推过去：

```bash
# 本地
git push ssh://ubuntu@124.220.163.131/opt/deepread main
# 或在本地打包后 scp，再在服务器上 git clone --local
```

校验：

```bash
ls ops/            # 应该有 deploy.sh backup.sh run-weekly.sh
git status -s      # 只应看到被忽略的文件，不该有改动
```

## 二、停掉旧容器（保留数据库）

```bash
sudo docker stop deepread
sudo docker rename deepread deepread-old
```

旧容器先别删，留作回滚。

## 三、部署

```bash
cd /opt/deepread
sudo bash ops/deploy.sh
```

脚本会：构建镜像 → 生成 `ops/nginx.active.conf` → 停掉旧容器 → `docker compose up -d`。

## 四、换 crontab（**必须删掉旧行**）

```bash
sudo crontab -e
```

删掉旧的：

```
0 19 * * 5 /opt/deepread/deploy/run-daily.sh >> /var/log/deepread.log 2>&1
```

换成：

```
0 19 * * 5 /opt/deepread/ops/run-weekly.sh >> /var/log/deepread.log 2>&1
```

**不删旧行会导致周五跑两次**，第二次会重建当期内容、重复发信。

## 五、腾讯云安全组

只留 **22、80、443**，关掉 **3000**。

## 六、验收

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://124.220.163.131/
sudo docker compose ps                  # app 应该是 healthy
sudo docker exec deepread npm run stats # 脚本能跑
sudo bash /opt/deepread/ops/backup.sh   # 备份能生成
crontab -l | grep run-weekly
```

`.env` 里 `SITE_URL` 必须是不带端口的 `http://124.220.163.131`。

## 回滚

```bash
cd /opt/deepread
sudo docker compose down
sudo docker rename deepread-old deepread
sudo docker start deepread
sudo crontab -e   # 换回旧路径
```

数据一直在 `data/deepread.db`，两个容器共用，回滚不丢内容。
