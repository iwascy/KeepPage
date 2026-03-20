# UI 风格统一重构计划

## 目标

将所有非首页页面 UI 风格对齐首页设计语言，同时大幅精简界面，删除冗余文本、隐藏高级功能，保持大厂简洁美观风格。

---

## 一、精简方案（做减法）

### 全局删除

| 删除项 | 理由 |
|--------|------|
| 所有 `.eyebrow` 标签文本 | 装饰性文本，增加视觉噪音 |
| 所有 `.subtitle` 描述段落 | 用户不需要被告知每个页面的用途 |
| `.sync-badge` 数据源标识 | 技术细节，不属于用户关注点 |
| `.texture` 背景纹理动画 | 旧风格装饰 |
| 旧版 `BookmarkCard` 组件 | 首页已使用 `HomeBookmarkCard` 替代 |

### AuthPanel 精简

| 改动 | 内容 |
|------|------|
| 删除 | `eyebrow`、`subtitle` 描述文本 |
| 精简 | 标题改为简洁的 "登录" / "创建账号" |
| 精简 | 按钮文案 "登录进入工作台" → "登录"、"注册并进入工作台" → "注册" |
| 精简 | 删除 field label（`<span>邮箱</span>` 等），仅靠 placeholder |

### DetailPanel 精简

| 改动 | 内容 |
|------|------|
| **布局** | 3 列 → 2 列（左侧信息栏 + 右侧预览），质量报告折叠隐藏 |
| 删除 | `eyebrow`（"Archive Detail"、"Preview"） |
| 删除 | 冗余 meta 行：Capture Profile、对象键、对象状态 |
| 隐藏 | "质量诊断" + "信号摘要" → 放入 `<details>` 折叠区 |
| 精简 | 版本列表：移除质量徽章，只显示版本号 + 时间 |
| 合并 | 元数据展示和编辑合为一体（移除分离的只读/编辑区块） |
| 精简 | preview-header：移除标题，只保留操作按钮行 |

### ImportNewPanel 精简

| 改动 | 内容 |
|------|------|
| 删除 | `eyebrow`、`subtitle` |
| 精简 | 来源选择卡：删除描述文字 `<p>` 和 hint `<span>`，只保留标题 |
| 隐藏 | 高级配置（去重策略、标题策略、目标位置、批次标签）→ `<details>高级选项</details>` |
| 精简 | 预检统计：8 个指标 → 4 个（总数、有效、新建、重复） |
| 删除 | 预检结果中的 domain 标签行 |

### ImportHistoryPanel 精简

| 改动 | 内容 |
|------|------|
| 删除 | `eyebrow`、`subtitle` |
| 精简 | 表格列：移除"来源"和"模式"列，保留核心列 |

### ImportDetailPanel 精简

| 改动 | 内容 |
|------|------|
| 删除 | `eyebrow`、`subtitle` |
| 精简 | 统计卡：8 个 → 4 个（总数、成功、失败、归档成功） |
| 精简 | 明细表：移除"去重结果"列 |

---

## 二、设计系统对齐

### CSS 变量（从 `.home-page` 提升到 `:root`）

```css
:root {
  --bg: #f7f8fb;
  --surface: rgba(255, 255, 255, 0.78);
  --surface-soft: #eff2f5;
  --text: #1f252a;
  --muted: #67717a;
  --soft: #93a0ab;
  --shadow: 0 22px 44px rgba(45, 51, 56, 0.08);
  --good: #12664f;
  --mid: #8a5900;
  --low: #932a2a;
  --radius-card: 26px;
  --radius-button: 999px;
  --radius-input: 18px;
}
```

### 字体统一
`"Inter", ui-sans-serif, sans-serif` 全局，删除 IBM Plex Sans 和 Space Grotesk。

### 按钮统一
- 主按钮：深灰渐变 `#575757 → #444444`，胶囊形
- 次按钮：白色背景 + 浅灰边框，胶囊形
- 幽灵按钮：无边框，灰色文本

### 输入框统一
- 无边框，背景 `rgba(239,242,245,0.96)`
- 圆角 `999px`（单行）/ `18px`（多行）
- focus: 灰色光环 `0 0 0 3px rgba(94,94,94,0.08)`

### 卡片/面板统一
- 圆角 26px
- 背景 `rgba(255,255,255,0.64-0.8)`
- 阴影 `0 18px 34px rgba(45,51,56,0.04)`

---

## 三、布局架构

### AppShell 共享布局（登录后所有页面）

从 `HomePage` 提取侧边栏 + 顶栏为 `AppShell`：
- 侧边栏：brand + 搜索 + collections + tags + footer
- 顶栏：用户头像
- 主内容区：渲染各页面内容

路由到详情/导入页时，侧边栏导航项保持但不高亮特定收藏夹。

### DetailPanel 新布局

```
[AppShell 侧边栏] | [左栏: 信息+编辑+版本] [右栏: 预览iframe]
                   |  320px                   flex: 1
```

质量报告折叠在左栏底部的 `<details>` 中。

### Import 页面新布局

```
[AppShell 侧边栏] | [主内容区: 表单/表格]
```

全部在 AppShell 主内容区内渲染，不再需要独立的 topbar。

---

## 四、实施步骤

### Step 1: CSS 重构
- 替换 `:root` 变量为首页色系
- 重写全局 body/input/select/textarea/button 样式
- 删除旧布局样式 (.page-shell, .texture, .topbar, .auth-shell 旧样式等)
- 新增/调整内页面板样式

### Step 2: 提取 AppShell
- 从 HomePage 提取 sidebar + topbar 为 AppShell
- 修改 App() 路由逻辑：登录后所有页面包裹 AppShell
- HomePage 变为 AppShell 的 children

### Step 3: 重构 AuthPanel
- 换色调 + 圆角 + 按钮 + 输入框
- 删除 eyebrow/subtitle/field labels
- 精简按钮文案

### Step 4: 重构 DetailPanel
- 3 列 → 2 列布局
- 合并信息展示+编辑
- 质量报告折叠
- 删除冗余 meta

### Step 5: 重构 Import 页面
- 删除 eyebrow/subtitle
- 来源卡精简
- 高级配置折叠
- 统计指标精简
- 表格列精简

### Step 6: 清理 + 构建
- 删除不再使用的 CSS 类和组件
- 删除旧版 BookmarkCard
- 构建验证
