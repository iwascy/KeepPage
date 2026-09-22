import { createDemoWorkspace, type DemoWorkspace } from "./workspace";

// Presentation-only fixtures. Keep the default regression workspace intact.
const copy: Record<string, { title?: string; note: string }> = {
  bm_ai_005: {
    title: "用结构化输出连接你的应用",
    note: "从文本到可靠的数据结构。收藏这份指南，留给下一个项目。",
  },
  bm_guide_001: {
    title: "Chrome Extensions · Manifest V3",
    note: "Service worker、权限与消息通信，浏览器扩展开发的常用参考。",
  },
  bm_article_002: {
    note: "记录浏览器自动填充体验的变化，为表单设计寻找灵感。",
  },
  bm_release_003: {
    title: "产品手记：从想法到第一次发布",
    note: "每次迭代都值得留下记录。回看当时的选择和取舍。",
  },
  bm_design_004: {
    title: "Material 3 · 色彩系统",
    note: "用语义化色彩建立清晰的层级，让界面更容易理解。",
  },
  bm_reader_006: {
    title: "GOV.UK · 可访问的折叠面板",
    note: "键盘操作、内容组织与渐进增强，一起收进设计参考。",
  },
  bm_queue_007: {
    title: "MDN · 图片与资源的懒加载",
    note: "先加入阅读清单，周末再看。需要时可以补一份网页存档。",
  },
  bm_incident_008: {
    title: "工程笔记：一次 CDN 超时复盘",
    note: "保存故障时间线与排查思路，帮助下一次更快定位问题。",
  },
};

function articleHtml(versionNo: number) {
  return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>用结构化输出连接你的应用 · 演示文章</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #242a31; font: 16px/1.9 system-ui, sans-serif; }
  article { max-width: 760px; margin: auto; padding: 56px 48px 80px; }
  .eyebrow { color: #697586; font-size: 12px; letter-spacing: .12em; }
  h1 { font-size: 34px; line-height: 1.4; letter-spacing: -.04em; margin: 20px 0 16px; }
  h2 { font-size: 21px; margin-top: 32px; }
  p { color: #52606d; }
  .intro { font-size: 18px; }
  .meta { padding-bottom: 24px; border-bottom: 1px solid #e5e8eb; font-size: 13px; color: #79828e; }
  pre { background: #f5f7f9; border: 1px solid #e5e8eb; border-radius: 8px; padding: 20px; font: 14px/1.8 ui-monospace, monospace; white-space: pre-wrap; }
  aside { border-left: 3px solid #809488; padding: 10px 20px; background: #f6f8f6; color: #526358; }
</style>
<article>
  <div class="eyebrow">KEEPPAGE FIELD NOTES / 演示文章</div>
  <h1>用结构化输出连接你的应用</h1>
  <p class="intro">让收藏的知识成为下一次创造的起点。</p>
  <div class="meta">示例资料 · 2026 年 3 月 · 归档版本 ${versionNo}</div>
  <h2>从一段文字，到可使用的数据</h2>
  <p>读到有用的技术文章时，我们往往只保存一个链接。把当时的页面一起留下，才能在文档更新后回看原来的示例、思路和上下文。</p>
  <p>结构化输出的一个常见用途，是将阅读笔记整理为明确的字段：主题、摘要和接下来想尝试的事情。</p>
  <pre>{
  "topic": "让知识更容易找回",
  "collection": "Engineering / API",
  "next_step": "在自己的项目中试一次"
}</pre>
  <h2>${versionNo === 2 ? "为未来的自己留下线索" : "从一份简单的笔记开始"}</h2>
  <p>给收藏加上一句备注，再放进合适的收藏夹。下一次遇到同样的问题，就可以按主题找到资料，并回看保存时的页面。</p>
  <aside>本文是为 KeepPage 演示编写的示例内容，并非源站文章或真实抓取结果。</aside>
</article>
</html>`;
}

export function createShowcaseWorkspace(): DemoWorkspace {
  const workspace = createDemoWorkspace();
  workspace.user = { ...workspace.user, name: "Alex Chen", email: "alex@example.com" };
  for (const bookmark of workspace.bookmarks) {
    const content = copy[bookmark.id];
    if (content) Object.assign(bookmark, content);
  }
  for (const version of workspace.versionsByBookmarkId.bm_ai_005 ?? []) {
    workspace.archiveHtmlByVersionId[version.id] = articleHtml(version.versionNo);
  }
  return workspace;
}
