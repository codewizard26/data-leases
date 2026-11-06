# Coding agent instructions

Read `CLAUDE.md`, `SKILLS.md`, `specs.md`, and `docs/INTEGRATION_CONTRACT.md` before changing application code. Their scope, ownership, security rules, and evidence requirements apply to every assistant.

For agent work read `.claude/skills/agent-negotiation/SKILL.md`; for CRE work read `.claude/skills/cre-verifier/SKILL.md`. Keep shared contracts in `@data-leases/contracts`; proposed schemas require both contributors to review before freezing.

Use pnpm and strict TypeScript. Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` before submitting changes. Never imply placeholder services or mock checks are real A2A or CRE execution. Never commit secrets or generated datasets.
