# Tests

## Unit tests (`tests/unit/`) — run anywhere, no setup needed

```bash
npm test
```

These cover the pure availability-engine logic — interval arithmetic
(`dateRanges.js`), slot generation (`slots.js`), buffer math, DST
transitions, timezone conversion — with **zero** dependency on a database
or Redis. 27 tests, all currently passing.

## Integration tests (`tests/integration/`) — need a real, running stack

```bash
npm run db:migrate      # fresh migrated database
npm run dev              # in one terminal
npm run test:integration # in another
```

These make real HTTP requests against a running server backed by real
MySQL and Redis — no mocking. They cover:

| File | Covers |
|---|---|
| `auth.test.js` | signup, login, refresh rotation, logout (single + all devices), email verification token issuance, password reset (including the atomic-claim race fix, exercised directly at the DB level) |
| `schedules.test.js` | schedule creation/defaults, ownership checks, date overrides, minimum notice, timezone handling, buffer effect on availability |
| `bookings.test.js` | event type creation, booking creation/confirm/reject/cancel, ownership checks, double-booking rejection, **real concurrent booking attempts** (5 simultaneous requests for one slot — exactly 1 must succeed), group-event seat capacity, booking limits, location/answer validation |
| `teams.test.js` | team creation, membership authorization (non-member/non-admin rejection, last-admin-removal guard), round-robin booking assignment, collective availability (both the non-overlapping-schedules-yield-zero-slots case and the overlapping-window-is-bookable case) |
| `cache.test.js` | Redis slots cache invalidates immediately on booking/cancellation, rather than waiting out the 30-second TTL |

**Every assertion in these files calls the real API and checks a real
response** — there are no mocked modules, no fake timers standing in for
actual concurrency. The `tests/integration/helpers/` folder has two small
utilities: a cookie-jar-aware fetch wrapper (`client.js`) and shared setup
helpers (`testUtils.js`) — signing up, logging in, creating an event type,
etc., since nearly every test needs those as a starting point.

### Honest limitation

I don't have a running MySQL/Redis instance available while writing this,
so I could not execute these integration tests myself before handing them
over — they're written carefully against the actual, verified API
contracts (route paths, field names, response shapes all cross-checked
against the real `*.validation.js` and `*.controller.js` files), and they
follow the exact same patterns as the unit tests I DID run and fix real
bugs in. But "written correctly" and "verified by execution" are
different claims, and I want to be precise about which one applies here.
**Please run `npm run test:integration` yourself before trusting this
suite fully** — if anything fails, the failure output will point at
either a real bug or a test-authoring mistake on my part (both of which
happened during the unit test pass above, and both are fixable the same
way: read the actual failure, don't guess).
