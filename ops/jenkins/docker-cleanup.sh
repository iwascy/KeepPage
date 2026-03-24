#!/usr/bin/env bash

if [[ ${BASH_SOURCE[0]} == ${0} ]]; then
  echo "docker-cleanup.sh 是一个库脚本，需要被 source 后调用。" >&2
  exit 1
fi

_docker_cleanup_log() {
  local level="$1"
  shift
  local ts
  ts=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$ts][docker-cleanup][$level] $*" >&2
}

# 打印 docker system df 输出，便于观察清理前后的体积变化。
docker_cleanup_report_disk_usage() {
  local stage="$1"
  shift || true
  _docker_cleanup_log info "docker system df (${stage})"
  docker system df "$@"
}

# 仅清理 dangling 镜像层，默认只动 72 小时之前的层，避免误伤刚刚构建的产物。
docker_cleanup_prune_dangling_images() {
  local max_age="${1:-72h}"
  _docker_cleanup_log info "docker image prune --force --filter dangling=true --filter until=${max_age}"
  docker image prune --force --filter "dangling=true" --filter "until=${max_age}" || _docker_cleanup_log warn "跳过 dangling 镜像清理"
}

# 清理 BuildKit cache，默认只清理 7 天前的缓存块。
docker_cleanup_prune_builder_cache() {
  local max_age="${1:-168h}"
  local keep_storage="${2:-0}"
  local args=(--force --filter "until=${max_age}")
  if [[ "${keep_storage}" != "0" ]]; then
    args+=("--keep-storage" "${keep_storage}")
  fi
  _docker_cleanup_log info "docker builder prune ${args[*]}"
  docker builder prune "${args[@]}" || _docker_cleanup_log warn "跳过 builder cache 清理"
}

# 控制 repository 只保留最近 N 个 tag（默认 2 个）。
docker_cleanup_trim_repo_history() {
  local repository="$1"
  local keep_count="${2:-2}"
  if [[ -z "${repository}" ]]; then
    return 0
  fi
  mapfile -t existing_ids < <(docker image ls "${repository}" --format '{{.ID}}\t{{.Repository}}:{{.Tag}}') || true
  local total=${#existing_ids[@]}
  if (( total <= keep_count )); then
    return 0
  fi
  for (( i=keep_count; i<total; i++ )); do
    local record="${existing_ids[$i]}"
    local image_id=${record%%\t*}
    local ref=${record#*\t}
    _docker_cleanup_log info "移除历史镜像 ${ref} (${image_id})"
    docker image rm "${image_id}" >/dev/null || _docker_cleanup_log warn "无法移除 ${ref}"
  done
}

# 根据形如 "repo_a:2 repo_b:3" 的参数批量裁剪镜像历史。
docker_cleanup_trim_multiple_repos() {
  local repo_spec="$1"
  [[ -z "${repo_spec}" ]] && return 0
  for pair in ${repo_spec}; do
    local repo=${pair%%:*}
    local keep=${pair#*:}
    docker_cleanup_trim_repo_history "${repo}" "${keep}"
  done
}

# 统一执行一次标准清理流程。
docker_cleanup_run_suite() {
  local image_max_age="$1"
  local builder_max_age="$2"
  local repo_spec="$3"
  _docker_cleanup_log info "开始执行 Docker 清理 (dangling>${image_max_age}, builder>${builder_max_age})"
  docker_cleanup_report_disk_usage "before"
  docker_cleanup_prune_dangling_images "${image_max_age}"
  docker_cleanup_prune_builder_cache "${builder_max_age}" "${DOCKER_CLEANUP_KEEP_STORAGE:-0}"
  docker_cleanup_trim_multiple_repos "${repo_spec}"
  docker_cleanup_report_disk_usage "after"
}
