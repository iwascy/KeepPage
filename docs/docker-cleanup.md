# Jenkins 部署后 Docker 占用空间清理指南

## 背景

Jenkins 主机的根分区不断被 `docker` 数据挤满，`/var/lib/docker/overlay2` 单独占到 40G 以上，而 Jenkins 自身挂载在 `/opt/jenkins/jenkins_home` 的数据量只有数百 MB。排查发现：

- `/usr/local/bin/keeppage-deploy.sh` 每次执行 `docker compose ... up -d --build --remove-orphans`，但没有清理旧镜像与 build cache。
- `/usr/local/bin/telegram-saver-backend-deploy.sh` 在 ARM 机器上每次执行 `docker build -t telegram-saver/backend:local-arm64 ...`，同样没有清理 dangling image、builder cache。

因此随着部署次数增长，大量 `<none>` 标签的镜像层与 builder cache 长期堆积，最终把 `/var/lib/docker` 撑满。

## 目录结构

```
ops/
  jenkins/
    docker-cleanup.sh   # 借助此脚本统一封装清理逻辑
```

## docker-cleanup.sh 说明

`ops/jenkins/docker-cleanup.sh` 被设计为一个可被 `source` 的库脚本，提供以下函数：

- `docker_cleanup_report_disk_usage <stage>`：打印 `docker system df` 结果，方便观测清理前后变化。
- `docker_cleanup_prune_dangling_images [max_age]`：仅删除 dangling 镜像（默认 72 小时以前）。
- `docker_cleanup_prune_builder_cache [max_age] [keep_storage_MB]`：清理 builder cache，默认只动 168 小时以前的缓存。如需限制最少保留的缓存体积，可通过 `DOCKER_CLEANUP_KEEP_STORAGE` 环境变量或第二个参数来设置。
- `docker_cleanup_trim_repo_history "repo_a:2 repo_b:3"`：确保指定仓库只保留最近 N 个 tag。
- `docker_cleanup_run_suite <image_max_age> <builder_max_age> <repo_spec>`：按照上述顺序一次性完成常规清理，并输出前后 `docker system df`。

## 部署脚本修改示例

以下示例假设 `ops` 目录被同步到远程 `/opt/keeppage`，根据实际路径调整 `source` 指令即可。

### keeppage-deploy.sh

```bash
#!/usr/bin/env bash
set -euo pipefail

source /opt/keeppage/ops/jenkins/docker-cleanup.sh

docker compose -f /opt/keeppage/deploy/docker-compose.yml \
  --project-directory /opt/keeppage/deploy \
  up -d --build --remove-orphans

# 清理 72 小时前的 dangling 镜像和 168 小时前的 builder cache，
# Keeppage repo 镜像保留最近 2 个 tag，web 镜像保留 3 个。
docker_cleanup_run_suite "72h" "168h" "keeppage/api:2 keeppage/web:3"
```

### telegram-saver-backend-deploy.sh

```bash
#!/usr/bin/env bash
set -euo pipefail

source /opt/keeppage/ops/jenkins/docker-cleanup.sh

docker build -t telegram-saver/backend:local-arm64 \
  -f /opt/telegram-saver/backend/Dockerfile.arm64 \
  /opt/telegram-saver/backend

docker compose -f /opt/telegram-saver/docker-compose.yml up -d telegram-backend

# 清理 24 小时前的 dangling 镜像层，builder cache 保留 72 小时内的数据；
# backend 仓库只保留最近 2 个 tag。
docker_cleanup_run_suite "24h" "72h" "telegram-saver/backend:2"
```

> `docker_cleanup_run_suite` 内部默认只操作 dangling 镜像层以及超过时间窗口的 builder cache，不会删除仍被 tag 引用的镜像。若需要更激进的策略（例如全量 `docker system prune`），请在调用脚本的上层另行实现。

## 落地步骤

1. 将 `ops/jenkins/docker-cleanup.sh` 同步到 Jenkins 主机（例如 `/opt/keeppage/ops/jenkins/docker-cleanup.sh`），并确保拥有执行权限：
   ```bash
   install -m 0755 ops/jenkins/docker-cleanup.sh /opt/keeppage/ops/jenkins/docker-cleanup.sh
   ```
2. 修改 `/usr/local/bin/keeppage-deploy.sh` 与 `/usr/local/bin/telegram-saver-backend-deploy.sh`，在部署成功后调用 `docker_cleanup_run_suite`。别忘了在脚本顶部 `source` 此文件。
3. 重新执行两条部署任务，观察 Jenkins 控制台日志是否输出 `docker system df (before/after)` 的统计。
4. 定期（例如每周）检查 `/var/lib/docker` 的体积，确保新增策略已生效。

## 常见调整点

- 若磁盘仍然吃紧，可将 `DOCKER_CLEANUP_KEEP_STORAGE` 环境变量设为一个较小值（例如 `500`，单位 MB），让 BuildKit 至少释放到指定阈值。
- 如果某些 Job 需要保留更多历史镜像，把 `repo_spec` 中的数字调大即可，例如 `keeppage/web:5`。
- 发生大版本升级且需要暂时保留所有旧镜像时，可跳过脚本末尾的 `docker_cleanup_run_suite`，或把 `max_age` 设置得更大。
