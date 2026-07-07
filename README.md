# openclub

AI-native club management for racket sports, starting with Padel. Members and pros interact with the club through a Claude-powered agent over WhatsApp.

Docs live in [`Docs/`](./Docs) — start with the [PRD](./Docs/product/PRD.md) and the [implementation plan](./Docs/product/implementation-plan.md).

## How to run locally

Requires Node ≥ 22 and pnpm (`corepack enable pnpm`).

```sh
pnpm install
cp .env.example .env   # defaults work out of the box for now
pnpm dev               # starts the server with reload on http://localhost:3000
curl localhost:3000/health
```

Other scripts:

```sh
pnpm test        # run the test suite (Vitest)
pnpm typecheck   # tsc --noEmit
pnpm lint        # Biome lint + format check (lint:fix to write)
pnpm build       # compile to dist/
pnpm start       # run the compiled build
```

`db:generate` / `db:migrate` / `db:seed` land with US-02/US-03.
