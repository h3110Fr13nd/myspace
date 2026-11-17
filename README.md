# FOSS Content Workspace

A ReBAC-isolated research & knowledge workspace — markdown vaults, PDFs, spatial
canvases, IAM permission management, tagging, and Obsidian/Quartz sync — built
on Astro.

> **Design system is mandatory.** All UI work MUST follow the rules in
> [`docs/design-system.md`](docs/design-system.md). New surfaces that bypass the
> token → primitive → component layers will be rejected.

> **Product and engineering goal:** [`docs/GOALS.md`](docs/GOALS.md) is the
> source of truth for the 10–100 user target, constrained runtime budget, and
> engineering priorities.

## Architecture overview

- **UI**: Astro + React (`src/components/ui/`) on a token-based design system
  (`src/styles/tokens.css`, `src/styles/primitives.css`).
- **Content**: markdown/JSON canvases in `content/`, rendered via
  `src/lib/` renderers.
- **Data**: PostgreSQL + Meilisearch + OpenFGA (see `docker-compose.yml`).
- **Docs**: project guidance lives in `docs/` and `AGENTS.md`. Product and engineering goals: [`docs/GOALS.md`](docs/GOALS.md). UI rules: [`docs/design-system.md`](docs/design-system.md). Scale implementation notes: [`docs/plans/multiuser-scale.md`](docs/plans/multiuser-scale.md). Excalidraw fork + render-anything node roadmap: [`docs/plans/excalidraw-custom-element.md`](docs/plans/excalidraw-custom-element.md).

## Commands

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npx tsc --noEmit`        | Type-check the project                           |
| `npm run test:e2e`        | Run Playwright end-to-end tests                  |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |

Full Astro documentation: https://docs.astro.build
