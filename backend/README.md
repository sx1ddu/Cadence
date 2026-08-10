# Cadence — Backend

An original scheduling-platform backend inspired by Cal.com's engineering
concepts, built with Express + raw MySQL SQL + Redis + BullMQ. No ORM.

## Honest status (last updated after a dedicated correctness + testing pass)

This section exists because generated code isn't automatically correct,
and "the code exists" isn't the same claim as "the code works." Here's
where things actually stand:

### Built, reviewed for correctness, and unit-tested

**Auth**, **User Profiles**, **Schedules & Availability**, **Event
Types** (personal + team-owned), the **Availability Engine**, and the
**Booking Engine** (personal, round-robin, collective, group/seats
events) — see the module table below for what each covers.

A dedicated correctness pass went through this code line by line rather
than assuming it was right, and found and fixed real bugs, including:

- **Buffers were stored but never enforced** — now applied on both sides
  of a booking (existing bookings pad their own busy time by their
  buffers; new bookings shrink their own usable window by theirs), in
  both the slot-display path and the transactional conflict lock.
- **An off-by-one in date-range iteration** that caused every slots
  request to silently include one extra, unrequested day — found by
  actually running a test, not by reading the code.
- **A timezone-boundary bug** where converting a UTC date into a
  schedule's timezone before finding "start of day" could shift the
  starting calendar day backward for timezones behind UTC.
- **Three token-handling race conditions** (refresh rotation, password
  reset, email verification) — replaced check-then-act with atomic
  `UPDATE ... WHERE ... IS NULL` claims.
- **Booking-limit concurrency** — the count check now has an
  authoritative, lock-based recheck inside the same transaction as the
  insert, not just a pre-check before it.
- **A partial `PATCH` on an event type could silently store an
  inconsistent, unenforced configuration** (e.g. a booking limit count
  with no window) — now re-validated against the effective merged state.
- **A real information leak**: public booking-page endpoints were
  returning the host's email address and role via a misused helper
  function.
- **An authorization gap**: only the "primary" host of a collective
  booking could manage it; fixed to check actual host membership.
- A broken `package.json` (trailing comma) and an incorrect test-runner
  invocation — both caught by actually running them.

Full details of the reasoning behind each fix are in the relevant source
files as comments, not just in this README.

### Automated tests: 27 unit tests, actually executed and passing

```bash
npm test
```

Pure interval-arithmetic, slot-generation, buffer, and DST-transition
logic — no database or Redis required, so these run anywhere and were
verified by execution, not just written and assumed correct. See
`tests/README.md` for details, including two rounds of mistakes I made in
my *own test code* (not the app) that I caught by reading actual failure
output and fixed.

### Integration tests: written, NOT yet executed by me

`tests/integration/` has real, substantive test files (auth, schedules,
bookings — including genuine concurrent-request tests for double-booking
prevention, group-event capacity, and cache invalidation — teams,
round-robin, collective) that make actual HTTP calls against a running
server with a real database. I don't have MySQL/Redis available in the
environment I wrote them in, so I could not run these myself. They're
carefully cross-checked against the real API contracts, but "written
carefully" and "verified by execution" are different claims — please run
`npm run test:integration` yourself before trusting this suite fully.

### Not implemented yet

Google Calendar sync, meeting-link generation, Razorpay payments,
Cloudinary uploads, webhooks, reminder cron jobs, notifications beyond
booking-lifecycle emails, dashboard APIs, analytics, admin functionality,
and organization-specific features beyond the existing team/org data
model. These were explicitly requested and are explicitly not done —
implementing all of them properly (each needs its own design-review-test
cycle, the same one this pass just went through for the existing
modules) is real, substantial work that deserves its own dedicated pass
rather than being rushed alongside everything above.

---

## Stack

- **Runtime**: Node.js 18+, Express
- **Database**: MySQL 8+ (XAMPP-compatible), raw SQL via `mysql2`
- **Cache / rate limiting / slot caching**: Redis (`ioredis`)
- **Background jobs**: BullMQ (email sending runs in a separate worker process)
- **Auth**: JWT access + refresh tokens (httpOnly cookies), bcrypt password hashing
- **Email**: Nodemailer (SMTP)
- **Validation**: Zod

## Modules

| Module | What it does |
|---|---|
| **Auth** | Signup, email verification, login, refresh-token rotation (atomic, race-safe), logout (single device / all devices), forgot/reset password (atomic, race-safe) |
| **User Profiles** | `/api/me` self-service profile; `/api/users/:username` public profile (email/role never exposed publicly) |
| **Schedules & Availability** | Named weekly working-hours templates, plus per-date overrides (holidays, one-off hours), correct DST handling |
| **Event Types** | Personal AND team-owned bookable "products" — duration, locations, custom booking questions, buffers (now actually enforced), minimum notice, booking-window limits, per-window booking caps (race-safe), optional price, optional seats (group events) |
| **Availability Engine** | Interval-arithmetic slot computation, buffer-aware, combining multiple hosts via intersection (collective) or union (round-robin). Redis-cached for 30s, invalidated immediately on booking/cancellation/event-type-edit |
| **Booking Engine** | Public booking creation with two-layer, buffer-aware conflict prevention (re-derived availability check + `SELECT ... FOR UPDATE` transactional lock), race-safe booking-limit enforcement, confirm/reject workflow, attendee/host cancellation (any collective host, not just the primary), email notifications |
| **Teams & Organizations** | Shared booking namespaces, admin/member roles with a last-admin guard, round-robin (priority then least-recently-booked), collective events, organizations modeled as teams with `is_organization=1` |
| **Group Events (seats)** | A single time slot accepts multiple independent attendees up to a configured capacity, with its own race-safe capacity lock — personal event types only (documented scope decision, not a silent gap) |

## Project layout

```
src/
  config/       env, MySQL pool, Redis client, Nodemailer transport
  db/
    migrate.js         forward-only migration runner
    seed.js            demo user for quick manual testing
    migrations/         numbered .sql files, applied in order
  middleware/    authenticate, validate, rateLimit, errorHandler
  modules/
    auth/            signup/login/refresh/verify/reset
    users/           profile (self + public), shared user repository
    schedules/       weekly availability templates + date overrides
    event-types/     bookable event type CRUD, personal AND team-owned
    availability/     the slot-computation engine (dateRanges.js, slots.js) + service
    bookings/        booking creation, listing, confirm/reject/cancel
    teams/           team CRUD, membership, public team booking pages
  jobs/
    queues/      BullMQ queue definitions
    processors/  the actual job logic (e.g. sending an email)
    workers/     worker process entry point (run separately from the API)
  templates/emails/  plain-function HTML email templates
  utils/         ApiError, asyncHandler, jwt, password, cookies, dayjs, json
  app.js         Express app (middleware + route mounting)
  server.js      boots the HTTP server (checks DB/Redis first)
tests/
  unit/          pure-function tests, no infra needed, see tests/README.md
  integration/    real HTTP tests against a live server, see tests/README.md
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Start MySQL (via XAMPP) and Redis

- Start MySQL from the XAMPP control panel (default: `127.0.0.1:3306`, user `root`, no password).
- Start Redis locally (`redis-server`).

### 3. Configure environment

```bash
cp .env.example .env
```

Fill in `DB_*`, the three secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET`, use `openssl rand -hex 64`), and `SMTP_*` if you want emails to actually send.

### 4. Run migrations

```bash
npm run db:migrate
```

### 5. (Optional) Seed a demo user

```bash
npm run db:seed
```

### 6. Start the API server

```bash
npm run dev
```

### 7. Start the background worker (separate terminal)

```bash
npm run worker
```

### 8. Run the tests

```bash
npm test                  # unit tests, no setup needed beyond npm install
npm run test:integration  # needs steps 2-6 done first
```

## API reference

### Auth (`/api/auth`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/signup` | No | Create account, sends verification email |
| POST | `/verify-email` | No | Body: `{ token }` |
| POST | `/resend-verification` | No | Body: `{ email }` |
| POST | `/login` | No | Body: `{ email, password }`, sets auth cookies |
| POST | `/refresh` | Refresh cookie | Rotates tokens (atomic, single-use) |
| POST | `/logout` | Refresh cookie | Revokes current session |
| POST | `/logout-all` | Access token | Revokes every session |
| POST | `/forgot-password` | No | Body: `{ email }` |
| POST | `/reset-password` | No | Body: `{ token, newPassword }` (atomic, single-use) |
| GET | `/me` | Access token | Current user |

### Profile (`/api/me`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Yes | Current user |
| PATCH | `/` | Yes | Update `name`, `username`, `bio`, `timezone` |

### Schedules (`/api/schedules`), all require auth (owner-only)

| Method | Path | Description |
|---|---|---|
| GET / POST | `/` | List / create schedules |
| GET / PATCH / DELETE | `/:id` | Manage one schedule |
| POST / DELETE | `/:id/overrides[/:overrideId]` | Manage date overrides |

### Event Types (`/api/event-types`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Yes | My personal event types |
| GET | `/team/:teamId` | Yes (member) | A team's event types |
| POST | `/` | Yes | Create, pass `teamId` + `schedulingType` + `hostUserIds` for a team event type, omit them for personal |
| GET / PATCH / DELETE | `/:id` | Yes (owner or team admin) | Manage one event type |

### Teams (`/api/teams`), all require auth

| Method | Path | Auth | Description |
|---|---|---|---|
| GET / POST | `/` | Member / any user | List my teams / create a team (creator becomes admin) |
| GET / PATCH / DELETE | `/:id` | Member / admin / owner | Manage a team |
| POST | `/:id/members` | Admin | Add an existing user by email |
| PATCH | `/:id/members/:userId` | Admin | Change role (blocked if it'd leave zero admins) |
| DELETE | `/:id/members/:userId` | Admin, or self | Remove a member / leave |

### Public booking pages

| Method | Path | Description |
|---|---|---|
| GET | `/api/users/:username` | Personal public profile (no email/role) |
| GET | `/api/users/:username/event-types[/:slug]` | Personal event types |
| GET | `/api/users/:username/event-types/:slug/slots?from=&to=&timezone=` | Personal slots |
| GET | `/api/team-pages/:slug` | Team public profile |
| GET | `/api/team-pages/:slug/event-types[/:eventSlug]` | Team event types |
| GET | `/api/team-pages/:slug/event-types/:eventSlug/slots?from=&to=&timezone=` | Team slots (round-robin/collective aware) |

### Bookings (`/api/bookings`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/` | No | Create. Body needs `eventTypeSlug` + exactly one of `username`/`teamSlug`, plus `startTime`, `attendeeName`, `attendeeEmail`, `attendeeTimezone`, `locationType`, `answers` |
| GET | `/public/:id` | No | Look up by public id (confirmation page) |
| POST | `/public/:id/cancel` | No | Attendee cancels |
| GET | `/` | Yes | Host's bookings, filterable by `?status=&from=&to=` |
| POST | `/:id/cancel` \| `/:id/confirm` \| `/:id/reject` | Yes | Host actions (any assigned host on a collective booking, not just the primary) |

## Design notes worth knowing for an interview

- **No ORM, raw parameterized SQL everywhere.**
- **Double-booking prevention** uses `SELECT ... FOR UPDATE` inside the same transaction as the `INSERT`, buffer-aware on both sides (an existing booking's own buffer, and the new booking's own buffer).
- **`booking_hosts`** is the authoritative record of who must be marked busy by a booking, one row for personal/round-robin, one row per host for collective. `bookings.host_user_id` remains as the "primary host" for simple dashboard queries, but authorization checks use the full `booking_hosts` membership.
- **Round-robin fairness** is deliberately simplified from Cal.com's weighted-calibration algorithm: priority, then least-recently-booked.
- **Organizations = Teams** with `is_organization=1` and no `parent_id`.
- **Group events (seats) are personal-event-type only**, a documented scope decision, not a silent gap.
- **Public IDs vs internal IDs**: every table has an internal auto-increment `id` and a `public_id` UUID exposed in the API.
- **Redis slots cache** has a 30s TTL and is explicitly invalidated on booking create/cancel/reject and event-type edits. Schedule edits do NOT proactively invalidate it (documented tradeoff in `schedule.service.js`, finding every event type that implicitly depends on a schedule as its default would mean scanning a user's whole event type list on every schedule edit, for a cache that already self-heals in 30 seconds).
