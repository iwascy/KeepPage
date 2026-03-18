# SingleFile 许可证说明

KeepPage 计划直接集成 `single-file-core`，而不是遥控用户另外安装的 SingleFile 扩展。

当前官方 `single-file-core` npm 包信息：

- 仓库：`https://github.com/gildas-lormeau/single-file-core`
- 版本：`1.5.84`
- 许可证：`AGPL-3.0-or-later`

这意味着：

1. 如果继续直接分发或修改 SingleFile 内核，项目的整体许可证策略需要尽早确定。
2. 如果目标是闭源商用，必须在继续深度集成前明确法律路径，而不是在功能做完后再回头补。
3. 当前代码里会保留清晰的集成边界，便于未来替换为自研内核或合规方案。
