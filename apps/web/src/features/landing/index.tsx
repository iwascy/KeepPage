import { type ReactNode, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../../components/Icon";
import type { AuthMode } from "./auth-dialog";
import {
  CaptureVisual,
  HeroPreview,
  ImportVisual,
  OrganizeVisual,
  PrivateVisual,
  SearchVisual,
  VersionVisual,
} from "./product-preview";

export { AuthDialog, type AuthMode } from "./auth-dialog";

const REPO_URL = "https://github.com/iwascy/KeepPage";

const navItems = [
  { id: "features", label: "功能" },
  { id: "how", label: "工作原理" },
  { id: "ownership", label: "数据主权" },
  { id: "pricing", label: "定价" },
  { id: "faq", label: "常见问题" },
];

const useCases = ["技术文档", "设计灵感", "研究资料", "稍后阅读", "竞品追踪", "个人知识库"];

const problems: { icon: IconName; title: string; body: string }[] = [
  { icon: "link_off", title: "链接会失效", body: "文章被下线、站点关停、路径改版，书签只剩一个打不开的地址。" },
  { icon: "refresh", title: "内容会被改写", body: "你当时读到的那一版，可能已被更新、删减或藏到了付费墙后。" },
  { icon: "inbox", title: "收藏难以找回", body: "几百个书签挤在一个文件夹里，想用的时候只记得零星几个字。" },
];

const features: { icon: IconName; title: string; body: string; visual?: ReactNode; size: "wide" | "tall" | "base" }[] = [
  { icon: "file_archive", title: "一键保存完整网页", body: "浏览器扩展在你的页面里直接打包 HTML、样式、图片和字体，需要登录的页面也能如实保存。", visual: <CaptureVisual />, size: "tall" },
  { icon: "search", title: "搜索你读过的一切", body: "按标题、网址、备注和标签检索，模糊记忆也能快速定位。", visual: <SearchVisual />, size: "wide" },
  { icon: "history", title: "多版本快照", body: "同一网页可保存多个版本，随时切换对比。", visual: <VersionVisual />, size: "base" },
  { icon: "folder_open", title: "文件夹、标签与 AI 整理", body: "多级文件夹、标签和批量操作；接入你自己的模型，自动给出分类建议。", visual: <OrganizeVisual />, size: "base" },
  { icon: "lock", title: "私密空间", body: "敏感内容单独存放，凭独立密码访问，闲置后自动锁定。", visual: <PrivateVisual />, size: "base" },
  { icon: "download", title: "导入已有书签", body: "支持浏览器书签 HTML、CSV 与网址列表，提交前先预览重复项。", visual: <ImportVisual />, size: "wide" },
];

const smallFeatures: { icon: IconName; title: string; body: string }[] = [
  { icon: "share", title: "只读分享链接", body: "挑选收藏生成链接，随时撤销。" },
  { icon: "book_open", title: "阅读视图", body: "去掉干扰，专注正文。" },
  { icon: "vpn_key", title: "API 与设备管理", body: "Token 与扩展设备统一管理。" },
  { icon: "check_circle", title: "存档质量诊断", body: "标出缺失资源，及时补存。" },
];

const steps = [
  { title: "安装浏览器扩展", body: "在 Chrome 或任意 Chromium 浏览器中添加 KeepPage，并连接你的账号。" },
  { title: "遇到好内容，一键保存", body: "点击工具栏按钮，扩展在后台排队存档，本地队列确保不会丢失。" },
  { title: "随时整理与回看", body: "在 Web 资料库中搜索、归类、阅读，原网页消失也不影响。" },
];

const ownership: { icon: IconName; title: string; body: string }[] = [
  { icon: "inventory_2", title: "可完全自托管", body: "Go API + React Web + PostgreSQL，部署在你自己的服务器上。" },
  { icon: "public", title: "存储位置由你决定", body: "快照可存放在本地磁盘或 Cloudflare R2。" },
  { icon: "download", title: "随时导出", body: "存档以标准 HTML 保存，不被任何平台锁定。" },
  { icon: "vpn_key", title: "开放的 API", body: "通过 API Token 接入你自己的脚本和工作流。" },
];

const plans = [
  {
    name: "免费版",
    price: "¥0",
    period: "永久免费",
    description: "开始建立你的网页资料库。",
    features: ["500 条收藏与快照", "1 GB 存档空间", "文件夹、标签与搜索", "浏览器扩展与书签导入"],
    cta: "免费开始",
    action: "register" as const,
  },
  {
    name: "专业版",
    price: "¥18",
    period: "/ 月，按年付费",
    description: "为重度收藏者与研究者设计。",
    features: ["无限收藏与多版本快照", "50 GB 存档空间", "私密空间与只读分享", "AI 智能整理", "自动备份与优先支持"],
    cta: "开始 14 天试用",
    action: "register" as const,
    featured: true,
  },
  {
    name: "自托管",
    price: "开源",
    period: "部署在你自己的服务器",
    description: "完全掌控数据与基础设施。",
    features: ["全部功能，不限数量", "PostgreSQL + 本地 / R2 存储", "API Token 与设备管理", "社区支持"],
    cta: "查看部署文档",
    action: "repo" as const,
  },
];

const faqs = [
  { q: "KeepPage 和浏览器自带的书签有什么不同？", a: "书签只保存网址；KeepPage 在收藏时保存整张网页的快照，原网页修改或消失后，你仍能看到当时的内容，并能用文件夹、标签和搜索整理它们。" },
  { q: "支持哪些浏览器？", a: "扩展基于 Chrome Manifest V3，适用于 Chrome、Edge、Arc 等 Chromium 内核浏览器。Web 资料库可在任意现代浏览器中使用。" },
  { q: "需要登录才能看的页面能保存吗？", a: "可以。存档在你自己的浏览器标签页中完成，保存的是你当时实际看到的页面内容。" },
  { q: "私密空间是端到端加密的吗？", a: "不是。私密空间通过独立密码进行访问控制，并会在闲置后自动锁定，但它不是端到端加密。对安全要求更高的场景，建议选择自托管。" },
  { q: "我的数据可以导出或迁移吗？", a: "可以。快照以标准 HTML 存档，可随时下载；自托管版本的数据完全保存在你自己的数据库和存储中。" },
];

function scrollToSection(id: string) {
  // Section links scroll in place: the app uses the URL hash for routing.
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function useReveal() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      targets.forEach((target) => target.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);
  return rootRef;
}

export function LandingPage({ onOpenAuth }: { onOpenAuth: (mode: AuthMode) => void }) {
  const rootRef = useReveal();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    const closeOnWide = () => { if (window.innerWidth > 1080) setMenuOpen(false); };
    document.addEventListener("keydown", close);
    window.addEventListener("resize", closeOnWide);
    return () => {
      document.removeEventListener("keydown", close);
      window.removeEventListener("resize", closeOnWide);
    };
  }, [menuOpen]);
  const goTo = (id: string) => {
    setMenuOpen(false);
    scrollToSection(id);
  };
  const openAuth = (mode: AuthMode) => {
    setMenuOpen(false);
    onOpenAuth(mode);
  };

  return (
    <div className="lp" ref={rootRef}>
      <header className={["lp-nav", scrolled || menuOpen ? "is-scrolled" : "", menuOpen ? "is-menu-open" : ""].filter(Boolean).join(" ")}>
        <div className="lp-container lp-nav-inner">
          <button type="button" className="lp-logo" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <span className="lp-logo-mark"><Icon name="bookmark" /></span>KeepPage
          </button>
          <nav className="lp-nav-links" aria-label="页面导航">
            {navItems.map((item) => (
              <button type="button" key={item.id} onClick={() => goTo(item.id)}>{item.label}</button>
            ))}
          </nav>
          <div className="lp-nav-actions">
            <button type="button" className="lp-btn lp-btn-ghost" onClick={() => openAuth("login")}>登录</button>
            <button type="button" className="lp-btn lp-btn-primary" onClick={() => openAuth("register")}>免费开始</button>
            <button
              type="button"
              className="lp-menu-toggle"
              aria-label={menuOpen ? "关闭菜单" : "打开菜单"}
              aria-expanded={menuOpen}
              aria-controls="lp-mobile-menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Icon name={menuOpen ? "close" : "menu"} />
            </button>
          </div>
        </div>
        {menuOpen ? (
          <nav id="lp-mobile-menu" className="lp-mobile-menu" aria-label="页面导航">
            <div className="lp-container">
              {navItems.map((item) => (
                <button type="button" key={item.id} onClick={() => goTo(item.id)}>
                  {item.label}<Icon name="keyboard_arrow_right" />
                </button>
              ))}
              <div className="lp-mobile-menu-actions">
                <button type="button" className="lp-btn lp-btn-outline lp-btn-lg" onClick={() => openAuth("login")}>登录</button>
                <button type="button" className="lp-btn lp-btn-primary lp-btn-lg" onClick={() => openAuth("register")}>免费开始</button>
              </div>
            </div>
          </nav>
        ) : null}
      </header>
      {menuOpen ? <div className="lp-menu-scrim" aria-hidden="true" onClick={() => setMenuOpen(false)} /> : null}

      <main>
        <section className="lp-hero">
          <div className="lp-hero-glow" aria-hidden="true" />
          <div className="lp-container lp-hero-inner">
            <div className="lp-hero-copy">
              <span className="lp-eyebrow"><i />网页存档 · 书签管理 · 个人资料库</span>
              <h1>网页会消失，<br /><em>你的收藏</em>不会。</h1>
              <p>
                KeepPage 在你收藏的那一刻保存整张网页的完整快照——文字、图片与排版原样留存。
                再用文件夹、标签与搜索，把它们整理成真正属于你的资料库。
              </p>
              <div className="lp-hero-actions">
                <button type="button" className="lp-btn lp-btn-primary lp-btn-lg" onClick={() => onOpenAuth("register")}>
                  免费开始使用<Icon name="keyboard_arrow_right" />
                </button>
                <button type="button" className="lp-btn lp-btn-outline lp-btn-lg" onClick={() => scrollToSection("how")}>
                  了解工作原理
                </button>
              </div>
              <ul className="lp-hero-notes">
                <li><Icon name="check_circle" />无需信用卡</li>
                <li><Icon name="check_circle" />数据可随时导出</li>
                <li><Icon name="check_circle" />支持自托管</li>
              </ul>
            </div>
            <HeroPreview />
          </div>
          <div className="lp-container lp-usecases" data-reveal>
            <span>适合用来收藏</span>
            <ul>{useCases.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        </section>

        <section className="lp-section lp-problem">
          <div className="lp-container">
            <SectionHead
              kicker="为什么需要 KeepPage"
              title="收藏夹里，有多少链接已经打不开了？"
              body="书签只是一个地址，地址背后的内容随时可能改变。值得留下的东西，应该被真正保存下来。"
            />
            <div className="lp-problem-grid">
              {problems.map((item, index) => (
                <article className="lp-problem-card" key={item.title} data-reveal style={{ transitionDelay: `${index * 80}ms` }}>
                  <span className="lp-icon-badge"><Icon name={item.icon} /></span>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section" id="features">
          <div className="lp-container">
            <SectionHead
              kicker="核心功能"
              title="从保存到回看，一个工具全部搞定"
              body="不是又一个书签栏，而是一座为你个人运转的网页档案馆。"
            />
            <div className="lp-bento">
              {features.map((item) => (
                <article className={`lp-bento-card is-${item.size}`} key={item.title} data-reveal>
                  <div className="lp-bento-copy">
                    <span className="lp-icon-badge"><Icon name={item.icon} /></span>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                  </div>
                  {item.visual}
                </article>
              ))}
            </div>
            <div className="lp-mini-grid">
              {smallFeatures.map((item) => (
                <div className="lp-mini" key={item.title} data-reveal>
                  <Icon name={item.icon} />
                  <div><strong>{item.title}</strong><span>{item.body}</span></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section lp-how" id="how">
          <div className="lp-container">
            <SectionHead kicker="工作原理" title="三步，留住每一个值得的网页" />
            <ol className="lp-steps">
              {steps.map((step, index) => (
                <li className="lp-step" key={step.title} data-reveal style={{ transitionDelay: `${index * 100}ms` }}>
                  <span className="lp-step-num">{String(index + 1).padStart(2, "0")}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lp-section lp-ownership" id="ownership">
          <div className="lp-container lp-ownership-inner">
            <div className="lp-ownership-copy" data-reveal>
              <span className="lp-kicker">数据主权</span>
              <h2>你的资料，由你掌控</h2>
              <p>
                KeepPage 的全部代码开源。你可以使用我们的托管服务，也可以把它部署在自己的服务器上——
                快照存在哪里、保留多久、谁能访问，都由你决定。
              </p>
              <a className="lp-btn lp-btn-light" href={REPO_URL} target="_blank" rel="noreferrer">
                在 GitHub 查看源码<Icon name="arrow_outward" />
              </a>
            </div>
            <div className="lp-ownership-grid">
              {ownership.map((item) => (
                <div className="lp-own-card" key={item.title} data-reveal>
                  <Icon name={item.icon} />
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section" id="pricing">
          <div className="lp-container">
            <SectionHead kicker="定价" title="简单透明，按需选择" body="从免费版开始，需要时再升级，或者直接自己部署。" />
            <div className="lp-pricing">
              {plans.map((plan) => (
                <article className={plan.featured ? "lp-plan is-featured" : "lp-plan"} key={plan.name} data-reveal>
                  {plan.featured ? <span className="lp-plan-badge">最受欢迎</span> : null}
                  <h3>{plan.name}</h3>
                  <p className="lp-plan-desc">{plan.description}</p>
                  <div className="lp-plan-price"><strong>{plan.price}</strong><span>{plan.period}</span></div>
                  {plan.action === "repo" ? (
                    <a className="lp-btn lp-btn-outline lp-plan-cta" href={REPO_URL} target="_blank" rel="noreferrer">{plan.cta}</a>
                  ) : (
                    <button type="button" className={plan.featured ? "lp-btn lp-btn-primary lp-plan-cta" : "lp-btn lp-btn-outline lp-plan-cta"} onClick={() => onOpenAuth(plan.action)}>{plan.cta}</button>
                  )}
                  <ul>{plan.features.map((feature) => <li key={feature}><Icon name="check_circle" />{feature}</li>)}</ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section lp-faq" id="faq">
          <div className="lp-container lp-faq-inner">
            <SectionHead kicker="常见问题" title="你可能想知道" align="left" />
            <div className="lp-faq-list">
              {faqs.map((item) => (
                <details className="lp-faq-item" key={item.q}>
                  <summary>{item.q}<span aria-hidden="true" /></summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-cta">
          <div className="lp-container">
            <div className="lp-cta-card" data-reveal>
              <h2>从下一个值得收藏的网页开始</h2>
              <p>免费注册，几分钟内建立你的个人网页档案馆。</p>
              <div className="lp-hero-actions">
                <button type="button" className="lp-btn lp-btn-light lp-btn-lg" onClick={() => onOpenAuth("register")}>免费开始使用<Icon name="keyboard_arrow_right" /></button>
                <button type="button" className="lp-btn lp-btn-dark-ghost lp-btn-lg" onClick={() => onOpenAuth("login")}>已有账号，登录</button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <span className="lp-logo"><span className="lp-logo-mark"><Icon name="bookmark" /></span>KeepPage</span>
            <p>Save the page. Keep the context.</p>
          </div>
          <div className="lp-footer-cols">
            <div>
              <strong>产品</strong>
              <button type="button" onClick={() => scrollToSection("features")}>功能</button>
              <button type="button" onClick={() => scrollToSection("pricing")}>定价</button>
              <button type="button" onClick={() => scrollToSection("faq")}>常见问题</button>
            </div>
            <div>
              <strong>资源</strong>
              <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
              <a href={`${REPO_URL}/blob/main/docs/deployment.md`} target="_blank" rel="noreferrer">部署文档</a>
              <a href={`${REPO_URL}/blob/main/docs/usage.md`} target="_blank" rel="noreferrer">使用说明</a>
            </div>
            <div>
              <strong>账号</strong>
              <button type="button" onClick={() => onOpenAuth("login")}>登录</button>
              <button type="button" onClick={() => onOpenAuth("register")}>注册</button>
            </div>
          </div>
        </div>
        <div className="lp-container lp-footer-bottom">© {new Date().getFullYear()} KeepPage. All rights reserved.</div>
      </footer>
    </div>
  );
}

function SectionHead({ kicker, title, body, align = "center" }: { kicker: string; title: string; body?: string; align?: "center" | "left" }) {
  return (
    <header className={`lp-section-head is-${align}`} data-reveal>
      <span className="lp-kicker">{kicker}</span>
      <h2>{title}</h2>
      {body ? <p>{body}</p> : null}
    </header>
  );
}
