# Cadence — Backend

An original scheduling-platform backend inspired by Cal.com's engineering
concepts, built with Express + raw MySQL SQL + Redis + BullMQ. No ORM.

This backend is being built incrementally, module by module, each fully
functional (no placeholders, no TODOs on implemented features) before
moving to the next.

## Stack

- **Runtime**: Node.js 18+, Express
- **Database**: MySQL 8+ (XAMPP-compatible), raw SQL via `mysql2`
- **Cache / rate limiting / slot caching**: Redis (`ioredis`)
- **Background jobs**: BullMQ (email sending runs in a separate worker process)
- **Auth**: JWT access + refresh tokens (httpOnly cookies), bcrypt password hashing
- **Email**: Nodemailer (SMTP)
- **Validation**: Zod

## Modules implemented so far

| Module | What it does |
|---|---|
| **Auth** | Signup, email verification, login, refresh-token rotation, logout (single device / all devices), forgot/reset password |
| **User Profiles** | `/api/me` self-service profile; `/api/users/:username` public profile for booking pages |
| **Schedules & Availability** | Named weekly working-hours templates, plus per-date overrides (holidays, one-off hours) |
| **Event Types** | Personal AND team-owned bookable "products" — duration, locations, custom booking questions, buffers, minimum notice, booking-window limits, per-window booking caps, optional price, optional seats (group events) |
| **Availability Engine** | Interval-arithmetic slot computation, extended to combine multiple hosts: intersection for collective events, union for round-robin. Redis-cached for 30s per event type/date-range |
| **Booking Engine** | Public booking creation with two-layer conflict prevention (re-derived availability check + `SELECT ... FOR UPDATE` transactional lock), booking-limit enforcement, confirm/reject workflow, attendee/host cancellation, email notifications |
| **Teams & Organizations** | Shared booking namespaces (`/team-pages/:slug`), admin/member roles, round-robin host selection (priority → least-recently-booked), collective events (every host must be free), organizations modeled as teams with `is_organization=1` |
| **Group Events (seats)** | A single time slot can accept multiple independent attendees up to a configured capacity, with its own seat-capacity locking — personal event types only (see design notes) |

Not yet built (planned next): Google Calendar sync + generated meeting
links, Razorpay payments, Cloudinary avatar/attachment uploads, webhooks,
reminder cron jobs, dashboard/analytics endpoints, admin APIs.

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
    event-types/     bookable event type CRUD — personal AND team-owned
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

Fill in `DB_*`, the three secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET` — use `openssl rand -hex 64`), and `SMTP_*` if you want emails to actually send.

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

## API reference

### Auth (`/api/auth`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/signup` | No | Create account, sends verification email |
| POST | `/verify-email` | No | Body: `{ token }` |
| POST | `/resend-verification` | No | Body: `{ email }` |
| POST | `/login` | No | Body: `{ email, password }`, sets auth cookies |
| POST | `/refresh` | Refresh cookie | Rotates tokens |
| POST | `/logout` | Refresh cookie | Revokes current session |
| POST | `/logout-all` | Access token | Revokes every session |
| POST | `/forgot-password` | No | Body: `{ email }` |
| POST | `/reset-password` | No | Body: `{ token, newPassword }` |
| GET | `/me` | Access token | Current user |

### Profile (`/api/me`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Yes | Current user |
| PATCH | `/` | Yes | Update `name`, `username`, `bio`, `timezone` |

### Schedules (`/api/schedules`) — all require auth (owner-only)

| Method | Path | Description |
|---|---|---|
| GET / POST | `/` | List / create schedules |
| GET / PATCH / DELETE | `/:id` | Manage one schedule |
| POST / DELETE | `/:id/overrides[/​:overrideId]` | Manage date overrides |

### Event Types (`/api/event-types`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Yes | My personal event types |
| GET | `/team/:teamId` | Yes (member) | A team's event types |
| POST | `/` | Yes | Create — pass `teamId` + `schedulingType` + `hostUserIds` for a team event type, omit them for personal |
| GET / PATCH / DELETE | `/:id` | Yes (owner or team admin) | Manage one event type |

### Teams (`/api/teams`) — all require auth

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
| GET | `/api/users/:username` | Personal public profile |
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
| POST | `/:id/cancel` \| `/:id/confirm` \| `/:id/reject` | Yes | Host actions |

## Design notes worth knowing for an interview

- **No ORM, raw parameterized SQL everywhere.**
- **Double-booking prevention** uses `SELECT ... FOR UPDATE` inside the same transaction as the `INSERT`, taking an InnoDB gap lock on the affected index range.
- **`booking_hosts`** is the authoritative record of who must be marked busy by a booking — one row for a personal or round-robin booking, one row per host for a collective booking. `bookings.host_user_id` is kept alongside it purely as the "primary host" for simple dashboard queries.
- **Round-robin fairness** is deliberately simplified from Cal.com's weighted-calibration algorithm: priority, then least-recently-booked. No new-host ramp-up or OOO-aware weighting — a reasonable trade documented in `booking.service.js`.
- **Organizations = Teams** with `is_organization=1` and no `parent_id`; sub-teams point back at the org via `parent_id` — avoids a duplicate parallel table.
- **Group events (seats) are personal-event-type only.** Combining seats with round-robin/collective host-picking (who "owns" a shared webinar slot across rotating hosts?) adds real complexity for limited teaching value at this project's scope, so it's explicitly out of scope for team event types (enforced in validation, not silently dropped).
- **Public IDs vs internal IDs**: every table has an internal auto-increment `id` and a `public_id` UUID exposed in the API, so clients never see or guess sequential database IDs.
