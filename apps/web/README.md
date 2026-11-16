# Web application

React, TypeScript and Vite workspace with Vietnamese role-specific interfaces. Run `npm run dev:web` from repository root. Development proxies `/api` to the local NestJS API; production requires a reverse proxy or a public `VITE_API_BASE_URL` configured before build.

Use the [runbook](../../docs/RUNBOOK.md) for local setup and checks, [architecture](../../docs/ARCHITECTURE.md) for authorization/workflow rules, and [deployment guide](../../docs/DEPLOYMENT.md) before publishing. The shared `@brand` alias points to the retained runtime logo, pattern, favicon and CSS assets. Fonts are local, with the SIL OFL notice under `public/licenses/`.

Commands: `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`, `npm run build:web`, `npm run test:web:e2e`, `npm run test:web:ai`. Browser fixtures require compatible Chromium/Edge and do not use field credentials or providers. Keep secret keys outside frontend build variables.
