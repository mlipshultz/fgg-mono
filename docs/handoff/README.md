# Handoff: FeelGoodGaming.com (FGG) — Website, Vendor Booking & Accounts

> **Status: READY TO START.** Core decisions are made (§0A). Items in §0B can be built with placeholders or stubs and decided during the build.

---

## 0A. Decisions Made

| Topic | Decision |
|---|---|
| Minimum age | Account holders must be **13+**. Under-13s either participate through a **parent's account** (child profiles under the parent) or have their own profile created **with parental approval** (parent approves via email link; profile is owned/managed by the parent). |
| Brand names | Keep "PokéBucks" and "PokéPets" for now (revisit before public launch). |
| Payments | **Shopify** handles checkout and payments. **No sales tax and no processing fee** for now. Keep fee/tax as configurable settings (default 0) so they can be switched on later without a code change. |
| Mobile | **React Native** app for **iOS and Android**, sharing the AWS backend and design tokens with the web. |
| Staff scanning | There is no separate staff app. Staff sign in to the **same mobile app**, and their role unlocks the admin tools: scanning check-ins, challenges and raffles, and viewing vendor passes. |
| Event cards | **3b**: poster on the left, mini calendar tile top-right. This replaces the ticket-stub cards shown in 2a/2b. |
| XP & badges | Use **placeholder** values and badge art from the designs. Everything is data-driven (config tables), so the real values can be dropped in later. |
| Account types | Attendee, Vendor (approval required), Staff; Super Admin is optional/TBD. See §0C. |

## 0B. Still Open (can build with placeholders)
1. **Rewards.** Rewards were removed from the attendee dashboard (2c). Do they exist at launch, and where are they redeemed?
2. **Missing designs** (not on the canvas yet):
   - Phone layouts for the vendor dashboard, attendee dashboard, booking steps 2–4, contact form and gallery. Follow the responsive rules in §6 until they exist.
   - **Vendor application form** and its pending, approved and rejected states.
   - Parent/child profile management and the parental-approval email.
   - Staff scanning screens in the app.
   - Admin console.
3. **Legal text:** terms, privacy policy (including the under-13 rules), vendor code of conduct, refund policy (the designs say a full refund up to 14 days before the show), and photo consent for the gallery.
4. **Vendor pricing rules:**
   - Can a vendor book more than one table per event?
   - Is there a cap on PokéBucks partners per event?
   - Is PokéBucks partner status part of the approval review, or a separate opt-in?
   - How are no-shows handled?
5. **Real content:** event dates and venues, Discord invite link, social handles, contact email, partner logos, hero video, gallery media.
6. **Floor plans** per venue (recommended: editable by staff in the admin tool), how long a table is held during checkout (designed as 10 min), and how the waitlist works.
7. **Email:** Amazon SES with FGG's own list, or a marketing tool (Shopify Email, Klaviyo, Mailchimp)? Double opt-in?
8. **Media hosting:** S3 + CloudFront, or YouTube/Vimeo embeds?
9. Also open:
   - Analytics.
   - Accessibility target (recommend WCAG 2.2 AA).
   - Domain/DNS.
   - Whether a Super Admin role is needed.

## 0C. Account Types & Permissions

| Role | How you get it | Can do |
|---|---|---|
| **Attendee** (default) | Self sign-up, 13+ | Profile, level/XP/badges, save events, manage child profiles (if a parent) |
| **Child profile** (under 13) | Created under a parent account or approved by a parent | Earns XP/badges; can't log in on its own unless the parent allows it (TBD); the parent sees and controls everything |
| **Vendor applicant** | Attendee submits a vendor application | Sees application status only; **cannot book tables** |
| **Vendor** (approved) | Staff/admin approves the application | Book and pay for tables, vendor dashboard, receipts, PokéBucks opt-in |
| **Staff** | Assigned by an admin | Admin tools in the mobile app and web: scan check-ins/challenges/raffles (awards XP), view vendor passes, review vendor applications, manage events and registration status |
| **Super Admin** (TBD) | Assigned by the owner | Everything a staff member can do, plus manage staff roles, refunds, pricing/fee/tax settings, and XP/badge config |

Implementation:
- Put each role in a **Cognito group** (`attendee`, `vendor_applicant`, `vendor`, `staff`, `superadmin`).
- Check groups on every API route; don't rely on hiding things in the UI.
- Vendor approval moves the user from `vendor_applicant` to `vendor`, then emails them.
- Keep the permission logic in one place so a Super Admin role can be added or merged into Staff later without rework.

**Change to the booking flow:** "Book & Pay Now" on an Open event card works like this:
- **Approved vendor:** goes straight to the table picker.
- **Signed out:** log in or create an account, then apply.
- **Applicant:** "Application pending" message, with no booking.
- **Everyone else:** the vendor application form.

---

## 1. Overview

A family-friendly marketing site + transactional app for FGG's gaming and trading card events. Primary jobs, in priority order:
1. Show **upcoming events** instantly (calendar + cards).
2. Let **vendors book and pay for a table** (floor-plan picker → info → payment → confirmation).
3. **Attendee accounts** with levels, XP, badges and saved events; **vendor accounts** with bookings, receipts and payment status.
4. Secondary: activities, partners, get involved (Discord + contact form), past-events gallery, email signup.

## 2. Platform Requirements

### Backend: AWS
Build the backend on **AWS**. Recommended architecture (adjust as needed):

| Concern | Service |
|---|---|
| Web hosting | AWS Amplify Hosting (Next.js SSR) or S3 + CloudFront |
| Auth | **Amazon Cognito** user pools. Groups per §0C: `attendee`, `vendor_applicant`, `vendor`, `staff`, `superadmin`. Email + Google/Apple sign-in. The same pool is used by the mobile app. |
| API | API Gateway (REST) + Lambda (TypeScript), **or** AppSync (GraphQL). Either way, **one API shared by web and mobile**. |
| Data | DynamoDB (single-table), or Aurora Serverless Postgres if relational reporting matters. Table holds need conditional writes / transactions. |
| Table holds | Hold record with TTL + EventBridge Scheduler to release expired holds (holds must be race-safe). |
| Payments | **Shopify.** Create a draft order or cart for the held table, then send the vendor to Shopify Checkout. Shopify's `orders/paid` and `refunds/create` webhooks go to API Gateway → Lambda (verify the HMAC signature), which marks the booking `paid` or `refunded`. Store the Shopify order ID on the booking. Receipts come from Shopify order confirmations or an SES email. Tax and fees are off for now. |
| Email | Amazon SES (booking receipts, confirmations, list emails) |
| Media | S3 + CloudFront; MediaConvert for gallery/hero video |
| IaC | **AWS CDK (TypeScript)**, decided; deployed via GitHub Actions (§2A) |
| Observability | CloudWatch logs/alarms |

### Companion mobile app
A **companion FGG mobile app will share the same AWS backend (Cognito, API, data) and the same visual styling**. Implications for this build:
- The API must be client-agnostic: no web-only session assumptions; use Cognito JWTs.
- **Design tokens** (§7) must live in one platform-neutral source, e.g. `tokens.json` → Style Dictionary. Generate CSS variables for web and a theme object for mobile. Don't hard-code the token values in web CSS.
- Put shared TypeScript types / API client in a package both apps import (monorepo recommended).
- The "syncs with the FGG mobile app" notes in the UI refer to this. Level, XP, badges, saved events, vendor passes and receipts must all come from the shared backend.

## 2A. Repository & Deployment (decided)

The repo is named **`fgg-mono`**, to avoid clashing with the legacy local `fgg` project. **One GitHub monorepo** holds the website, the mobile app, the backend and the infrastructure. **AWS CDK** handles all deploys and **GitHub Actions** runs CI/CD.

```
fgg-mono/
  apps/
    web/          Next.js (TypeScript): public site, accounts, booking, admin console
    mobile/       Expo / React Native: iOS + Android; staff tools behind role checks
  packages/
    tokens/       design tokens (§7) → CSS variables (web) + RN theme (mobile), via Style Dictionary
    types/        shared TS models (Event, Booking, Profile, VendorApplication…)
    api-client/   typed client for the AWS API (used by web + mobile)
    game/         XP / level / badge rules + placeholder configs
  services/
    api/          Lambda handlers: events, bookings/holds, vendor applications, Shopify webhooks, XP scans
  infra/          AWS CDK app (TypeScript): stacks for Auth, Data, Api, Web, Media, Email
  docs/           this README + design canvas
```

**Tooling**
- **pnpm workspaces + Turborepo.** Every package uses TypeScript strict mode, ESLint and Prettier.
- **Tests:** Vitest for packages and services, Playwright for web end-to-end tests, Jest + React Native Testing Library for mobile.

**CDK**
- **Stacks:**
  - `AuthStack`: Cognito pool and the groups from §0C.
  - `DataStack`: DynamoDB and S3.
  - `ApiStack`: API Gateway + Lambda, and the Shopify webhook endpoint.
  - `WebStack`: Next.js on Amplify Hosting, or OpenNext on Lambda + CloudFront via CDK.
  - `MediaStack`: CloudFront + MediaConvert.
  - `EmailStack`: SES.
- **Environments:** **`dev` and `prod` only**, each in its **own AWS account** (AWS Organizations). The stage is passed as CDK context.
- **Secrets:** the Shopify API/webhook secret and similar go in AWS Secrets Manager, never in the repo.
- The CDK outputs (API URL, Cognito IDs) feed both apps' environment config.

**GitHub Actions**
- **`ci.yml`** (every pull request): install, lint, typecheck, test, and `cdk synth` + `cdk diff` posted as a PR comment. Use `turbo --filter` to test only what changed.
- **`deploy.yml`:**
  - A push to `main` runs `cdk deploy` to **dev** automatically.
  - Production deploys run on a manual approval (a GitHub Environment with required reviewers), or on a release tag.
  - AWS access uses **GitHub OIDC**, with a deploy role per account and no long-lived keys.
- **`mobile.yml`:** EAS Build for iOS/Android on release tags, then EAS Submit to TestFlight and Play internal testing. JS-only fixes ship through EAS Update, with a channel per environment.
- **Branch protection on `main`:** changes land through pull requests, and CI must pass.

**First tasks for Claude Code**
1. Set up the monorepo skeleton, Turborepo, and shared tsconfig/eslint.
2. Build `packages/tokens` from §7 and check the output on a sample web page and a sample RN screen.
3. Create the CDK `AuthStack` and `DataStack` and the GHA OIDC deploy to dev.
4. Build the Events API and the web homepage with the calendar and 3b event cards.
5. Build the vendor application, approval, table picker (race-safe holds) and Shopify checkout.
6. Build the attendee dashboard and the mobile app shell with sign-in and staff scanning.

## 3. About the Design Files
`FGG Site.dc.html` is a **design reference built in HTML**: a canvas of mockups showing intended look and behavior, **not production code**. Recreate these designs in the target stack. Recommended: Next.js + TypeScript for web; mobile is **React Native (iOS + Android)**. All code lives in one monorepo (§2A). Open the HTML file in a browser to view it; `support.js` is only its viewer runtime and is not part of the product.

The canvas is organized in "turns"; the newest turn is at the top, and later turns override earlier ones:

- **Turn 4:** table picker, 4a desktop / 4b phone. **Final.**
- **Turn 3:** event card variations 3a/3b/3c. **Decision pending** (§0.1).
- **Turn 2:** homepage 2a desktop / 2b phone. **Final layout.** Attendee dashboard 2c. **Final.**
- **Turn 1:** earlier exploration. Still the reference for:
  - 1l: booking steps 2–4 (vendor info, payment, confirmation).
  - 1m: vendor dashboard.
  - 1n: contact form + email success state.
  - 1o: past events gallery + lightbox.
  - 1a–1k and 1g–1i are superseded.

## 4. Fidelity
**High-fidelity.** Colors, type, radii, borders and shadows are final. Copy is close to final, but data, venues and dates are placeholders. Match the look pixel-for-pixel, using the codebase's own component patterns.

## 5. Screens

### 5.1 Global header (sticky)
- Height ~72px; background `#FFFDF7` at 94% opacity; bottom border 2px `#141414`; padding 14px 48px.
- Left: logo 44×44 + "Feel Good Gaming" (Fredoka 700, 22px).
- Center nav (Nunito 800, 15px, gap 28px): Events, Activities, Past Events, Partners, Get Involved.
- Right: "Log In" text link, then an **"Upcoming Events"** pill button (yellow `#FFE15A`, 2px ink border, 3px 3px 0 ink shadow).
- **Phone (<768px):** logo + "FGG", a compact "Events" pill and a 44×44 hamburger opening a full-screen menu.

### 5.2 Homepage (2a desktop 1280, 2b phone 390)
In order:
1. **Hero:** yellow `#FFE15A` panel with decorative aqua and pink circles (50–55% opacity) partly off-canvas.
   - "NEXT UP" badge: white pill with a pink inner pill, links to the next event's card.
   - H1 "The feel-good card & gaming fest": Fredoka 700, 84px (phone 44px), line-height .98, letter-spacing −2px.
   - Tagline: Nunito 600, 22px.
   - CTAs: **See Upcoming Events** (pink `#FF7EB9`, primary) and **Become a Vendor** (white).
   - A row of date chips, one per upcoming event, each linking to its card.
   - Below that, a 340px-tall autoplay muted video panel with 28px top corners. It's a placeholder. Respect `prefers-reduced-motion` by showing a poster frame instead.
2. **Calendar:** month grid (7 columns, 78px cells, 14px radius) inside a white card with a 6px 6px 0 aqua shadow. Event days are pink with the event name. Clicking one smooth-scrolls to and highlights that event's card.
   - Header has ‹ › month buttons and a **Month / List** toggle. Phone defaults to List.
   - Right rail lists the next 5 shows.
3. **Event cards: use 3b.** One card per row (max width 1000px), stacked. Each card is a grid with a **400px poster column** on the left and the content on the right. The poster shows uncropped (`object-fit: contain`), with a blurred copy behind it; if an event has no poster, show a striped placeholder. The content column has the name (Fredoka 28px) with a **62px mini calendar tile** top-right. The tile has a colored month strip (rotating pink/aqua/yellow), the day range (Fredoka 18px) and the year, with a 2px ink border and 12px radius. Below the name: venue · city, then full dates · hours, then the blurb. The footer has a dashed top border and wraps if needed; the status pill and buttons never break across lines. Card shadow is 6px 6px 0 yellow. On phones, stack the poster above the content, full width.
   - *(Superseded: the ticket-stub 1e cards shown in 2a/2b.)*
   - Footer details for 3b:
   - 150px date stub in a rotating pink/aqua/yellow fill, with a dashed right edge and half-circle notches.
   - Body: name (Fredoka 28px), venue · city · hours, blurb.
   - Footer: "Vendor tables" + status pill:
     - **Open** (aqua `#33EEDC`): "Open · N left" + a black "Book & Pay Now" button.
     - **Closed** (`#E8E4DA`): outline "Join waitlist" button.
     - **Coming Soon** (yellow): outline "Notify me" button.
   - A dashed "More 2027 dates soon" tile links to the email signup.
4. **Classic FGG activities:** aqua band, 3-column grid of white tiles. Each has a 56px icon square, a name, a one-line description and an "+XP" chip. The data drives the grid, so new activities can be added freely. Activities:
   - Find 'Em All
   - Art Station
   - PokéPets (see §0.5)
   - Cards for Cans
   - Trading
   - Gaming & Tournaments
5. **Accounts teaser:** two cards.
   - Attendee (pink shadow, XP bar) and Vendor (aqua shadow), each with bullets and a black CTA.
   - Below: a dashed "Coming soon: your account syncs with the FGG mobile app" pill.
6. **Partners:** centered, wrapping row of 200×96 logo tiles, plus a dashed "Become a Partner →" tile. Looks right with 2–3 logos and grows by wrapping.
7. **Get involved:** two cards.
   - Volunteer (yellow): "Join the FGG Discord" button → Discord.
   - Partner with us (pink): "Contact us" button → contact form (1n).
8. **Past events teaser:** mosaic of 1 large tile + 4 small tiles (photo, video, quote), with a "See the full gallery" link.
9. **Email band:** black `#141414` block, radius 30px. Email field + yellow "Join the List" button. Success state shown in 1n: aqua check, "You're on the list!", plus follow-up CTAs.
10. **Footer:** logo, blurb, email, 5 round social buttons (Discord, IG, TikTok, YouTube, Facebook), 3 link columns, © line.

### 5.3 Vendor booking flow
1. **Table picker (4a/4b).** Header shows a 4-step progress bar (Table, Info, Pay, Done).
   - **Floor plan** in a white card with a yellow offset shadow:
     - Stage bar at the top.
     - Side zones: Art Station / PokéPets on the left, Kids Trading / Find 'Em All on the right.
     - Rows A–F in back-to-back pairs, 10 tables each, with a center cross-aisle after table 5.
     - Bottom: Entrance / Check-in bar.
   - **Table states:**
     - Available: white.
     - Selected: pink + 3px ink shadow.
     - Taken: `#E8E4DA` at 55% opacity, `not-allowed` cursor.
   - **Side panel** (sticky, aqua shadow):
     - Selected table and row.
     - "Nearby" text, derived from the table's zone.
     - Rate choice: Standard $200 / PokéBucks partner $100 (selected = aqua + ink shadow).
     - Price lines, total, and a "Hold {table} & continue →" button.
     - "We hold your table for 10 minutes…" note.
   - **Phone:** the map scrolls; a fixed bottom panel holds the selection, both rates as buttons and the CTA.
   - **No processing fee for now.** Drop the "Processing fee" line: the total equals the table price ($200, or $100 for PokéBucks partners). The mocks still show a fee; ignore it.
   - Only **approved vendors** reach this step (§0C).
   - Available count updates live. Holds must be race-safe on the server.
2. **Vendor info (1l step 2):**
   - Fields: business/table name, contact name, phone, email.
   - "What do you sell?" multi-select chips.
   - Code-of-conduct checkbox (required).
3. **Payment (1l step 3):**
   - Order summary with the event thumbnail.
   - Payment happens in **Shopify Checkout**. The on-site step is a summary + a "Continue to secure checkout" button that redirects to Shopify, which returns to the confirmation page on success. The card-form mock is only a visual reference for the summary.
   - No fee and no tax: the total equals the table price.
   - Refund-policy line.
4. **Confirmation (1l step 4):**
   - Aqua check circle and "You're booked!".
   - Vendor pass: event, table, load-in time, amount paid, pass number.
   - Buttons: Add to calendar (.ics) and Download receipt (PDF).
   - "Go to my vendor dashboard" button.
   - Upsell line for the PokéBucks program.

### 5.4 Vendor dashboard (1m)
- Header with a "VENDOR" tag.
- Headline "Your next show is in N days".
- PokéBucks partner status card.
- **Upcoming booked shows:** thumbnail, table, load-in time, Paid pill, "View pass" and "Receipt" links.
- **Quick register:** event mini-cards with status + action.
- **Payments card:** balance due, paid this year, card on file.
- **Vendor tips card.**
- **Booking history table:** event, date, table, amount, status pill, receipt PDF link.

### 5.5 Attendee dashboard (2c)
- **Hero card** (yellow shadow):
  - Level ring (conic gradient, aqua fill = % to next level) with a tilted title tag.
  - "N XP to Level X" and a striped XP bar showing "current / next".
  - Stats line: fests · badges · member since.
  - Yellow "Level X unlocks" panel.
- **Badges:** 12-column grid of 64px round badges. Earned badges are colored; locked ones are white at 50% opacity with "?".
- **Saved upcoming events:** 3 mini ticket cards (date stub, name, city, heart to unsave, countdown pill).
- Mobile-app sync note.
- **No challenges or tasks here.** Those happen on event day: staff award XP by scanning in the mobile app.
- **Placeholders:** XP values, level thresholds/titles and badges are placeholders (see §8, `Level`/`Badge` config).
- **Parents:** a profile switcher appears in the header when the account has child profiles.

### 5.6 Contact form (1n)
- Fields: Name, Organization, Email, "I'm interested in" chips, Message (textarea).
- "Send message" button.
- Validation: name, email and message are required, and email must be a valid format.
- Show an inline error below each field in `#D6478A`.
- On submit, show a success state in the same style as the email-signup success.

### 5.7 Past events gallery (1o)
- Filter chips by event, plus a "Videos only" toggle.
- 4-column grid of 200px rows with mixed spans (the featured item is 2×2 with a caption card). Items can be photos, videos (play button + duration), stat tiles or quote tiles.
- "Load more" button.
- **Lightbox:**
  - Dark 92% scrim; the image is shown at 20px radius.
  - Controls: ‹ › buttons (yellow circles), close ×, and a caption bar with event, index and Share.
  - Keyboard: ← → Esc.

## 6. Interactions & Responsive
- **Breakpoints:** ≥1200 desktop (as designed), 768–1199 tablet (2-column grids become 1–2, calendar stays), <768 phone (single column, calendar defaults to List, hamburger nav).
- **Buttons:**
  - Hover: translate(−1px, −1px) and grow the shadow by 1px.
  - Active: translate(2px, 2px), shadow removed ("pressed" feel).
  - Duration 120ms, ease-out.
- **Focus:** 3px `#2a78d6` outline, offset 2px, on every interactive element.
- **Links:** ink `#141414`, hover `#D6478A`.
- **Level-up moment** (not yet designed): when XP crosses a threshold, fill the bar to 100%, then show a confetti-free celebratory badge pop (scale 0.8→1.05→1, 400ms).
- **Tap targets:** at least 44px on phone.

## 7. Design Tokens (shared web + mobile)
```json
{
  "color": {
    "yellow": "#FFE15A", "aqua": "#33EEDC", "pink": "#FF7EB9", "pinkText": "#D6478A",
    "ink": "#141414", "paper": "#FFFDF7", "white": "#FFFFFF",
    "muted": "#5C5A55", "mutedDark": "#3A3830", "placeholder": "#8A867D",
    "line": "#EEEAE0", "dash": "#E8E4DA", "dashStrong": "#C9C4B8",
    "closed": "#E8E4DA", "videoBg": "#1B1A22", "success": "#0E8A7B", "focus": "#2A78D6"
  },
  "status": { "open": "aqua", "comingSoon": "yellow", "closed": "closed" },
  "font": { "display": "Fredoka (500/600/700)", "body": "Nunito (400/600/700/800/900)" },
  "type": {
    "hero": "700 84/0.98 display, -2px", "h2": "700 44/1.05 display, -0.5px",
    "cardTitle": "700 26-28/1.05 display", "body": "600 14-17/1.5 body",
    "eyebrow": "800 12-13 body, 0.12em, uppercase", "button": "800 15-17 body"
  },
  "radius": { "chip": 999, "input": 12, "tile": 14, "cardSm": 16, "card": 22, "cardLg": 24, "band": 30 },
  "border": { "default": "2px solid ink", "dashed": "2px dashed #E8E4DA" },
  "shadow": {
    "button": "3px 3px 0 ink", "buttonLg": "4px 4px 0 ink",
    "card": "6px 6px 0 {yellow|aqua|pink}", "sheet": "0 -6px 20px rgba(0,0,0,.08)"
  },
  "space": [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28, 32, 40, 48, 80, 90]
}
```
Design language: 2px ink outlines + hard offset "sticker" shadows on interactive and hero elements only. Keep everything else flat, with lots of white space. Only original art and icons; the glyph icons in the mock (★ ◆ ● ▲ ⇄ ⚑) are placeholders for a custom icon set.

## 8. Suggested Data Model
- `User` (Cognito sub, role).
- `ChildProfile` (parentUserId, displayName, birthYear, approvedAt, approvalMethod).
- `VendorApplication` (userId, business, sells[], status: pending/approved/rejected, reviewedBy, reviewedAt, notes).
- `Vendor` (business, contact, sells[], pokeBucksPartner).
- `Event` (name, dates, hours, venueId, blurb, poster, vendorStatus, vendorOpensAt).
- `Venue`.
- `FloorPlan` (zones[], tables[] with id/row/position/nearby).
- `TableHold` (TTL).
- `Booking` (eventId, tableId, vendorId, rate, amount, fee (0), tax (0), shopifyOrderId, status: held/paid/refunded/cancelled, passNumber).
- `XPTransaction` (profileId, source: checkin/challenge/raffle, eventId, amount, awardedByStaffId).
- `Settings` (processingFeePct = 0, taxPct = 0, holdMinutes = 10).
- `Level`.
- `Badge` and `ProfileBadge`.
- `Reward` and `Redemption` (if §0B.1 keeps rewards).
- `SavedEvent`.
- `Challenge` (event-scoped).
- `Waitlist`.
- `Subscriber`.
- `ContactSubmission`.
- `GalleryItem` (eventId, type, s3Key, caption, stat/quote).
- `Partner` (logo, url, order).

## 9. Assets
- `uploads/fgg-logo.png`: FGG logo (supplied by client).
- `uploads/halloween-fest-og.jpg`, `harbor-fest-og.jpg`, `spring-fest-og.png`, `summer-fest-og.png`: event posters, 1200×630 and 1024×537 (landscape ~1.9:1). In cards, show them uncropped (`object-fit: contain`), with a blurred copy of the same image filling any leftover space.
- Placeholders still needed: hero video, partner logos, gallery media, avatar art, badge art, custom icon set.
- Fonts: Fredoka + Nunito from Google Fonts (self-host in production; bundle for mobile).

## 10. Files
- `FGG Site.dc.html`: the full design canvas (open in a browser).
- `support.js`: runtime for viewing the canvas only.
- `uploads/`: logo and event posters.
