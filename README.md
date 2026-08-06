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
| **User Profiles** | `/api/me` self-service profile (name, username, bio, timezone); `/api/users/:username` public profile for booking pages |
| **Schedules & Availability** | Named weekly working-hours templates (`schedules` + `availability_rules`), plus per-date overrides (holidays, one-off hours) |
| **Event Types** | The bookable "products" on a user's page — duration, locations, custom booking questions, buffers, minimum notice, booking-window limits, per-window booking caps, optional price |
| **Availability Engine** | Pure interval-arithmetic slot computation: weekly rules → free ranges → minus busy time (existing bookings) → discrete bookable start times. Redis-cached for 30s per event type/date-range |
| **Booking Engine** | Public booking creation with two-layer conflict prevention (re-derived availability check + `SELECT ... FOR UPDATE` transactional lock against double-booking), booking-limit enforcement, confirmation workflow (auto-confirm or host-approval), cancellation (by attendee or host), rejection, and email notifications for every state change |

Not yet built (planned next, in roughly this order): Teams/Organizations,
Google Calendar sync + generated meeting links, Razorpay payments,
Cloudinary avatar/attachment uploads, webhooks, reminder cron jobs,
dashboard/analytics endpoints, admin APIs.

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
    event-types/     bookable event type CRUD (private + public views)
    availability/     the slot-computation engine (dateRanges.js, slots.js) + service
    bookings/        booking creation, listing, confirm/reject/cancel
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
- Start Redis locally (`redis-server`) — on Windows, use WSL or a Redis-for-Windows build; on Mac/Linux, install via your package manager.

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:
- Set `DB_*` to match your XAMPP MySQL credentials.
- Set `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET` to long random strings (`openssl rand -hex 64`).
- Set `SMTP_*` to a real SMTP account if you want emails to actually send.

### 4. Run migrations

```bash
npm run db:migrate
```

### 5. (Optional) Seed a demo user

```bash
npm run db:seed
```

Creates `demo@cadence.dev` / `Password123`, already email-verified.

### 6. Start the API server

```bash
npm run dev
```

Server runs at `http://localhost:4000`. Check `GET /health`.

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
| GET | `/` | Yes | Current user (same as `/api/auth/me`) |
| PATCH | `/` | Yes | Update `name`, `username`, `bio`, `timezone` |

### Schedules (`/api/schedules`) — all require auth (owner-only)

| Method | Path | Description |
|---|---|---|
| GET | `/` | List my schedules |
| POST | `/` | Create a schedule `{ name, timezone, isDefault?, rules: [{days:[1,2,3,4,5], startTime:"09:00", endTime:"17:00"}] }` |
| GET | `/:id` | Get one, with rules + overrides |
| PATCH | `/:id` | Update name/timezone/default flag/rules (rules are fully replaced if provided) |
| DELETE | `/:id` | Delete (blocked if it's your default schedule) |
| POST | `/:id/overrides` | Add/replace a date override `{ date, isUnavailable, startTime?, endTime? }` |
| DELETE | `/:id/overrides/:overrideId` | Remove an override |

### Event Types (`/api/event-types`) — all require auth (owner-only)

| Method | Path | Description |
|---|---|---|
| GET | `/` | List my event types |
| POST | `/` | Create — see `eventType.validation.js` for the full field list |
| GET | `/:id` | Get one |
| PATCH | `/:id` | Partial update |
| DELETE | `/:id` | Delete (blocked if it has existing bookings — deactivate instead) |

### Public booking-page API (`/api/users`)

| Method | Path | Description |
|---|---|---|
| GET | `/:username` | Public profile |
| GET | `/:username/event-types` | Active event types |
| GET | `/:username/event-types/:slug` | One event type's public details |
| GET | `/:username/event-types/:slug/slots?from=YYYY-MM-DD&to=YYYY-MM-DD&timezone=...` | Bookable slots, grouped by day, in the requested timezone |

### Bookings (`/api/bookings`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/` | No | Create a booking. Body: `{ username, eventTypeSlug, startTime, attendeeName, attendeeEmail, attendeeTimezone, locationType, answers }` |
| GET | `/public/:id` | No | Look up a booking by its public id (confirmation page) |
| POST | `/public/:id/cancel` | No | Attendee cancels via their booking link. Body: `{ reason? }` |
| GET | `/` | Yes | Host's bookings, filterable by `?status=&from=&to=` |
| POST | `/:id/cancel` | Yes | Host cancels |
| POST | `/:id/confirm` | Yes | Confirm a pending booking |
| POST | `/:id/reject` | Yes | Reject a pending booking. Body: `{ reason? }` |

## Design notes worth knowing for an interview

- **No ORM, raw parameterized SQL everywhere** — every repository file is a good place to see exactly what query runs.
- **Double-booking prevention** happens in two layers: a business-rule recheck of the actual schedule right before insert, and a `SELECT ... FOR UPDATE` inside the same transaction as the `INSERT`, which takes an InnoDB gap lock on the affected index range so two simultaneous requests for the same slot can't both succeed.
- **JSON columns** (`locations`, `booking_questions`, `answers`, availability `days`) are used deliberately for small, always-read-as-a-whole structures, instead of extra join tables that would add complexity without a real query benefit.
- **Public IDs vs internal IDs**: every table has an internal auto-increment `id` (used for joins/FKs) and a `public_id` UUID (used in URLs/API responses), so clients never see or can guess sequential database IDs.
- **Redis is used for two distinct things**: a simple `INCR`/`EXPIRE` fixed-window rate limiter, and a short-TTL cache for computed availability slots (invalidated immediately after a booking is created/cancelled).
