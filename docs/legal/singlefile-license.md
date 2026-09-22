# 许可证与 SingleFile 依赖

## 项目状态

KeepPage 尚未设置整体项目许可证。源码公开不等于已经授予开源使用、修改或再分发许可；不要在 README 或包元数据中标记 MIT、AGPL 等项目许可证，直到维护者明确确定方案。

本说明记录当前依赖与待决事项，不替代许可证正文，也不改变第三方组件的授权条件。

## SingleFile core

KeepPage 的 Chrome 扩展已经直接集成 `single-file-core`，通过 MV3 注入完成归档，不要求用户另行安装 SingleFile 扩展。

- 上游：[gildas-lormeau/single-file-core](https://github.com/gildas-lormeau/single-file-core)
- 当前锁定版本：`1.5.84`（以仓库 `package-lock.json` 为准）
- 许可证：**AGPL-3.0-or-later**
- 集成声明：`apps/extension/package.json`

确定项目许可证及分发方式时，需要评估直接集成、修改和分发 SingleFile core 所涉及的 AGPL 义务，并保留上游许可证与版权声明。不能仅通过给 KeepPage 增加一个宽松许可证文件来消除第三方依赖的要求。

## 其他依赖

Mozilla Readability、WXT、React、Go 及其他依赖保留各自的许可证。分发构建产物前，应核对实际依赖版本附带的许可证和声明，而不是把项目许可证当作所有依赖的统一授权。

## English summary

KeepPage has not selected a project-wide license. Public source availability is not itself an open-source license grant. The Chrome extension directly integrates SingleFile core, currently locked to version 1.5.84 under **AGPL-3.0-or-later**. Its obligations and notices must be considered when choosing the project's licensing and distribution strategy. Other dependencies retain their respective licenses.
