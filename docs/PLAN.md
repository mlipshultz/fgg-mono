# fgg-mono Implementation Plan

Written 2026-09-30 from `docs/handoff/README.md` (the design handoff) plus the decisions below.
The handoff README is the spec for screens, tokens and copy. This document records what was
decided on top of it, what is assumed until told otherwise, the architecture, and the build order.

---

## 1. Decisions (made 2026-09-30)

| Topic                              | Decision                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Relationship to feelgoodgaming.com | **Full replacement at cutover.** The current Next.js/Supabase site on Vercel keeps running until the new site is ready, then DNS flips. Supabase users, events, gallery and vendor leads are migrated with a one-time script.                                                                                      |
| Legacy mobile app (`~/dev/fgg`)    | **Start fresh.** Nothing is ported. The legacy CLAUDE.md remains a useful reference for DynamoDB gotchas and the staff-scan ticket idea, but the new app is built from the handoff.                                                                                                                                |
| Database                           | **DynamoDB single-table** with one GSI to start.                                                                                                                                                                                                                                                                   |
| Vendor pricing                     | **Per day.** Vendor picks the show days first, then one table that is free on every chosen day. Price = days × rate. Standard $200/day, PokéBucks partner $100/day. One table per booking; a vendor wanting more runs the flow again.                                                                              |
| Payments                           | **Shopify Draft Orders via the Admin API.** Backend creates a draft order with a custom line item and sends the vendor to its invoice URL. Store: `zbxged-ps.myshopify.com`.                                                                                                                                       |
| Web hosting                        | **Static export of Next.js on S3 + CloudFront.** No server rendering. Public pages are baked at build time and rebuilt on publish; authenticated areas are a client-side app.                                                                                                                                      |
| AWS accounts                       | **One account** (CLI profile `fgg`, id 462545111287 is the Frost work account, do not use). `dev` and `prod` are stage-suffixed stacks in the same account. Stack naming and CDK context keep an account split possible later.                                                                                     |
| Everything in handoff §0A          | Stands as written except child profiles (below): 13+ accounts, keep PokéBucks/PokéPets names, no tax or fee (configurable, default 0), React Native mobile, staff tools inside the same app, 3b event cards, placeholder XP/badges.                                                                                |
| Vendor = business, not person      | A `VENDOR#id` record with one or more member users. One member at launch; adding a second is an admin action.                                                                                                                                                                                                      |
| Vendor approval                    | **Global.** Once approved, a vendor can book any open event. Per-event details ("about your store") sit on the Pay step as an editable card, prefilled from the profile.                                                                                                                                           |
| Attendee purchases                 | **Yes, eventually.** Free tickets and premium tickets per event. Vendor table bookings and tickets are both `ORDER` records with a `kind`, sharing the Shopify, webhook and refund path. Ticket UI is not in the designs; schema and API support it from day one, UI ships after the vendor flow.                  |
| Pricing                            | Per-table **premium overrides** in the floor plan (e.g. corner or stage-adjacent tables). **Early-bird pricing** as dated price windows on the event. No multi-day discount.                                                                                                                                       |
| Search                             | **Not now.** Exact email lookup only; admin lists are paged and filtered client-side. Users are expected to stay small.                                                                                                                                                                                            |
| Child profiles                     | **Dropped** (2026-10-01). Under-13s attend with a parent and participate on the parent's account. No child profiles, no profile switcher, no parental-approval email. One account = one XP holder, keyed by Cognito sub. The handoff's §0A/§0C child-profile rows and the dashboard profile switcher do not apply. |
| Retired live-site features         | Shop/cart/drops, news, tournaments, custom mat designer, public `/username` profiles, Collect-a-thon pages, stream page and vendor video page are **retired at cutover**, each with a redirect to the nearest new page.                                                                                            |
| PokéPets                           | A separate site. The activity tile links out; nothing is built here.                                                                                                                                                                                                                                               |
| Refunds                            | Vendor requests a cancellation from the dashboard; staff approve in admin; the admin action issues the Shopify refund. No self-service refunds. 14-day policy enforced as a warning, staff can override.                                                                                                           |
| Vendor approval                    | **Manual after a call.** Submit application → schedule a call via Calendly (embedded on the pending screen) → staff approve or reject in admin. An **automated path** (watch video + accept terms → auto-approve) is a settings switch, not a rewrite; see §3.5a.                                                  |
| Book & Pay Now routing             | Approved vendor → table picker immediately. Signed-out → log in or sign up, then apply. Applicant → "application pending", no booking. Everyone else → application form, then wait for approval. As in handoff §0C.                                                                                                |

## 2. Assumptions for the handoff's open items (§0B)

These are defaults so the build is not blocked. Each is cheap to change. Override any of them.

| Open item                      | Assumption                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rewards (§0B.1)                | **Not at launch.** `Reward`/`Redemption` types are reserved in `packages/types` but no UI or API.                                                                                                                                                                                                                                                                    |
| Missing phone designs          | Follow the §6 responsive rules. Flag screens for design review once built.                                                                                                                                                                                                                                                                                           |
| Age gate                       | Sign-up asks for birth year and refuses under-13 with a "sign up with a parent" message. No COPPA data is collected.                                                                                                                                                                                                                                                 |
| Vendor application form design | Reuse the field set from the live site's modal (business, contact, phone, email, a required free-text "what do you plan to sell", socials, PokéBucks interest, code-of-conduct + sealed-policy checkboxes) in the new visual style. No "previous FGG events" count: returning vendors are imported and auto-approved (§5). The Calendly link/embed URL is a setting. |
| Legal text                     | Ship placeholder pages with clearly marked `TODO` blocks. Refund line: full refund up to 14 days before the show.                                                                                                                                                                                                                                                    |
| More than one table per vendor | One per order (see decisions). Setting `maxTablesPerVendorPerEvent` exists for a future cap.                                                                                                                                                                                                                                                                         |
| PokéBucks partner cap          | None. `pokeBucksPartnerCap` setting exists, default unlimited.                                                                                                                                                                                                                                                                                                       |
| PokéBucks status               | Chosen at the rate step, as designed, and recorded on the booking. Not part of application approval. Staff can revoke on the vendor record.                                                                                                                                                                                                                          |
| No-shows                       | Out of scope. Staff mark bookings `no_show` manually in admin; no automatic penalty.                                                                                                                                                                                                                                                                                 |
| Real content                   | Seed from the live Supabase `events` table and the four posters in `docs/handoff/uploads`. Discord/social/contact values are env config.                                                                                                                                                                                                                             |
| Floor plans                    | One JSON floor plan per venue, seeded with the designed layout (stage, side zones, rows A–F × 10 with a cross-aisle after table 5, entrance). Tables may carry a premium price override. Editable as JSON in admin at first; visual editor later.                                                                                                                    |
| Pass numbers                   | Sequential per event, e.g. `HF26-017`, from the event `COUNTER` item.                                                                                                                                                                                                                                                                                                |
| Audit                          | Append-only `HIST#` rows on orders and applications; `awardedBy` on every XP scan.                                                                                                                                                                                                                                                                                   |
| Offline scanning               | Online only at launch; scan IDs are generated on the device so an offline queue can be added without changing the API.                                                                                                                                                                                                                                               |
| Leaderboards                   | Not built. Per-event XP totals are stored so a leaderboard is one index away.                                                                                                                                                                                                                                                                                        |
| Hold duration                  | 10 min on the picker, extended to 30 min when the vendor is redirected to Shopify.                                                                                                                                                                                                                                                                                   |
| Waitlist                       | Email + optional account per event. Staff see the list in admin and notify manually. Automatic release-to-waitlist later.                                                                                                                                                                                                                                            |
| Email                          | **Amazon SES** for all transactional mail (receipts, approvals, password resets). The "Join the List" signup writes a `Subscriber` record and pushes to the existing **Klaviyo** list via API so the marketing list is not lost. Single opt-in, matching today.                                                                                                      |
| Media hosting                  | S3 + CloudFront. Hero video is an MP4/WebM pair uploaded to S3; no MediaConvert until there is a real need. Gallery images get resized variants by a Lambda on upload.                                                                                                                                                                                               |
| Analytics                      | Carry over GA4 and the Meta Pixel from the live site, driven by env vars.                                                                                                                                                                                                                                                                                            |
| Accessibility                  | WCAG 2.2 AA.                                                                                                                                                                                                                                                                                                                                                         |
| Domain/DNS                     | Unknown provider (live site is on Vercel, DNS may be Vercel or the registrar). Needed for the ACM certificate and Cognito hosted-UI domain before prod.                                                                                                                                                                                                              |
| Super Admin                    | **Yes**, as a Cognito group from day one. It is one more entry in the permission table and avoids a migration later.                                                                                                                                                                                                                                                 |
| Social sign-in                 | Google at web launch (an OAuth project already exists from the legacy app). Apple when the iOS app ships, since Apple requires it alongside other social logins.                                                                                                                                                                                                     |

## 3. Architecture

```
Browser / RN app
   │  Cognito JWT
   ▼
API Gateway (REST) ──► Lambda handlers (services/api)
   │                       │
   │                       ├── DynamoDB  (single table + GSI1, TTL on holds)
   │                       ├── S3 media bucket  ──► CloudFront (media)
   │                       ├── SES
   │                       ├── Shopify Admin API (draft orders)
   │                       └── GitHub repository_dispatch (rebuild site on publish)
   │
Shopify webhooks (orders/paid, refunds/create) ──► API Gateway ──► Lambda (HMAC verified)

S3 web bucket ──► CloudFront (site)   ◄── GitHub Actions `next build && next export` sync
```

### 3.1 Repository layout (matches handoff §2A)

```
apps/web         Next.js, static export. Public site + accounts + booking + admin console.
apps/mobile      Expo (React Native). Attendee + vendor + staff tools behind role checks.
packages/tokens  tokens.json → Style Dictionary → CSS variables + RN theme object.
packages/types   Shared models and API request/response types (zod schemas, inferred types).
packages/api-client  Typed fetch client, Cognito token attach, used by web and mobile.
packages/game    XP curve, level titles, badge rules, placeholder configs. Pure functions.
services/api     Lambda handlers, one folder per domain, shared lib for DynamoDB access.
infra            CDK app. Stacks: Auth, Data, Api, Web, Media, Email. Stage from context.
docs             This plan, the handoff, ADRs as decisions accumulate.
```

Tooling: pnpm workspaces + Turborepo, TypeScript strict everywhere, ESLint + Prettier, Vitest for
packages and services, Playwright for web, Jest + RNTL for mobile. Node 22 (installed). pnpm must be
installed (`corepack enable`).

### 3.2 Static export specifics

- `next.config.ts` has `output: 'export'` and `images.unoptimized: true`.
- Public pages fetch events from the API at build time. The client re-fetches the live table count
  after hydration so "Open · N left" is current.
- Every authenticated route is a client component tree under a shared `<AuthGate>`; there is no
  server session. Tokens live in memory plus a refresh token in secure storage.
- Dynamic routes (`/events/[slug]`) use `generateStaticParams` from the events API.
- Publishing or editing an event in admin calls a `POST /admin/site/rebuild` route which fires a
  GitHub `repository_dispatch`. The admin UI shows "changes go live in about 5 minutes."
- CloudFront serves `index.html` for directory paths and a custom 404 page. An Open Graph fallback
  via CloudFront Functions is a later option if unbuilt event links become a problem.

### 3.3 Roles and permissions

Cognito groups: `attendee`, `vendor_applicant`, `vendor`, `staff`, `superadmin`. One
`can(user, action, resource)` function in `services/api/lib/permissions.ts` is the only place roles
are checked. Every handler calls it.

### 3.4 Data model (DynamoDB single table `fgg-{stage}`)

`PK`/`SK` plus `GSI1PK`/`GSI1SK`. TTL attribute `ttl` on holds and one-time tokens. Key shapes:

Event, venue and vendor IDs are ULIDs. Slugs are attributes with an index for URL lookup, so a
rename never re-keys. Everything a user earns is keyed by their Cognito sub.

| Entity                                 | PK                 | SK                                                        | GSI1                                                                |
| -------------------------------------- | ------------------ | --------------------------------------------------------- | ------------------------------------------------------------------- |
| User                                   | `USER#sub`         | `META`                                                    | `EMAIL#email` / `USER#sub` (lookup by email)                        |
| User list entry (admin paging)         | `USER#sub`         | `META`                                                    | also `GSI2PK = USERS#<shard 0-9>` / `createdAt`                     |
| XP total, badges, saved events         | `USER#sub`         | `STATS` / `BADGE#id` / `SAVED#eventId`                    |                                                                     |
| Per-event XP total                     | `USER#sub`         | `EVENTXP#eventId`                                         | (future leaderboard index)                                          |
| XP transaction / scan                  | `USER#sub`         | `XP#ts#scanId`                                            | `EVENT#eventId` / `XP#ts` (per-event audit, check-in list)          |
| Vendor                                 | `VENDOR#id`        | `META`                                                    | `VENDORS#status` / `businessName`                                   |
| Vendor member                          | `VENDOR#id`        | `MEMBER#sub`                                              | `USER#sub` / `VENDOR#id` (my vendor)                                |
| Vendor application                     | `USER#sub`         | `VENDORAPP`                                               | `VENDORAPPS#status` / `ts` (review queue)                           |
| Event                                  | `EVENT#id`         | `META`                                                    | `EVENTS#published` / `startsAt` (list); `SLUG#slug` on GSI2         |
| Event day                              | `EVENT#id`         | `DAY#date`                                                |                                                                     |
| Price window (early bird etc.)         | `EVENT#id`         | `PRICE#kind#startsAt`                                     |                                                                     |
| Ticket type                            | `EVENT#id`         | `TICKETTYPE#id`                                           |                                                                     |
| Venue + floor plan                     | `VENUE#id`         | `META` / `FLOORPLAN`                                      |                                                                     |
| Table hold                             | `EVENT#id`         | `HOLD#date#tableId`                                       | `VENDOR#id` / `HOLD#...` (my holds). `ttl` set.                     |
| Order (table booking or tickets)       | `EVENT#id`         | `ORDER#id`                                                | `OWNER#vendorId or sub` / `ORDER#startsAt`; `ORDERS#status` on GSI2 |
| Order history                          | `EVENT#id`         | `ORDER#id#HIST#ts`                                        |                                                                     |
| Booked table (one per day)             | `EVENT#id`         | `TABLE#date#tableId`                                      |                                                                     |
| Issued ticket (one per seat)           | `EVENT#id`         | `TICKET#id`                                               | `USER#sub` / `TICKET#eventId` (my tickets)                          |
| Counters (pass numbers, sold counts)   | `EVENT#id`         | `COUNTER`                                                 |                                                                     |
| Waitlist / notify-me                   | `EVENT#id`         | `WAIT#ts#email` / `NOTIFY#sub`                            |                                                                     |
| Subscriber / contact submission        | `LIST` / `CONTACT` | `SUB#email` / `MSG#ts`                                    |                                                                     |
| Gallery item                           | `GALLERY`          | `ITEM#eventId#sort`                                       | `EVENT#eventId` / `GALLERY#sort`                                    |
| Partner, activity, level, badge config | `CONFIG`           | `PARTNER#sort` / `ACTIVITY#sort` / `LEVEL#n` / `BADGE#id` |                                                                     |
| Settings                               | `CONFIG`           | `SETTINGS`                                                |                                                                     |

Two GSIs from the start: `GSI1` for owner lookups, `GSI2` for admin list and status views.

**Pricing resolution.** An event has a base table rate, a PokéBucks rate, and zero or more
`PRICE#` windows (e.g. `early_bird` until a date, with its own rates). The floor plan may mark
tables with a `priceOverride` or `premiumDelta`. Ticket types carry their own price and windows.
The server resolves the price at **hold creation** (or cart creation for tickets), stores the
resolved amount and the inputs on the hold/order, and never recomputes it, so an early-bird window
closing mid-checkout does not change what the vendor pays.

**Race safety.** A hold is a `TransactWriteItems` that puts one `HOLD#date#tableId` item **per
chosen day** with `attribute_not_exists(PK)` conditions, and checks that no `TABLE#date#tableId`
exists for those days. Any conflict fails the whole transaction, so a vendor never holds Saturday
without Sunday. DynamoDB TTL is best-effort (can lag), so reads also treat a hold with
`expiresAt < now` as free. Ticket caps use the same pattern with a conditional `ADD` on the
`COUNTER` item (`sold < capacity`).

**Orders generalized.** `ORDER` has `kind: vendor_table | ticket`, `source: shopify | manual`,
`amount`, `status: pending_payment | paid | refunded | cancelled | conflict`, and a `lines[]`
array. Free tickets are `source: manual, amount: 0` orders that skip Shopify and go straight to
`paid`. Comped tables created by staff work the same way. One webhook handler serves every kind.

**Scans.** The mobile app generates `scanId` (ULID) client-side before calling the API, and the
XP write is conditional on that ID not existing. Replays and a future offline queue are both safe.

**Deletion.** Deleting a user removes the whole `USER#sub` partition in one query; orders, tickets
and XP audit rows under `EVENT#` are anonymized (owner replaced with `DELETED`), not removed.

### 3.5 Booking flow end to end

1. `GET /events/{id}/availability` returns, per day, the set of taken and held table IDs.
2. Vendor picks days, then a table. `POST /events/{id}/holds` runs the transaction above and returns
   a `holdId` with a 10-minute `expiresAt`. The picker shows the countdown.
3. The Pay step saves the vendor info (prefilled from the profile, editable in place) to the hold right before checkout. Rate choice (standard / PokéBucks) is stored on the hold.
4. `POST /holds/{id}/checkout`:
   - extends the hold to 30 minutes;
   - creates a Shopify draft order: one custom line item titled
     `"{Event} · Table {id} · {days}"`, `price = days × rate`, `taxable: false`,
     `requires_shipping: false`, customer email, note attributes `orderId`, `holdId`, `eventId`;
   - stores the draft order ID on an `ORDER#id` item (`kind: vendor_table`) with
     `status: pending_payment` and the price resolved at hold time;
   - returns the draft's `invoice_url`; the web app redirects.
5. Shopify `orders/paid` webhook → Lambda verifies HMAC, reads `orderId` from note attributes, and
   in one transaction: writes `TABLE#date#tableId` for each day, deletes the holds, sets the order
   `paid` with `shopifyOrderId` and a `passNumber` from the event `COUNTER`. Sends the SES receipt.
   Idempotent on Shopify order ID. The same handler serves ticket orders (writes `TICKET#` items
   instead of tables).
   If the holds have expired **and** another vendor now owns any of the days, the Lambda marks the
   order `conflict`, issues a Shopify refund, and emails both the vendor and staff.
6. Shopify redirects to `/vendor/orders/{id}/done`, which polls the order until it reads `paid`
   (the webhook usually lands before the redirect). Confirmation page renders the vendor pass, `.ics`
   and receipt PDF (generated by a Lambda, cached in S3).
7. `refunds/create` webhook sets `refunded` and frees the table days (or voids the tickets).

**Tickets (after the vendor flow ships).** `POST /events/{id}/tickets/orders` with a ticket type
and quantity. Free types create a `paid` manual order at once; paid types create a draft order and
redirect exactly like tables. Each paid seat becomes a `TICKET#id` with a signed QR that staff scan
for check-in, which awards the check-in XP through the normal scan path.

Shopify setup needed from the store owner: a custom app with `write_draft_orders`, `read_orders`,
`write_orders` (for refunds) scopes, the Admin API token, and the webhook signing secret. Both go in
Secrets Manager under `fgg/{stage}/shopify`.

### 3.5a Vendor approval pipeline (swappable)

`Settings.vendorApprovalMode` is `manual_call` (launch) or `auto_video_terms`. The application
record always captures the same evidence regardless of mode: `videoWatchedAt`, `termsAcceptedAt`,
`callScheduledAt`, `callScheduledVia`. Statuses: `submitted → call_scheduled → approved | rejected`
in manual mode; `submitted → approved` in auto mode once video and terms are recorded.

- **manual_call**: after submit, the pending screen embeds Calendly (URL from settings). An
  optional Calendly `invitee.created` webhook marks `call_scheduled`; staff can also set it by hand.
  Staff approve in the admin review queue. Approval creates the `VENDOR#` record, adds the applicant
  as first member, moves the Cognito group, and sends the SES email.
- **auto_video_terms**: the application form requires the video to be watched (player "ended" event
  plus a minimum watch time) and terms accepted; on submit the same `approve()` function runs
  automatically with `reviewedBy: system`. Staff can still reject afterwards, which demotes the
  vendor and cancels unpaid orders.
- One `approve(applicationId, reviewer)` function is used by both paths, so switching modes is a
  settings change and a form tweak.

### 3.6 Mobile app (fresh)

Expo SDK 54+ with `expo-router`. Screens at launch: sign in/up, events list and detail (same API),
attendee profile with level ring and badges, saved events, vendor passes, and staff tools
(scan check-in, challenge and raffle QR codes to award XP; view vendor pass). Staff scanning reuses
the signed-ticket idea: the attendee app shows a short-lived signed QR, staff scan it, the API verifies
and awards XP once. Design tokens come from `packages/tokens` as an RN theme object. EAS Build and
EAS Update with a channel per stage.

### 3.7 CI/CD

- `ci.yml` on every PR: install, lint, typecheck, test, `cdk synth`, `cdk diff` as a PR comment.
  `turbo --filter=...[origin/main]` limits work to what changed.
- `deploy.yml`: push to `main` → `cdk deploy` all `*-dev` stacks, then build and sync the web app to
  the dev bucket. Prod runs on manual approval via a GitHub Environment with a required reviewer.
- `rebuild-site.yml`: triggered by `repository_dispatch` from the admin publish action; builds the
  web app against the given stage and syncs it.
- `mobile.yml`: EAS Build on release tags, EAS Update on `main`.
- AWS access via GitHub OIDC with one deploy role. No long-lived keys.

## 4. Build phases

Each phase ends with something demoable on dev. Estimates are working days for one developer with
Claude Code, and are rough.

### Phase 0: Skeleton (1–2 days) — **done 2026-10-01** on branch `phase-0/skeleton`

Deployed to dev (account 077536487082, us-east-1): `Fgg-GithubOidc` (role `fgg-github-deploy`),
`Fgg-dev-Auth` (pool `us-east-1_ZDZ78wXWg`), `Fgg-dev-Data` (table `fgg-dev`, bucket
`fgg-media-dev-077536487082`). Remaining GitHub setup needs the `mlipshultz` account in `gh`: open
the PR, set repo variable `AWS_DEPLOY_ROLE_ARN`, create `dev`/`prod` environments (prod with a
required reviewer), protect `main`.

- pnpm + Turborepo workspace, shared `tsconfig`, ESLint, Prettier, Vitest.
- `packages/tokens` from handoff §7 with Style Dictionary; CSS variables and RN theme output; a
  sample web page and a sample RN screen proving the tokens render.
- `packages/types` with the zod schemas from §3.4.
- `infra` CDK app with `AuthStack` and `DataStack` for `dev`; GitHub OIDC role; `ci.yml` and
  `deploy.yml` deploying to dev. Branch protection on `main`.

### Phase 1: Public site (4–6 days) — **built 2026-10-01** on branch `phase-1/public-site`

Deployed to dev: `Fgg-dev-Media` (bucket `fgg-media-dev-…`, CloudFront), `Fgg-dev-Web` (bucket
`fgg-web-dev-…`, CloudFront with clean-URL function), `Fgg-dev-Api` (HTTP API, one public Lambda).
Dev table and media bucket are seeded with the canvas placeholder content (`pnpm --filter @fgg/api
seed:dev`). Notes: the API is API Gateway **HTTP API** (v2), not REST, for cost and the built-in JWT
authorizer. The media bucket lives in MediaStack, not DataStack, because the OAC bucket policy
references the distribution. `tablesLeft` counts distinct tables with at least one open day. Contact
email via SES and the Supabase seed are deferred until an SES identity and the service key exist.

- `ApiStack` with the events, venues, partners, activities, gallery, subscribe and contact routes.
- `WebStack`: S3 + CloudFront + ACM for the dev domain, static export pipeline, rebuild dispatch.
- Homepage per handoff §5.2 pixel-matched: header, hero, calendar with Month/List, 3b event cards,
  activities band, accounts teaser, partners, get involved, past-events teaser, email band, footer.
- Contact form (§5.6) and gallery with lightbox (§5.7).
- Seed script that pulls events and gallery from the live Supabase project into dev.

### Phase 2: Accounts (3–4 days) — **built 2026-10-01** on branch `phase-2/accounts`

Deployed to dev: `Fgg-dev-Auth` recreated (pool `us-east-1_cHtHWz1Ml`) with pre-signup (13+ gate)
and post-confirmation (user record + `attendee` group) triggers and the Google identity provider
from Secrets Manager `fgg/google-sso`; `Fgg-dev-Api` recreated with a JWT authorizer and the
account Lambda (`/me/*`, `/admin/*`). `birthdate` is optional at the pool level because Google can't
supply it; the trigger and client enforce the gate. Admin role changes go through Cognito groups and
`/me` writes token roles back to the stored record. Web: login, signup, verify, forgot/reset, Google
callback, dashboard (2c), admin users, header user menu, hearts on event cards, legal placeholders.
Verified end to end on dev with a real sign-up, login, save/unsave and the admin page. Not built:
display-name editing UI, Google redirect URI registration in Google Cloud (Matt's action).

- Sign up / in / reset with Cognito (email + Google), 13+ age gate at sign-up.
- Attendee dashboard (§5.5) reading XP, badges and saved events from the API. `packages/game`
  with the placeholder level curve and badge catalog.
- Permission layer and admin scaffolding (staff-only routes, user list, role assignment).

### Phase 3: Vendor booking (6–8 days) — **built 2026-10-01** on branch `phase-3/vendor-booking`

Shopify: the API is the Shopify app. `GET /shopify/install` → OAuth → `/shopify/callback` stores
the Admin token in `fgg/{stage}/shopify`; `POST /admin/shopify/register-webhooks` (superadmin)
subscribes `orders/paid` and `refunds/create` to `/webhooks/shopify`. Dev uses the development
store `fgg-dev.myshopify.com` (Grow plan preview, test gateway). Draft orders are created with the
GraphQL Admin API; the paid webhook finalizes tables, pass number and order in one transaction and
refunds on conflict. Orders live at `ORDER#id/META` with an `EVENT#id/ORDER#id` pointer and a
`SHOPIFYORDER#id` reverse lookup. A vendor's new hold replaces their previous hold for that event.
Verified on dev: application → approve → quote → hold → vendor info → checkout produced a draft
order whose invoice renders in Shopify checkout with our attributes; the test payment itself was
left to Matt (auto mode blocks transactions), after which the paid webhook path is confirmed.
Ops: `infra/scripts/dev-token.sh` mints an ID token via the IAM-gated admin auth flow.
2026-10-02: vendor profile (`GET/PATCH /vendor/profile`, logo via presigned S3 PUT to
`vendors/{id}/`, resized in the browser) prefills the info card on the Pay step; "about your store" is free
text everywhere (application, profile, per-order); `GET /public/events/{id}/vendors` powers the
public `/events/{slug}/` "who's vending" page, fetched at runtime so it needs no rebuild.
Multi-table picker (same day): a vendor books up to 10 tables in one order. The map is a cart
(tap to add/remove); every table defaults to all event days and days are adjusted per table in
the panel. Per-day availability is drawn with stripes (one colour + line direction per day: aqua
"/" Sat, yellow "\\" Sun, pink "—" for a third day), plain = open every day, grey = taken; the
day chips above the map filter by dimming and double as the legend. `QuoteInput`/`Quote`,
`TableHold` and the hold items are per table (`lines`/`tables`); orders already carried a list of
lines, so passes, receipts and the public vendor list just iterate them.
Not built: SES emails, PokéBucks toggle endpoint, QR on the vendor pass (Phase 5), tests in web.

- Vendor application form, Calendly pending screen, review queue in admin, approval that creates
  the `VENDOR#` record, adds the applicant as its first member, moves the Cognito group and emails.
  Approval mode switch per §3.5a, with the auto path stubbed behind the setting.
- Price windows and per-table overrides; price resolution at hold time.
- Availability API, race-safe per-day holds with TTL, floor plan seeded for the first venue.
- Table picker (4a/4b) with day selection, vendor info, checkout handoff, confirmation, pass PDF
  and `.ics`.
- Shopify draft order creation, `orders/paid` and `refunds/create` webhooks, conflict handling.
- Vendor dashboard (§5.4). Waitlist and Notify-me capture.

### Phase 3b: Attendee tickets (2–3 days, can follow Phase 5)

- Ticket types per event (free and paid, capacity, price windows), order flow reusing the Shopify
  path, `TICKET#` issuance with signed QR, "My tickets" on web and mobile, check-in scan.

### Phase 4: Admin console (3–4 days)

- Events CRUD with publish → rebuild, venues and floor plan JSON editor, orders list with
  refund and manual/comp order actions, vendor list with member management, vendor applications,
  gallery upload with resize Lambda, partners, settings (fee, tax, hold minutes), XP/badge config.

### Phase 5: Mobile (5–7 days)

- Expo app shell, auth, events, profile, saved events, vendor passes.
- Staff scanning with signed QR tickets and XP award; challenge and raffle scans.
- EAS Build to TestFlight and Play internal testing.

### Phase 6: Cutover (2–3 days)

- Prod stacks, secrets, SES production access and domain verification, Cognito hosted-UI domain,
  final Supabase user export (Cognito import with forced password reset emails), Klaviyo list check,
  DNS flip, redirects for retired URLs (`/halloween-fest`, `/supernova`, `/vendor-info`, `/shop`,
  `/poke-mart`, `/news/*`, `/collect-a-thon`, `/custom-mat`, `/stream`, `/vendor-video`,
  `/[username]`) via a CloudFront Function.

## 5. Migration from the live site

- **Users**: export `auth.users` + `profiles` from Supabase, import to Cognito via CSV user import
  (no passwords transfer, users get a reset email). Role `admin` maps to `staff` or `superadmin`.
- **Events**: map `events` rows to the new `Event` shape; `venue_name`/`venue_address` become
  `Venue` records.
- **Vendors**: every vendor who bought a table on the live site (`crm_vendors` with an order) is
  imported as an approved `VENDOR#` record with its owner member linked by email, so returning
  vendors skip the application and the call. Remaining `vendor_inquiries` become
  `VendorApplication` rows with `status: submitted`.
- **Gallery/news**: Supabase Storage objects copied to the media bucket; news is out of scope unless
  wanted (the new design has no news section).
- **Subscribers**: Klaviyo list is the source of truth; not migrated, just kept.

## 6. Still needed from you

Not blocking Phase 0–1, but needed before the phase that uses them.

1. Shopify custom app credentials and the Calendly event link (Phase 3).
2. DNS provider access and the dev/prod hostnames (Phase 1 for dev, Phase 6 for prod).
3. Supabase service-role key for the migration script (Phase 1 seed).
4. Google OAuth client for the new Cognito pool (Phase 2).
5. Legal copy, Discord invite, social handles, contact email, partner logos (Phase 1, placeholders
   until then).
6. Apple Developer account for TestFlight (Phase 5).
7. Confirmation of the assumptions in §2, especially email (SES + Klaviyo) and rewards.
