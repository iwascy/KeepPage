# 🎨 Luminous UI 风格规范指南 (Style Guide)

这份指南定义了一种极具现代感、通透且精致的“毛玻璃”（Glassmorphism）与 Material Design 3 (M3) 融合风格。整体视觉语言传递出一种轻量、高级且专注于内容的氛围。

## 1. 核心视觉理念 (Core Aesthetic)
*   **通透与层级 (Translucency & Depth)**：大量使用带透明度的背景色结合 `backdrop-blur` (毛玻璃) 效果，通过背景模糊度而非生硬的阴影来构建 Z 轴层级。
*   **触觉反馈 (Tactile Interactions)**：强调物理按压感。所有的可点击元素在 `active` 状态下都必须有缩放效果（如 `active:scale-95`）。
*   **M3 语义化色彩 (Semantic Colors)**：放弃传统的硬编码颜色，采用基于 Material Design 3 的语义化 Token 系统（如 `surface`, `on-surface`, `primary-container`），主色调偏向极简的锌灰色（Zinc）。
*   **便当盒布局 (Bento Grid)**：内容呈现倾向于使用规整、圆润的卡片网格。

## 2. 基础视觉系统 (Foundation)

### 2.1 字体排版 (Typography)
*   **唯一字体族**：全局强制使用 `Inter` 字体（sans-serif）。
*   **层级对比**：极端化字重对比。
    *   **大标题 (Page Title/Modal Title)**：使用超大字号和字重，配合紧凑的字间距。例如：`text-5xl font-extrabold tracking-tight` (重且紧凑)。
    *   **章节小标题 (Section Label)**：使用极小字号、全大写、超宽字间距。例如：`text-[10px] uppercase tracking-widest font-bold` (小且疏朗)。
    *   **正文/辅助文本**：常规字重，颜色偏灰（如 `text-zinc-500` 或 `text-on-surface-variant`）。

### 2.2 色彩体系 (Color Palette)
*   **背景与表面 (Surfaces)**：使用低饱和度的亮灰色或全白。基础背景为 `bg-surface`，卡片表面为 `bg-surface-container-lowest` (纯白)。
*   **中性色调 (Neutrals)**：高度依赖 Tailwind 的 `zinc` 色系（而不是默认的 gray），以获得更冷冽、现代的质感。
*   **强调色 (Accents)**：主色调（Primary）被设定为深灰色（`#5e5e5e`），而非鲜艳的彩色，使得整体风格极其克制。彩色仅用于标签或分类的高亮（低饱和度马卡龙色，如 `#D8D3F4`, `#D4EBE1`）。

### 2.3 图标系统 (Iconography)
*   **统一图库**：强制使用 Google 的 `Material Symbols Outlined`。
*   **配置参数**：线条细腻，无填充（除非选中状态）。`font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;`。

---

## 3. 组件级设计规范 (Component Specifications)

### 3.1 导航与容器 (Navigation & Containers)
*   **顶栏 (TopAppBar)**：
    *   **样式**：固定在顶部，高度 `h-20`。
    *   **材质**：半透明白色背景 + 强毛玻璃效果 + 极其微弱的弥散阴影。代码：`bg-white/60 backdrop-blur-xl shadow-[0_20px_40px_rgba(45,51,56,0.06)]`。
*   **侧边栏 (SideNavBar)**：
    *   **样式**：固定在左侧，宽度 `w-72`，内边距充足 (`p-6`)。
    *   **材质**：比顶栏更通透的背景 + 更强的毛玻璃。代码：`bg-zinc-50/50 backdrop-blur-2xl`。
    *   **导航项**：未选中态为文字带图标，hover 时轻微右移（`hover:translate-x-1`）。选中态背景为不透明白色卡片，大圆角（`rounded-2xl`）。

### 3.2 交互元素 (Interactive Elements)
*   **主按钮 (Primary Action)**：
    *   **形状**：大圆角矩形（`rounded-2xl`）或全圆角药丸形状（`rounded-full`）。
    *   **质感**：实色背景，带有**同色系的弥散发光阴影**。代码：`bg-primary text-on-primary shadow-lg shadow-primary/20`。
    *   **动态**：按压缩小。代码：`transition-all active:scale-95`。
*   **图标按钮 (Icon Button)**：
    *   圆形（`rounded-full`）或方圆角（`rounded-lg`，用于 Grid 布局），Hover 时出现半透明底色，按压时强烈缩小（`active:scale-90`）。

### 3.3 内容展示 (Content Presentation)
*   **媒体卡片 (Media Cards / Bento Grid)**：
    *   **比例**：强制 `aspect-[4/3]`。
    *   **容器**：大圆角 `rounded-xl`，溢出隐藏 `overflow-hidden`。
    *   **静态**：无边框，极弱的底层阴影 `shadow-sm`。
    *   **Hover 联动状态**：
        1.  阴影加深扩散（`hover:shadow-xl`）。
        2.  内部图片缓慢放大（`duration-700 group-hover:scale-105`）。
        3.  底部黑色渐变遮罩浮现，带出白色标题文本（`opacity-0 group-hover:opacity-100`）。

### 3.4 弹窗与表单 (Modals & Forms)
*   **遮罩层 (Overlay)**：偏暗的半透明背景加上毛玻璃效果。代码：`bg-inverse-surface/10 backdrop-blur-md`。
*   **弹窗面板 (Dialog)**：
    *   极简风格的“悬浮玻璃板”。
    *   代码：`bg-surface-container-lowest/80 backdrop-blur-[40px] rounded-xl shadow-[0_20px_40px_rgba(45,51,56,0.12)] border border-white/40`。（注意：白色半透明边框增强了玻璃的高光边缘感）。
    *   内部 Padding 极其宽裕（`p-10`）。
*   **输入框 (Inputs)**：
    *   无边框设计（`border-none`），依赖灰底色（`bg-surface-container-low`）区分区域。
    *   获得焦点时，使用环形高亮代替边框线（`focus:ring-2 focus:ring-surface-tint`）。
    *   大尺寸（`p-5 text-lg rounded-xl`）。

---

## 💡 AI 重构提示词 (Prompt for AI Reconstruction)

如果你想让 AI 生成符合此风格的代码，请在 Prompt 中附带以下指令：

> **"请遵循以下 UI 风格指南生成 Tailwind CSS 代码："**
> 1.  **色彩方案**：禁止使用默认的彩色 primary。使用基于黑/白/冷灰 (Zinc) 的中性色调，重要按钮使用 `bg-zinc-800 text-white` 或自定义的 `bg-primary`。
> 2.  **材质与层级**：浮动层（Header, Sidebar, Modal）必须使用高强度的毛玻璃效果（`backdrop-blur-xl` 到 `40px` 不等）配合半透明背景色（如 `bg-white/60`）和微弱的弥散阴影。弹窗需要加 `border border-white/40` 增强玻璃边缘质感。
> 3.  **交互微动效**：**所有**可点击元素（Button, a 标签, 卡片）必须包含 `transition-all`。Hover 时引发状态改变，**Active（按下）时必须有缩放反馈**（如 `active:scale-95` 或 `active:scale-90`）。主按钮必须带有同色系的发光阴影（如 `shadow-lg shadow-primary/20`）。
> 4.  **排版**：使用 `Inter` 字体。主标题要求极粗且紧凑（`font-extrabold tracking-tight`）；模块小标题要求极小、全大写且字间距极宽（`text-[10px] uppercase tracking-widest text-zinc-500`）。
> 5.  **空间感**：使用大圆角（卡片/输入框用 `rounded-xl`，部分按钮用 `rounded-2xl` 或 `rounded-full`）。组件内外留白必须慷慨（Padding 至少在 p-4 到 p-10 之间）。输入框需无边框、灰底色，Focus 时出现 Ring 环。
> 6.  **图标**：统一使用 Material Symbols Outlined。