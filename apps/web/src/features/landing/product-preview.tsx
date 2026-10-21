import { Icon } from "../../components/Icon";

/* Illustrative product surfaces drawn in markup so the landing page stays crisp without bitmap assets. */

const libraryCards = [
  { title: "深入理解 React 并发渲染", host: "react.dev", tag: "前端", tone: "sage", grade: "优" },
  { title: "设计系统中的间距与节奏", host: "rauno.me", tag: "设计", tone: "sand", grade: "优" },
  { title: "PostgreSQL 索引调优实战", host: "postgres.ai", tag: "数据库", tone: "sky", grade: "良" },
  { title: "长期主义写作者的工作流", host: "paulgraham.com", tag: "阅读", tone: "rose", grade: "优" },
  { title: "边缘计算中的对象存储", host: "blog.cloudflare.com", tag: "架构", tone: "ink", grade: "优" },
  { title: "排版中的中文标点挤压", host: "w3.org", tag: "设计", tone: "moss", grade: "良" },
];

export function HeroPreview() {
  return (
    <div className="lp-preview" aria-hidden="true">
      <div className="lp-window">
        <div className="lp-window-bar">
          <span className="lp-dots"><i /><i /><i /></span>
          <span className="lp-window-url"><Icon name="lock" />app.keeppage.com</span>
          <span className="lp-window-spacer" />
        </div>
        <div className="lp-window-body">
          <aside className="lp-mock-sidebar">
            <div className="lp-mock-brand"><span><Icon name="bookmark" /></span>KeepPage</div>
            <div className="lp-mock-nav is-active"><Icon name="bookmarks" />全部收藏<em>248</em></div>
            <div className="lp-mock-nav"><Icon name="star" />星标<em>32</em></div>
            <div className="lp-mock-nav"><Icon name="schedule" />最近<em>16</em></div>
            <p className="lp-mock-label">文件夹</p>
            <div className="lp-mock-nav"><Icon name="folder_open" />技术文档</div>
            <div className="lp-mock-nav"><Icon name="folder_open" />设计灵感</div>
            <div className="lp-mock-nav"><Icon name="folder_open" />研究资料</div>
            <p className="lp-mock-label">标签</p>
            <div className="lp-mock-tags"><span>前端</span><span>设计</span><span>阅读</span><span>架构</span></div>
          </aside>
          <div className="lp-mock-main">
            <div className="lp-mock-toolbar">
              <span className="lp-mock-search"><Icon name="search" />搜索标题、正文、标签…</span>
              <span className="lp-mock-chip"><Icon name="grid_view" /></span>
              <span className="lp-mock-chip"><Icon name="tune" /></span>
            </div>
            <div className="lp-mock-grid">
              {libraryCards.map((card) => (
                <div className="lp-mock-card" key={card.title}>
                  <div className={`lp-mock-thumb is-${card.tone}`}>
                    <i /><i /><i />
                  </div>
                  <strong>{card.title}</strong>
                  <span className="lp-mock-meta">
                    <em>{card.host}</em>
                    <b>{card.tag}</b>
                  </span>
                  <span className="lp-mock-status"><Icon name="check_circle" />已存档 · 质量{card.grade}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="lp-float lp-float-capture">
        <div className="lp-float-head">
          <span className="lp-float-icon"><Icon name="file_archive" /></span>
          <div>
            <strong>正在保存完整快照</strong>
            <small>样式、图片与字体一并打包</small>
          </div>
        </div>
        <div className="lp-progress"><span /></div>
        <div className="lp-float-foot"><span>2.4 MB</span><span className="lp-ok"><Icon name="check_circle" />已同步</span></div>
      </div>

      <div className="lp-float lp-float-dead">
        <div className="lp-dead-row">
          <span className="lp-dead-code">404</span>
          <span>原网页已无法访问</span>
        </div>
        <div className="lp-dead-row is-ok">
          <Icon name="history" />
          <span>你的快照依然可以打开</span>
        </div>
      </div>
    </div>
  );
}

export function CaptureVisual() {
  const steps = ["读取页面结构", "内联样式与字体", "打包图片资源", "上传到你的资料库"];
  return (
    <div className="lp-visual lp-visual-capture" aria-hidden="true">
      <div className="lp-ext-popup">
        <div className="lp-ext-head"><span><Icon name="bookmark" /></span>KeepPage<em>已连接</em></div>
        <div className="lp-ext-page">
          <i className="lp-ext-fav" />
          <div><strong>深入理解 React 并发渲染</strong><small>react.dev/learn</small></div>
        </div>
        <ul>
          {steps.map((step) => (
            <li key={step}><Icon name="check_circle" />{step}</li>
          ))}
        </ul>
        <div className="lp-ext-button">保存到资料库</div>
      </div>
    </div>
  );
}

export function SearchVisual() {
  return (
    <div className="lp-visual lp-visual-search" aria-hidden="true">
      <div className="lp-search-box"><Icon name="search" />并发渲染<span className="lp-caret" /></div>
      <div className="lp-search-result">
        <strong>深入理解 React <mark>并发渲染</mark></strong>
        <small>…Transition 让 <mark>并发渲染</mark> 可以中断低优先级更新…</small>
      </div>
      <div className="lp-search-result is-dim">
        <strong>React 18 升级笔记</strong>
        <small>…自动批处理与 <mark>并发</mark> 特性…</small>
      </div>
    </div>
  );
}

export function VersionVisual() {
  const versions = [
    { date: "10 月 18 日", note: "当前版本", active: true },
    { date: "8 月 02 日", note: "正文更新" },
    { date: "3 月 21 日", note: "首次存档" },
  ];
  return (
    <div className="lp-visual lp-visual-versions" aria-hidden="true">
      {versions.map((version) => (
        <div className={version.active ? "lp-version is-active" : "lp-version"} key={version.date}>
          <i />
          <strong>{version.date}</strong>
          <small>{version.note}</small>
        </div>
      ))}
    </div>
  );
}

export function OrganizeVisual() {
  return (
    <div className="lp-visual lp-visual-organize" aria-hidden="true">
      <div className="lp-org-row"><Icon name="folder_open" />技术文档<span>/ 前端</span></div>
      <div className="lp-org-row is-nested"><Icon name="folder_open" />React</div>
      <div className="lp-org-tags">
        <span className="is-sage">前端</span>
        <span className="is-sand">性能</span>
        <span className="is-sky">必读</span>
        <span className="lp-org-ai"><Icon name="auto_awesome" />AI 建议：架构</span>
      </div>
    </div>
  );
}

export function PrivateVisual() {
  return (
    <div className="lp-visual lp-visual-private" aria-hidden="true">
      <span className="lp-lock"><Icon name="lock" /></span>
      <div className="lp-pin"><i /><i /><i /><i /><i /><i /></div>
      <small>闲置后自动锁定</small>
    </div>
  );
}

export function ImportVisual() {
  return (
    <div className="lp-visual lp-visual-import" aria-hidden="true">
      {["bookmarks.html", "reading-list.csv", "urls.txt"].map((file) => (
        <div className="lp-file" key={file}><Icon name="description" />{file}</div>
      ))}
      <div className="lp-import-stat"><strong>1,284</strong>条新链接<span>· 36 条重复已跳过</span></div>
    </div>
  );
}
