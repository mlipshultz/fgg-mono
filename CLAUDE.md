# fgg-mono

Feel Good Gaming: public site, vendor table booking, attendee accounts, mobile app, AWS backend.
**Read `docs/PLAN.md` first.** It holds every architecture decision and the build phases; the design
spec is `docs/handoff/README.md` and the canvas `docs/handoff/FGG Site.dc.html`.

## Layout

- `apps/web` Next.js **static export** (no SSR, no API routes). Served from S3 + CloudFront.
- `apps/mobile` Expo / React Native (Phase 5).
- `packages/tokens` design tokens → `dist/css/tokens.css` (web) and `dist/theme.js` (RN). Edit
  `tokens.json`, never the outputs. Web CSS must use the variables, not literal values.
- `packages/types` zod schemas + inferred types shared by web, mobile and the API.
- `services/api` Lambda handlers (Phase 1+).
- `infra` CDK. Stacks are `Fgg-{stage}-{Name}`; stage from `-c stage=dev|prod`. One AWS account
  (CLI profile `fgg`). dev resources are disposable, prod retains.

## Commands

- `pnpm install`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (Turborepo).
- `pnpm --filter @fgg/web dev` for the site. `pnpm --filter @fgg/infra deploy:dev` to deploy dev.
- Never run AWS commands without `--profile fgg`; the default profile is a different account.

## Conventions

- TypeScript strict, ESM everywhere (`.js` extensions on relative imports in packages/services).
- Money is integer cents. IDs are ULIDs. Dates: `YYYY-MM-DD` for event days, RFC 3339 for instants.
- Roles are Cognito groups; every API route checks `can()` from the permissions module.
- Styling: CSS modules + token variables. No Tailwind. Sticker look = 2px ink border + hard offset
  shadow, only on interactive and hero elements.
- Changes land via PR to `main`; CI must pass. `main` auto-deploys dev; prod is a manual dispatch.

## Gotchas

- Cognito cannot change a user pool's attribute schema after creation (CloudFormation fails with
  "Invalid AttributeDataType"). Get the schema right before prod exists; in dev, destroy and recreate
  `Fgg-dev-Auth` (and `Fgg-dev-Api`, which imports the pool) instead of updating.
- The Google identity provider must be able to map every required pool attribute, so keep `birthdate`
  optional at the pool level; the 13+ gate lives in the pre-signup trigger and the client.
- `S3BucketOrigin.withOriginAccessControl` writes a bucket policy that references the distribution, so a
  bucket and its CloudFront distribution must live in the same stack.
