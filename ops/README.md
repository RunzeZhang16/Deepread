# ops —— 部署相关

服务器上实际使用的文件。改这里 = 改线上（重新部署后生效）。

## run-weekly.sh

每周五 19:00 出刊流水线，服务器上的路径：

```
/opt/deepread/deploy/run-daily.sh
```

**注意**：服务器上文件名还是 `run-daily.sh`，仓库里改叫 `run-weekly.sh`（周更后更准确）。
更新时执行：

```bash
scp ops/run-weekly.sh ubuntu@124.220.163.131:/tmp/run.sh
ssh ubuntu@124.220.163.131 'sudo cp /tmp/run.sh /opt/deepread/deploy/run-daily.sh && sudo chmod +x /opt/deepread/deploy/run-daily.sh'
```

crontab：

```
0 19 * * 5 /opt/deepread/deploy/run-daily.sh >> /var/log/deepread.log 2>&1
```

设计原则：每一步用 `run()` 包装，**单步失败不中断后续**（尤其不能拖垮出刊和发信）。

## nginx.conf

买了域名之后用。反向代理 80 → 容器 3000 端口，并开启 gzip。
启用步骤：

```bash
sudo cp ops/nginx.conf /etc/nginx/sites-available/deepread
sudo ln -sf /etc/nginx/sites-available/deepread /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

之后用 certbot 上 HTTPS。

## 常用运维命令

```bash
# 看日志
sudo tail -50 /var/log/deepread.log

# 手动跑一次出刊
sudo bash /opt/deepread/deploy/run-daily.sh

# 重启容器
sudo docker restart deepread

# 备份数据库（必须用 VACUUM INTO，不能直接 cp）
sudo docker exec deepread node -e "const D=require('better-sqlite3');new D('/app/data/deepread.db').exec(\"VACUUM INTO '/app/data/backup.db'\")"
```
