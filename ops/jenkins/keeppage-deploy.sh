#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/data/apps/keeppage
REPO_DIR=$APP_DIR/repo
ENV_FILE=$APP_DIR/shared/configs/keeppage.env
DEPLOY_FILE=$REPO_DIR/deploy/docker-compose.yml
CLEANUP_LIB=$REPO_DIR/ops/jenkins/docker-cleanup.sh

export GIT_SSH_COMMAND="ssh -i /root/.ssh/github_pull_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

verify_upload_route() {
  local status
  status=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT \
    http://127.0.0.1:28087/uploads/jenkins-route-probe/chunks/jenkins-route-probe)
  if [ "$status" != "401" ]; then
    echo "upload route probe failed: expected API 401, got HTTP $status" >&2
    return 1
  fi
}

[ -d "$REPO_DIR/.git" ] || git clone git@github.com:iwascy/KeepPage.git "$REPO_DIR"
git -C "$REPO_DIR" fetch --prune origin
git -C "$REPO_DIR" checkout main
git -C "$REPO_DIR" reset --hard origin/main
echo "deploying KeepPage commit $(git -C "$REPO_DIR" rev-parse --short HEAD)"

[ -f "$CLEANUP_LIB" ] || { echo "missing cleanup lib: $CLEANUP_LIB" >&2; exit 1; }
source "$CLEANUP_LIB"

set -a
source "$ENV_FILE"
set +a

docker compose --env-file "$ENV_FILE" -p keeppage -f "$DEPLOY_FILE" up -d --build --remove-orphans

for i in $(seq 1 60); do
  curl -fsS http://127.0.0.1:28787/health >/dev/null 2>&1 && curl -fsS http://127.0.0.1:28087/ >/dev/null 2>&1 && break
  sleep 3
done

curl -fsS http://127.0.0.1:28787/health >/dev/null
curl -fsS http://127.0.0.1:28087/ >/dev/null
verify_upload_route

docker compose --env-file "$ENV_FILE" -p keeppage -f "$DEPLOY_FILE" ps

export DOCKER_CLEANUP_KEEP_STORAGE="${DOCKER_CLEANUP_KEEP_STORAGE:-1024MB}"
docker_cleanup_run_suite "all" "all" "keeppage-api:2 keeppage-web:2"
