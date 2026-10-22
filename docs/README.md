# 文档导航

项目介绍：[English](../README.md) · [简体中文](../README.zh-CN.md)。开发协作见[贡献指南](../CONTRIBUTING.md)。

UI 重构先读 [重构功能基线](ui-refactor-baseline.md)，再按模块查看当前源码。这里不指定新的视觉风格。

## 当前维护文档

| 文档 | 用途 |
| --- | --- |
| [UI 重构功能基线](ui-refactor-baseline.md) | 入口、功能边界、预览方式和回归范围 |
| [使用说明](usage.md) | 启动、日常操作与故障排查 |
| [登录会话](auth-sessions.md) | 登录恢复、刷新令牌、撤销与鉴权写入节流 |
| [架构说明](architecture.md) | 当前运行时、目录职责与数据边界 |
| [部署说明](deployment.md) | Go API、Web、存储和回滚配置 |
| [书签备份](bookmark-backup-to-r2.md) | R2 备份操作 |
| [Docker 清理](docker-cleanup.md) | 部署主机维护 |
| [宣传截图维护](screenshots.md) | 演示数据、截图复现与中英文 README 更新 |
| [SingleFile 许可证](legal/singlefile-license.md) | 第三方许可证信息 |

## 产品需求与历史方案

[批量导入](batch-import-prd.md)、[私密模式](private-mode-prd.md)（当前私密工作区契约见 [private-workspace.md](private-workspace.md)）、[分享](share-prd.md)、[AI 整理](ai-auto-organize-prd.md) 保留业务规则和设计背景。它们包含制定时的设想和验收项，不是当前待办清单；实现状态以源码和实际验证为准。重构不继承其中的旧布局、固定入口位置或视觉风格。

`superpowers/specs/`、`superpowers/plans/` 保存有日期的后端迁移方案，仅用于追溯迁移决策，不作为当前执行任务。

## 维护约定

- 正式 Web 与 Mock 预览共用组件，预览随源码更新。
- 导出的单文件 HTML 放在 `apps/web/dist-standalone/`；临时截图放在被忽略的 `output/`。
- `docs/assets/` 仅保存 README 引用的宣传截图；它们是当前产品展示，不是 UI 规范。
- 不把静态原型、截图或历史设计 Skill 作为隐含的 UI 规范。
- 修改行为时同步对应文档；不使用旧进度报告代替当前状态。
