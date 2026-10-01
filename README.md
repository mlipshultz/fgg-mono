# fgg-mono

Feel Good Gaming monorepo: website, vendor booking, attendee accounts, mobile app, AWS backend.

- Plan and decisions: [`docs/PLAN.md`](docs/PLAN.md)
- Design handoff: [`docs/handoff/README.md`](docs/handoff/README.md)
- Working conventions: [`CLAUDE.md`](CLAUDE.md)

```sh
pnpm install
pnpm build && pnpm test
pnpm --filter @fgg/web dev
```
