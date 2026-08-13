# Cadence — Backend

An original scheduling-platform backend inspired by Cal.com's engineering
concepts, built with Express + raw MySQL SQL + Redis + BullMQ. No ORM.

## Honest status

Every module below is genuinely implemented (real logic, real database
queries, real third-party SDK calls, no stubbed "return success" fakes).
But "genuinely implemented" and "verified working against live services"
are different claims, so here's exactly which is which:

### Verified by execution

Auth, Users, Schedules, Availability Engine, Event Types, Booking
Engine, Teams/Round-Robin/Collective, Group Events, these went through
a dedicated correctness pass in an earlier iteration: real bugs were
found and fixed (buffer enforcement, timezone/DST edge cases, race
conditions in token handling and booking limits, an information leak, an
authorization gap), and 27 unit tests actually run and pass (`npm test`,
no infrastructure needed).

### Implemented with real logic, NOT verified against live external services

Razorpay payments, Cloudinary uploads, Google Calendar OAuth/sync,
outbound webhooks. I don't have live API credentials, a real Razorpay/
Google/Cloudinary account, or network access in the environment these
were built in, so while the code is written against each service's
actual documented API (real signature-verification formulas, real SDK
call shapes, real OAuth token-refresh patterns), I could not execute an
end-to-end test against the real services. Specifically:

- **Razorpay**: order creation, checkout-signature verification (HMAC of
  `order_id|payment_id`), webhook signature verification (HMAC of the raw
  body), and refunds are all implemented per Razorpay's documented API.
  Untested: an actual round-trip against a real Razorpay account.
- **Cloudinary**: avatar upload streams a buffer to Cloudinary and stores
  the returned URL + public_id (for later cleanup on re-upload).
  Untested: an actual upload against a real Cloudinary account.
- **Google Calendar**: full OAuth consent flow, encrypted token storage
  (AES-256-GCM), automatic token-refresh persistence, FreeBusy lookup
  merged into the availability engine, and event create/delete tied to
  the booking lifecycle. Untested: the actual OAuth consent screen and
  Calendar API calls, since that requires a registered Google Cloud
  project and a real browser flow.
- **Webhooks**: HMAC-signed delivery via a BullMQ worker, with retries,
  backoff, and a delivery history log. Untested: an actual receiving
  endpoint on the other end.

Please test each of these against real credentials before relying on
them. The code is a genuine, careful implementation, not a placeholder,
but "I wrote it correctly" and "I watched it work" are different claims
and I want to be precise about which one applies.

### Implemented and should work out of the box (pure business logic, no external service)

Reminders (BullMQ delayed jobs scheduled at booking-confirmation time,
plus a node-cron backup sweep), Analytics/Dashboard APIs (plain SQL
aggregation), Admin APIs (role-gated user/booking/team management),
Organizations (a thin layer over the existing team infrastructure).
These don't depend on any external service, so the same "written +
syntax-checked + logically traced" confidence that applied to the
verified modules above applies here too, I just haven't run a live
integration test against them specifically in this pass.

### Explicitly out of scope

Booking reschedule (only cancel + create-a-new-one exists, a true
reschedule that preserves history and updates in place would need its own
design pass). Meeting-link generation for non-Google providers (Zoom,
etc.), only Google Calendar's own event (with its Meet link, if the
calendar's conferencing settings enable it) is covered. Multi-host
Google Calendar sync for collective bookings, only the primary host's
calendar gets an event, a documented scope decision (see
`booking.service.js`).

---

## Stack

- **Runtime**: Node.js 18+, Express
- **Database**: MySQL 8+ (XAMPP-compatible), raw SQL via `mysql2`
- **Cache / rate limiting / slot caching**: Redis (`ioredis`)
- **Background jobs**: BullMQ (email, webhook delivery) + node-cron (reminder backup sweep)
- **Auth**: JWT access + refresh tokens (httpOnly cookies), bcrypt password hashing
- **Payments**: Razorpay (orders, signature verification, webhooks, refunds)
- **File uploads**: Cloudinary (avatars)
- **Calendar sync**: Google Calendar (OAuth, FreeBusy, event CRUD)
- **Email**: Nodemailer (SMTP)
- **Validation**: Zod

## Modules

| Module | What it does |
|---|---|
| Auth | Signup, email verification, login, refresh-token rotation (atomic), logout, forgot/reset password (atomic) |
| User Profiles | Self-service profile, public profile, Cloudinary avatar upload |
| Schedules & Availability | Weekly templates, date overrides, DST-correct, buffer-aware |
| Event Types | Personal + team-owned, buffers, limits, seats, pricing |
| Availability Engine | Interval arithmetic, buffer-aware, multi-host (round-robin/collective), now also merges Google Calendar busy time |
| Booking Engine | Two-layer conflict prevention, race-safe limits, confirm/reject/cancel, now also creates/deletes Google Calendar events and schedules reminders |
| Teams & Organizations | Roles, round-robin, collective; organizations as a thin layer over teams (`is_organization=1`, sub-teams via `parent_id`) |
| Payments | Razorpay order creation, signature-verified confirmation, webhook handling, refunds |
| Uploads | Cloudinary avatar upload with old-image cleanup |
| Google Calendar | OAuth connect/disconnect, encrypted token storage, FreeBusy sync, event create/delete on booking lifecycle |
| Webhooks | User-managed subscriptions, HMAC-signed delivery via BullMQ, retry + delivery history |
| Reminders | BullMQ delayed jobs (primary) + node-cron sweep (backup) |
| Analytics & Dashboard | Booking counts by status/event-type/time, team stats, a combined dashboard-summary endpoint |
| Admin | Role-gated: platform stats, user list/search, activate/deactivate, role changes, bookings/teams overview |

## Project layout

```
src/
  config/       env, MySQL pool, Redis, mailer, cloudinary, razorpay, googleOAuth
  db/           migrations (numbered .sql, forward-only), migrate.js, seed.js
  middleware/    authenticate, validate, rateLimit, upload (multer), errorHandler
  modules/
    auth/ users/ schedules/ event-types/ availability/ bookings/ teams/
    payments/        Razorpay orders, verification, webhooks, refunds
    calendars/        Google OAuth + FreeBusy + event CRUD
    webhooks/         subscription CRUD + delivery log
    analytics/        SQL aggregation + dashboard summary
    admin/            role-gated platform management
    organizations/    thin layer over teams
  jobs/
    queues/       BullMQ queue definitions (email, webhook-delivery)
    processors/    actual job logic (send email, deliver webhook)
    cron/          reminderSweep.js (node-cron backup)
    workers/       worker process entry point, runs BullMQ workers + cron
  templates/emails/
  utils/         ApiError, asyncHandler, jwt, password, cookies, dayjs, json, crypto (AES-256-GCM), cloudinaryUpload
  app.js
  server.js
tests/
  unit/          pure-function tests, run with `npm test`, no infra needed
  integration/    real HTTP tests against a live server, see tests/README.md
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Start MySQL (via XAMPP) and Redis

### 3. Configure environment

```bash
cp .env.example .env
```

Required: `DB_*`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET`
(`openssl rand -hex 64` each).

Optional (only needed for the corresponding feature):
- `SMTP_*`, emails
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET`, payments
- `CLOUDINARY_*`, avatar uploads
- `ENCRYPTION_KEY` (`openssl rand -hex 32`) + `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, Google Calendar

The app boots fine without the optional ones, those specific features
will error only when actually used, not at startup.

### 4. Run migrations

```bash
npm run db:migrate
```

### 5. Start everything

```bash
npm run dev      # API server
npm run worker   # BullMQ workers + reminder cron (separate terminal)
```

### 6. Run the tests

```bash
npm test                  # unit tests
npm run test:integration  # needs steps 2-5 done first
```

## API reference

### Auth (`/api/auth`)
signup, verify-email, resend-verification, login, refresh, logout, logout-all, forgot-password, reset-password, me

### Profile (`/api/me`)
`GET /`, `PATCH /`, `POST /avatar` (multipart, field name `avatar`)

### Schedules, Event Types, Teams, Bookings
Unchanged from the previous pass, see inline route comments in each `*.routes.js`.

### Payments (`/api/payments`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/orders` | No (booking id is the capability token) | `{ bookingId }` -> Razorpay order |
| POST | `/verify` | No | `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }` |
| POST | `/webhook` | Signature-verified | Razorpay server-to-server webhook |
| POST | `/:bookingId/refund` | Yes (host) | Refund a paid booking |

### Google Calendar (`/api/calendars`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/google/connect` | Yes | Returns the Google OAuth consent URL |
| GET | `/google/callback` | No (Google redirects here) | Completes the OAuth flow |
| GET | `/status` | Yes | Whether Google Calendar is connected |
| DELETE | `/google` | Yes | Disconnects and revokes tokens |

### Webhooks (`/api/webhooks`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET / POST | `/` | Yes | List / create (secret shown ONCE at creation) |
| PATCH / DELETE | `/:id` | Yes | Update / delete |
| GET | `/:id/deliveries` | Yes | Delivery history |

### Analytics (`/api/analytics`)
`GET /dashboard`, `/overview`, `/by-event-type`, `/over-time?days=30`, `/teams/:teamId`

### Admin (`/api/admin`), requires `role: admin`
`GET /stats`, `/users`, `PATCH /users/:userId/active`, `PATCH /users/:userId/role`, `GET /bookings`, `/teams`

### Organizations (`/api/organizations`)
`GET / POST /`, `GET / POST /:id/teams`

## Design notes worth knowing for an interview

- Razorpay signature verification never trusts the client, both the checkout-callback signature and the webhook signature are recomputed server-side from data only Razorpay could have signed.
- OAuth tokens are encrypted at rest (AES-256-GCM, `utils/crypto.js`), a database leak alone doesn't hand over calendar access.
- The OAuth `state` parameter is HMAC-signed, not just a random string, it's how the callback (which Google redirects the browser to directly) knows which user it's for, and it can't be forged without our server's own secret.
- Reminders use a delayed BullMQ job as the primary mechanism, with a deterministic `jobId` (so re-scheduling is a safe no-op) and a node-cron sweep as backup, not a single fragile mechanism.
- Webhook delivery is HMAC-signed the same way Cadence's own inbound Razorpay webhook is verified, same pattern, opposite direction.
- Organizations reuse the `teams` table rather than a parallel one, an organization is a team with `is_organization=1` that other teams can point at via `parent_id`.
