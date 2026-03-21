# Sidebar UI Refactor Plan

## Overview
Refactor the web app sidebar to match the "Frosted Alabaster" design reference (`stitch (4)/screen.png`), following the Luminous UI style guide (`docs/ui-guide/`).

## Key Files
- `apps/web/src/App.tsx` (main component, sidebar at lines 820-999)
- `apps/web/src/styles.css` (all styling)
- Design reference: `stitch (4)/code.html` (target HTML/Tailwind structure)
- UI guide: `docs/ui-guide/README.md`

## Design Decisions
- Settings: Sidebar embedded panel (click gear icon → sidebar switches to settings view, with back button)
- Recent/Favorites: UI only for now, no filtering logic

## Implementation Steps

### Step 1: Sidebar Layout Restructure
**Target**: Reorganize sidebar into 4 vertical sections: Brand+Search → Quick Nav → Collections+Tags → Footer

Changes to `apps/web/src/App.tsx` (sidebar section ~lines 820-941):

1. **Brand area** (top):
   - Keep app name text, remove old icon
   - Add `more_horiz` Material icon button on the right
   - Style: `text-lg font-bold tracking-tighter`

2. **Search bar**:
   - Add search icon (Material `search`) inside input
   - Style: `bg-surface-container-low/50 rounded-xl`, pill-style with left icon padding

3. **Quick Nav section** (NEW - 3 items):
   - "All Bookmarks" with `bookmark` icon (filled when active)
   - "Recent" with `schedule` icon
   - "Favorites" with `star` icon
   - Active state: `bg-white/80 shadow-sm rounded-xl`
   - Inactive: `text-zinc-500 hover:bg-white/40 rounded-xl`
   - These map to a new state variable `activeNav: 'all' | 'recent' | 'favorites'`
   - "All Bookmarks" = current "全部归档" behavior
   - "Recent" and "Favorites" are UI-only placeholders for now

### Step 2: Collections & Tags Styling
**Target**: Match design reference styles

1. **Collections section header**:
   - Style: `text-[10px] uppercase tracking-[0.1em] font-bold text-on-surface-variant/60`
   - "+" add button on right (Material `add` icon)

2. **Collection/folder items**:
   - Use `folder_open` Material icon (instead of emoji/custom)
   - Right side: `keyboard_arrow_right` for expandable folders
   - Style: `px-3 py-2 text-zinc-500 hover:text-zinc-800 hover:bg-white/40 rounded-xl`
   - Remove old count badge style, use cleaner layout

3. **Tags section header**:
   - Same style as Collections header
   - Add `expand_more` toggle icon on right

4. **Tag chips**:
   - Remove `#` prefix
   - Style: `px-2 py-0.5 bg-surface-container-low text-[11px] rounded-full border border-outline-variant/10`
   - Hover: `hover:border-primary/40`
   - Remove old dark gradient active state, use lighter approach

### Step 3: Sidebar Footer (Bottom Section)
**Target**: Add "+ Add New" button + user profile + settings gear at bottom

1. **"+ Add New" button**:
   - Full-width primary button
   - Style: `bg-primary text-on-primary py-2.5 rounded-xl font-bold shadow-lg shadow-primary/10`
   - Material `add` icon + "Add New" text
   - onClick: trigger the bookmark creation flow (reuse existing `onOpenImportNew`)

2. **User profile row**:
   - Move avatar from topbar to sidebar bottom
   - Layout: `[avatar img] [name + plan] [settings icon]`
   - Avatar: 36px circle with existing gradient initials
   - Name: `text-xs font-bold text-zinc-900`
   - Sub-text: Plan type or email, `text-[10px] text-zinc-500`
   - Settings gear: Material `settings` icon, `text-zinc-400 hover:text-zinc-600`

3. **Remove from topbar**:
   - Remove `.home-profile-menu` and `.home-profile-dropdown` from topbar
   - Keep topbar for breadcrumb/view controls only

### Step 4: Settings Panel (Sidebar Embedded)
**Target**: Click settings gear → sidebar content switches to settings panel

1. **New state**: `sidebarView: 'main' | 'settings'`

2. **Settings panel layout**:
   - Back button at top (Material `arrow_back` + "Settings" title)
   - Menu items list:
     - "新建导入" (Create Import) - reuse `onOpenImportNew`
     - "导入历史" (Import History) - reuse `onOpenImportHistory`
     - Divider
     - "退出登录" (Logout) - reuse `onLogout`, danger style
   - Style: Same glassmorphism as sidebar, items use `rounded-xl hover:bg-white/40`

3. **Transition**: Simple conditional render based on `sidebarView` state

## CSS Changes (styles.css)

### New classes needed:
- `.home-quick-nav` - Quick nav section container
- `.home-quick-nav-item` - Individual nav item (All/Recent/Favorites)
- `.home-quick-nav-item.is-active` - Active state
- `.home-sidebar-footer` - Bottom section container
- `.home-add-new-btn` - Primary add button
- `.home-user-profile` - Bottom user profile row
- `.home-settings-panel` - Settings view container
- `.home-settings-back` - Back button in settings
- `.home-settings-item` - Settings menu item

### Modified classes:
- `.home-sidebar` - Adjust to flex-col with `justify-between` for footer pinning
- `.home-brand` - Simplify to text + icon button
- `.home-search-input` - Add left padding for search icon
- `.home-folder-main` - Update to new design style
- `.home-folder-name` - Remove `::before` line prefix for child folders
- `.home-tag-chip` - New lighter style, remove `#` prefix
- `.home-sidebar-section-head` - Update to new typography
- `.home-topbar` - Remove profile-related elements
- Remove: `.home-profile`, `.home-profile-menu`, `.home-profile-dropdown`, `.home-profile-menu-item`, `.home-profile-copy`, `.home-profile-caret`, `.home-avatar` (moved to sidebar)

### Keep consistent with UI guide:
- Border radius: `rounded-xl` (1rem) for items, `rounded-2xl` for containers
- Glassmorphism: `bg-white/60 backdrop-blur-xl` for sidebar
- Active scale: `active:scale-[0.98]` on interactive elements
- Section labels: `text-[10px] uppercase tracking-[0.1em] font-bold text-on-surface-variant/60`
- Font: Inter throughout
- No 1px solid borders for sectioning (use background shifts)
