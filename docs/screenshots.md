# README 截图维护 · Screenshot workflow

README 图片从当前 React UI 生成，使用虚构演示数据。它们用于展示产品，不构成固定 UI 规范。中英文 README 共用四张图，使用各自语言的 alt 文本与图注。

## 数据与入口

- 正常回归数据：`apps/web/src/features/demo/workspace.ts`。
- 宣传数据：`apps/web/src/features/demo/showcase.ts`，在普通数据上替换标题、备注和示例文章，不修改默认回归样本。
- 宣传入口：`/demo.html?showcase=1`，仍使用正式 `App` 与组件。
- 演示文章是原创虚构内容，不是链接指向的源站文章，也不证明该站点的抓取效果。
- `showcase=1` 仅在 demo 数据源中生效，不会让正式入口自动切换到 mock。

## 重新生成

需要 Node.js 24、已安装的 npm 依赖，以及本地 Chrome / Chromium。截图脚本使用仓库已有的 Puppeteer 依赖。

终端 1，在仓库根目录启动本地服务：

```bash
npm ci
npm run dev:mock -w @keeppage/web -- --host 127.0.0.1 --port 5189 --strictPort
```

终端 2，在仓库根目录执行：

```bash
node scripts/readme-screenshots.mjs
```

macOS 默认使用 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`。其他系统或自定义 Chrome 路径使用：

```bash
PUPPETEER_EXECUTABLE_PATH='/path/to/chrome' node scripts/readme-screenshots.mjs
```

可通过 `KEEPPAGE_DEMO_URL` 指定另一个本地 demo 服务地址。脚本仅接受 localhost / 回环地址，阻止外部资源与 `/api/` 请求，并检查页面使用的是虚构演示账号。

## 图片与验证

| 文件 | 场景 |
| --- | --- |
| `assets/library.png` | 默认紧凑视图，展示收藏夹、书签和存档入口 |
| `assets/organize.png` | Design 收藏夹的画廊视图 |
| `assets/archive.png` | 示例文章、已展开的历史版本和导出入口 |
| `assets/import.png` | URL 清单导入预检，包含新增与重复条目 |

截图使用 1440 × 1040 CSS 像素（整理图裁切为顶部 1440 × 560）、1.5 倍像素密度、Asia/Shanghai 时区，并固定演示时钟以避免相对日期变化。外部 favicon 被阻止，显示组件自身的域名缩写回退。

脚本检查归档版本切换、导入预览以及原始 demo 数据仍然可用；不提交导入任务、不访问真实账号。执行后人工检查四张图的裁切、文本、加载状态及可读性，再将相关图片与两份 README 一起更新。

这四张最终宣传图片可以纳入版本控制。调试截图、临时 HTML 与浏览器检查记录放在被忽略的 `output/`，不提交生成的完整站点或单文件 HTML。

## English

Run the two commands above in separate terminals to capture the current app with fictional showcase data. Set `PUPPETEER_EXECUTABLE_PATH` when Chrome is not at the default macOS path. The script only visits a local demo, blocks external/API requests, checks archive version switching and import preview, and writes the four README images to `docs/assets/`. Review each image visually before committing it. Keep English and Chinese captions aligned; these screenshots are product illustrations, not UI specifications or evidence of live website capture fidelity.
