<div align="center">

# KeepPage

**Save the page. Keep the context.**

A self-hosted bookmark manager and web archiving tool with a Chrome extension.
Save page snapshots, organize your collection, and revisit what mattered.

**English** · [简体中文](README.zh-CN.md)

[Quick start](#quick-start) · [Self-hosting](#self-hosting) · [Documentation](#documentation) · [Contributing](CONTRIBUTING.md)

![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4b5563?style=flat-square)
![Go + React](https://img.shields.io/badge/Go_%2B_React-374151?style=flat-square)
![Self-hosted](https://img.shields.io/badge/Self--hosted-Your_data-526358?style=flat-square)

</div>

![KeepPage library with folders, saved pages, notes, and archive status](docs/assets/library.png)

*Actual KeepPage UI with fictional demo data. The current interface is primarily in Chinese; both README editions use the same screenshots.*

## Why KeepPage?

A bookmark helps you find a URL. A saved snapshot lets you revisit the content you wanted to keep—even when the original page changes or disappears.

KeepPage brings bookmarks and browser-captured HTML archives into one personal library. Use it for technical references, design inspiration, reading lists, and research you want to return to.

- **Capture in your browser.** Archive the page with SingleFile, keep a local task queue, and sync the result to your server.
- **Give your collection structure.** Organize with nested folders, tags, favorites, notes, and bulk actions.
- **Find and revisit.** Search your library, open saved versions, and download available HTML archives.
- **Choose where your data lives.** Run the Go API and React web app yourself, with PostgreSQL and local disk or Cloudflare R2 storage.

## A closer look

### Organize and find

Combine folder and tag filters with search. Switch between compact and gallery views, and organize multiple bookmarks at once.

![A filtered KeepPage library showing design references](docs/assets/organize.png)

### Revisit saved pages

Preview an available original archive or reading view, switch between saved versions, and export HTML for later reading. Capture quality diagnostics help identify missing content.

![Archive viewer with a demonstration article, version history, tags, and export action](docs/assets/archive.png)

*The article above is written for this demo. It is not a real capture of the linked source.*

### Bring your bookmarks

Import browser bookmark HTML, URL lists, or CSV. Preview duplicate handling before submitting. Imports add links; you can then use the browser extension to archive selected pages.

![Bookmark import preview showing new and duplicate entries](docs/assets/import.png)

### More ways to use your library

| Capability | What it does |
| --- | --- |
| Sharing | Create and revoke read-only links to selected ordinary bookmarks. |
| Private mode | Separate private content behind password access control; this is **not end-to-end encryption**. |
| AI organization | Configure a model connection and run classification tasks. Requires your own compatible service and credentials. |
| API tokens & devices | Manage programmatic access and connected browser extensions. |
| Backups | Optionally schedule ordinary-bookmark backups to R2; see [backup scope and setup](docs/bookmark-backup-to-r2.md). |

## Quick start

### Try the interface

You only need **Node.js 24** (see [`.nvmrc`](.nvmrc)) and npm:

```bash
git clone https://github.com/iwascy/KeepPage.git
cd KeepPage
npm ci
npm run dev:web:mock
```

Open [localhost:5173](http://localhost:5173). No API, database, extension, or real account is needed. To see the presentation dataset used in these screenshots, open [the showcase](http://localhost:5173/demo.html?showcase=1).

Demo changes reset on reload. Private mode, external AI services, and browser capture are not fully simulated. The production app does not fall back to mock data when the API fails.

### Run the full app

Install **Go 1.24+** and Chrome in addition to Node.js/npm. After installing dependencies, run these in **separate terminals**:

```bash
# Terminal 1 — Go API, http://127.0.0.1:8787
npm run dev:api
```

```bash
# Terminal 2 — web app, http://localhost:5173
npm run dev:web
```

The web dev server proxies `/api` to the Go API. Register an account in the web app. The default `memory` repository is for evaluation: accounts and bookmark metadata disappear when the API restarts. Use PostgreSQL for persistent use.

### Connect Chrome

Build the extension from the repository root:

```bash
./build-extension.sh
```

The helper installs dependencies with `npm ci` if WXT is missing. Alternatively, after `npm ci`, run `npm run build -w @keeppage/extension`.

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select `apps/extension/.output/chrome-mv3`.
3. Open the extension's Side Panel, set the API address to `http://127.0.0.1:8787`, and connect your account.
4. Save a bookmark from the toolbar popup. Use the Side Panel to create a page archive and sync it.
5. Open the web library and choose **查看存档** to revisit the saved page.

Saving a bookmark from the toolbar does **not** automatically create an archive. See the [usage guide](docs/usage.md) for capture, queue, and sync details.

## Self-hosting

The recommended setup is **Go API + PostgreSQL + web app**, served under one domain with `/api` reverse-proxied to the API. Use persistent local storage or Cloudflare R2 for archive objects.

For a local PostgreSQL setup, configure and run the API in the same terminal:

```bash
export STORAGE_DRIVER=postgres
export DATABASE_URL='postgresql://<user>:<password>@127.0.0.1:5432/keeppage'
export OBJECT_STORAGE_DRIVER=localfs
export OBJECT_STORAGE_ROOT="$PWD/apps/api-go/data/object-storage"
npm run db:init -w @keeppage/api-go
npm run dev:api
```

The database service must already be running. Initialization creates the database if needed (requiring permission) and applies the Go migrations.

| Setting | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string for persistent metadata. |
| `OBJECT_STORAGE_DRIVER` | `localfs` or `r2`. |
| `OBJECT_STORAGE_ROOT` | Persistent archive directory when using `localfs`. |
| `API_PUBLIC_BASE_URL` | Externally reachable API URL, for example `https://keep.example.com/api`. |
| `R2_*` | Bucket, endpoint, and credentials when using R2; see the deployment guide. |

The existing [Docker Compose configuration](deploy/docker-compose.yml) is a deployment reference with host-specific paths. Adapt its paths, environment file, and ports before use; it is not a one-command portable installer.

Read the [deployment guide](docs/deployment.md) for storage, reverse proxy, extension distribution, and the TypeScript rollback backend. Back up both database metadata and archive objects.

## Development

| Directory | Responsibility |
| --- | --- |
| `apps/web` | React + Vite web UI; production and demo share components. |
| `apps/extension` | WXT Chrome MV3 extension, capture queue, and sync. |
| `apps/api-go` | Production Go API, PostgreSQL repositories, and migrations. |
| `apps/api` | Retained TypeScript/Fastify rollback backend. |
| `packages/domain` | Shared TypeScript contracts, schemas, and capture quality rules. |
| `packages/db` | Drizzle schema and TypeScript-backend migrations. |

```bash
npm run typecheck                  # TypeScript checks and Go tests
npm run build -w @keeppage/web      # Production web build
npm run dev:extension              # Extension development
npm run build:demo:html            # Standalone demo in apps/web/dist-standalone/
```

Go production migrations live in `apps/api-go/migrations/`. See [CONTRIBUTING.md](CONTRIBUTING.md) for focused tests, extension versioning, and documentation updates.

## Documentation

Detailed operational guides are currently in Chinese.

- [Documentation index](docs/README.md)
- [Usage and troubleshooting](docs/usage.md)
- [Deployment](docs/deployment.md) · [Architecture](docs/architecture.md)
- [Authentication sessions](docs/auth-sessions.md) · [Backups](docs/bookmark-backup-to-r2.md)
- [UI regression coverage](docs/ui-refactor-baseline.md)
- [Reproduce the README screenshots](docs/screenshots.md)

## Current boundaries

KeepPage is actively evolving. Capture fidelity varies by website; dynamic media, embedded frames, and protected content may not be preserved completely. Demo screenshots show the interface, not a guarantee of capture quality for those websites. Chrome MV3 is the documented extension target.

## Contributing

Bug reports, documentation fixes, and focused pull requests are welcome. Read the [contribution guide](CONTRIBUTING.md), [report a bug](https://github.com/iwascy/KeepPage/issues/new?template=bug_report.md), or [suggest a feature](https://github.com/iwascy/KeepPage/issues/new?template=feature_request.md).

## License and acknowledgements

**A project-wide license has not yet been selected.** Public source availability does not itself grant an open-source license. See the [licensing notes](docs/legal/singlefile-license.md) before reuse or redistribution.

KeepPage uses [SingleFile core](https://github.com/gildas-lormeau/single-file-core) for capture, licensed under **AGPL-3.0-or-later**, alongside [Mozilla Readability](https://github.com/mozilla/readability), [WXT](https://wxt.dev/), [React](https://react.dev/), and [Go](https://go.dev/). Third-party components retain their respective licenses.
