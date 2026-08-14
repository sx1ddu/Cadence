# Cadence

**A scheduling and booking platform backend, designed and built from the ground up with Node.js, Express, MySQL, Redis, and BullMQ.**

Cadence handles the full lifecycle of a scheduling product: authentication, availability calculation, bookings, team scheduling (round-robin and collective), payments, calendar sync, notifications, and background job processing — all implemented with raw SQL and no ORM.

---

## Table of Contents

- [Honest Status](#honest-status)
- [Tech Stack](#tech-stack)
- [Modules](#modules)
- [Project Layout](#project-layout)
- [Getting Started](#getting-started)
- [API Reference](#api-reference)
- [Engineering Notes](#engineering-notes)

---

## Honest Status

Every module described below is genuinely implemented — real logic, real database queries, real third-party SDK integrations. Nothing here is a stubbed placeholder. That said, "genuinely implemented" and "verified against live services" are different claims, so this section draws a clear line between the two.

### Verified by execution

**Auth, Users, Schedules, Availability Engine, Event Types, Booking Engine, Teams (Round-Robin/Collective), and Group Events** went through a dedicated correctness pass: real bugs were identified and fixed (buffer enforcement, timezone/DST edge cases, race conditions in token handling and booking limits, an information-disclosure issue, an authorization gap). A 27-test unit suite runs and passes with `npm test`, with no external infrastructure required.

### Implemented with real logic, not yet verified against live external services

**Razorpay payments, Cloudinary uploads, Google Calendar OAuth/sync, and outbound webhooks** are built directly against each provider's documented API — real signature-verification formulas, real SDK call shapes, real OAuth token-refresh handling — but have not been exercised end-to-end against live provider accounts in the environment these were developed in.

| Integration | What's implemented | What's untested |
|---|---|---|
| **Razorpay** | Order creation, checkout-signature verification (HMAC of `order_id\|payment_id`), webhook signature verification (HMAC of the raw request body), refunds | An actual round-trip against a live Razorpay account |
| **Cloudinary** | Buffer-stream avatar upload, URL + public ID storage, cleanup of replaced images | An actual upload against a live Cloudinary account |
| **Google Calendar** | Full OAuth consent flow, encrypted token storage (AES-256-GCM), automatic token-refresh persistence, FreeBusy lookups merged into the availability engine, event create/delete tied to the booking lifecycle | The live OAuth consent screen and Calendar API calls, which require a registered Google Cloud project |
| **Webhooks** | HMAC-signed delivery via a BullMQ worker, retries with backoff, delivery history log | An actual receiving endpoint on the other end |

Each of these should be tested against real credentials before being relied on in production. The implementations are careful and complete, not placeholders — but "written correctly" and "observed working" are different claims, and this README is deliberately precise about which applies where.

### Implemented and expected to work out of the box (no external service dependency)

**Reminders** (BullMQ delayed jobs scheduled at booking-confirmation time, with a node-cron backup sweep), **Analytics & Dashboard APIs** (plain SQL aggregation), **Admin APIs** (role-gated user, booking, and team management), and **Organizations** (a thin layer over the existing team infrastructure). None of these depend on an external service, so they carry the same "written, syntax-checked, logically traced" confidence as the verified modules above, even without a dedicated live-integration test pass.

### Explicitly out of scope

- **Booking reschedule** — only cancel-and-rebook exists today. A true reschedule that preserves booking history and updates in place would warrant its own design pass.
- **Meeting links for non-Google providers** (Zoom, etc.) — only the Google Calendar event itself (and its Meet link, if conferencing is enabled on the calendar) is covered.
- **Multi-host Google Calendar sync for collective bookings** — only the primary host's calendar receives an event. A documented, deliberate scope decision (see `booking.service.js`).

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 18+, Express |
| Database | MySQL 8+ (XAMPP-compatible), raw SQL via `mysql2` — no ORM |
| Cache / rate limiting / slot caching | Redis (`ioredis`) |
| Background jobs | BullMQ (email, webhook delivery) + node-cron (reminder backup sweep) |
| Authentication | JWT access + refresh tokens (httpOnly cookies), bcrypt password hashing |
| Payments | Razorpay — orders, signature verification, webhooks, refunds |
| File uploads | Cloudinary (avatars) |
| Calendar sync | Google Calendar — OAuth, FreeBusy, event CRUD |
| Email | Nodemailer (SMTP) |
| Validation | Zod |

---

## Modules

| Module | Responsibility |
|---|---|
| **Auth** | Signup, email verification, login, atomic refresh-token rotation, logout, atomic forgot/reset password |
| **User Profiles** | Self-service profile management, public profile pages, Cloudinary avatar upload |
| **Schedules & Availability** | Weekly availability templates, date overrides, DST-correct, buffer-aware |
| **Event Types** | Personal and team-owned bookable events — buffers, limits, seats, pricing |
| **Availability Engine** | Interval arithmetic, buffer-aware, multi-host aggregation (round-robin/collective), merges Google Calendar busy time |
| **Booking Engine** | Two-layer conflict prevention, race-safe booking limits, confirm/reject/cancel flows, calendar event sync, reminder scheduling |
| **Teams & Organizations** | Role-based membership, round-robin and collective scheduling; organizations implemented as a team variant (`is_organization = 1`) with sub-teams via `parent_id` |
| **Payments** | Razorpay order creation, signature-verified confirmation, webhook handling, refunds |
| **Uploads** | Cloudinary avatar upload with automatic cleanup of replaced images |
| **Google Calendar** | OAuth connect/disconnect, encrypted token storage, FreeBusy sync, event create/delete on the booking lifecycle |
| **Webhooks** | User-managed subscriptions, HMAC-signed delivery via BullMQ, retries, delivery history |
| **Reminders** | BullMQ delayed jobs (primary mechanism) with a node-cron sweep as a backup |
| **Analytics & Dashboard** | Booking counts by status, event type, and time; team statistics; a combined dashboard-summary endpoint |
| **Admin** | Role-gated platform stats, user search and management, bookings and teams overview |

---

## Project Layout

```
src/
  config/          env, MySQL pool, Redis, mailer, Cloudinary, Razorpay, Google OAuth
  db/               migrations (numbered .sql, forward-only), migrate.js, seed.js
  middleware/       authenticate, validate, rateLimit, upload (multer), errorHandler
  modules/
    auth/ users/ schedules/ event-types/ availability/ bookings/ teams/
    payments/        Razorpay orders, verification, webhooks, refunds
    calendars/        Google OAuth, FreeBusy, event CRUD
    webhooks/         subscription CRUD, delivery log
    analytics/        SQL aggregation, dashboard summary
    admin/            role-gated platform management
    organizations/    thin layer over teams
  jobs/
    queues/           BullMQ queue definitions (email, webhook-delivery)
    processors/       job logic (send email, deliver webhook)
    cron/             reminderSweep.js — node-cron backup
    workers/          worker process entry point (BullMQ workers + cron)
  templates/emails/
  utils/             ApiError, asyncHandler, jwt, password, cookies, dayjs, json,
                      crypto (AES-256-GCM), cloudinaryUpload
  app.js
  server.js
tests/
  unit/              pure-function tests — `npm test`, no infrastructure required
  integration/        real HTTP tests against a live server — see tests/README.md
```

---

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Start MySQL and Redis

MySQL via XAMPP (or any local MySQL 8+ instance); Redis via your platform's usual method.

### 3. Configure environment

```bash
cp .env.example .env
```

**Required:** `DB_*`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET` (generate each with `openssl rand -hex 64`).

**Optional** (only needed for the corresponding feature — the app boots fine without them, and only the specific feature errors when actually used):
- `SMTP_*` — outbound email
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` — payments
- `CLOUDINARY_*` — avatar uploads
- `ENCRYPTION_KEY` (`openssl rand -hex 32`) + `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google Calendar

### 4. Run migrations

```bash
npm run db:migrate
```

### 5. Start the application

```bash
npm run dev      # API server
npm run worker   # BullMQ workers + reminder cron — run in a separate terminal
```

### 6. Run the tests

```bash
npm test                   # unit tests
npm run test:integration   # requires steps 2–5 completed first
```

---

## API Reference

### Auth — `/api/auth`
`signup` · `verify-email` · `resend-verification` · `login` · `refresh` · `logout` · `logout-all` · `forgot-password` · `reset-password` · `me`

### Profile — `/api/me`
| Method | Path | Notes |
|---|---|---|
| `GET` | `/` | Current profile |
| `PATCH` | `/` | Update profile |
| `POST` | `/avatar` | Multipart upload, field name `avatar` |

### Schedules, Event Types, Teams, Bookings
See inline route documentation in each module's `*.routes.js` file.

### Payments — `/api/payments`
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/orders` | Booking ID acts as capability token | `{ bookingId }` → Razorpay order |
| `POST` | `/verify` | None | `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }` |
| `POST` | `/webhook` | Signature-verified | Razorpay server-to-server webhook |
| `POST` | `/:bookingId/refund` | Host only | Refund a paid booking |

### Google Calendar — `/api/calendars`
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/google/connect` | Required | Returns the Google OAuth consent URL |
| `GET` | `/google/callback` | None (Google redirects here) | Completes the OAuth flow |
| `GET` | `/status` | Required | Connection status |
| `DELETE` | `/google` | Required | Disconnects and revokes tokens |

### Webhooks — `/api/webhooks`
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` / `POST` | `/` | Required | List / create — secret is shown once, at creation |
| `PATCH` / `DELETE` | `/:id` | Required | Update / delete |
| `GET` | `/:id/deliveries` | Required | Delivery history |

### Analytics — `/api/analytics`
`GET /dashboard` · `/overview` · `/by-event-type` · `/over-time?days=30` · `/teams/:teamId`

### Admin — `/api/admin` (requires `role: admin`)
`GET /stats` · `/users` · `PATCH /users/:userId/active` · `PATCH /users/:userId/role` · `GET /bookings` · `/teams`

### Organizations — `/api/organizations`
`GET` / `POST /` · `GET` / `POST /:id/teams`

---

## Engineering Notes

A few design decisions worth highlighting:

- **Payment signatures are never trusted from the client.** Both the checkout-callback signature and the webhook signature are recomputed server-side from data only Razorpay could have signed.
- **OAuth tokens are encrypted at rest** (AES-256-GCM, `utils/crypto.js`) — a database compromise alone doesn't expose calendar access.
- **The OAuth `state` parameter is HMAC-signed**, not a bare random string. Since Google redirects the browser directly to the callback, this is how the callback identifies the correct user, and it cannot be forged without the server's own secret.
- **Reminders use a delayed BullMQ job as the primary mechanism**, keyed with a deterministic job ID so re-scheduling is a safe no-op, backed by a node-cron sweep — not a single, fragile trigger.
- **Webhook delivery is HMAC-signed** using the same pattern as the platform's own inbound Razorpay webhook verification, applied in the opposite direction.
- **Organizations reuse the `teams` table** rather than introducing a parallel schema — an organization is simply a team with `is_organization = 1` that other teams reference via `parent_id`.
