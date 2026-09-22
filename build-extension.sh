#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

for command_name in node npm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf '错误：未找到 %s，请先安装 Node.js 和 npm。\n' "$command_name" >&2
    exit 1
  fi
done

if [[ ! -x node_modules/.bin/wxt ]]; then
  printf '首次构建，正在安装项目依赖……\n'
  npm ci
fi

printf '正在构建 KeepPage Chrome 插件……\n'
npm run build -w @keeppage/extension

printf '\n构建完成！\n插件目录：%s/apps/extension/.output/chrome-mv3\n' "$PROJECT_ROOT"
printf '在 Chrome 中打开 chrome://extensions，启用开发者模式，点击“加载已解压的扩展程序”并选择上述目录。\n'
