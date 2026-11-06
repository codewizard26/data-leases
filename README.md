# Data Leases

Rent the answer. Not the team.

Initial shared monorepo scaffold for agent discovery/negotiation and a separate CRE verification proof of concept. Read [CLAUDE.md](CLAUDE.md), [SKILLS.md](SKILLS.md), and [the proposed integration contract](docs/INTEGRATION_CONTRACT.md).

## Setup

Use Node 22 or later and the pnpm version pinned in package.json.

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`apps/` contains ownership placeholders; `packages/` contains strict TypeScript workspaces. CRE workflow and integration test directories are reserved for their owners. Contracts are proposed, not team-approved. No running dashboard, A2A service, Parquet writer, payment flow, or CRE simulation exists yet. Development and simulation commands will be added when their implementations land.
