# Claude Code Instructions

Follow the repository rules in `AGENTS.md` as the primary project guide.

## Extension Change Requirements
Whenever you modify code or configuration under `apps/extension`, you must do all of the following before finishing:
- Bump the extension version in both `apps/extension/package.json` and `apps/extension/wxt.config.ts`.
- Run `npm run build -w @keeppage/extension` to generate fresh extension artifacts.
- Never hand-edit generated directories such as `apps/extension/.output` or `apps/extension/.wxt`; regenerate them through the build command instead.

Default communication language for this repository is Simplified Chinese.
