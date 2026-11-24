# PENZO architecture

## Principles
- **Server is the authority.** Roles, ownership and state transitions are enforced in the API; the frontend only reflects them.
- **Admins are a separate table** (`AdminUser`), so no OTP/profile request can ever create or elevate an admin.
- **Four distinct concepts** — interest, availability, match proposal, confirmed assignment — each has its own table and status enum.
- **Nothing fabricated.** Examination data comes only from admin-entered records; sample records are flagged `isSampleData`.

## API conventions
- Base path `/api`. JSON only.
- Success: `{ "success": true, "data": …, "meta"?: { page, pageSize, total, totalPages } }`
- Error: `{ "success": false, "error": { "code", "message", "details"? }, "requestId" }`
- Error codes: `BAD_REQUEST`, `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `INVALID_STATE_TRANSITION`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`.
- "Exists but not yours" returns `404`, so record IDs can't be probed.
- Every request carries `X-Request-Id` (also in logs and error bodies).
- Validation: Zod schemas via the `validate({ body, query, params })` middleware; unknown keys are stripped.
- Logs: Pino, structured; cookies, passwords and OTPs are redacted.

## Endpoints implemented so far
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness (no DB) |
| GET | `/api/health/db` | Readiness (runs `SELECT 1`) |
| GET | `/api/public/examinations?search&page&pageSize` | Public list: PUBLISHED and current/upcoming only; featured first, then by start date. Paged (`meta`). |
| POST | `/api/auth/otp/send` | `{ mobile }` → creates and delivers a code. Same response whether or not an account exists. |
| POST | `/api/auth/otp/verify` | `{ mobile, code, role }` → verifies, finds or creates the account (role only used for NEW numbers; `ADMIN` is not accepted), sets the session cookie, returns `{ user, csrfToken, isNewUser }`. |
| GET | `/api/auth/session` | Always 200: `{ authenticated: false }` or the masked user and CSRF token. |
| POST | `/api/auth/logout` | Revokes the session server-side and clears the cookie. |
| POST | `/api/admin/auth/login` | Separate admin login (rate-limited, lockout, audited). |
| GET / POST | `/api/admin/auth/session`, `/logout` | Admin session check (401 if not admin) and logout (audited). |
| GET / PUT | `/api/profile` | The signed-in user's own profile, completion and verification status. Role comes from the session; body cannot change it. |
| GET | `/api/public/examinations/filters` | Authority and city options taken from published data. |
| GET | `/api/dashboard` | One call with everything the signed-in user's dashboard needs (role-specific). |
| GET/POST | `/api/requests` | **Candidates only.** List own (`?scope=active|past|all`) / create (validates profile, session, checklist, duplicates and overlaps). |
| GET/PATCH | `/api/requests/:id` | Own request detail with history / edit while status allows. |
| POST | `/api/requests/:id/cancel` | `{ reason }`: cancels, withdraws proposals, cancels assignments, releases volunteer time, notifies. |
| GET | `/api/interests` | **Volunteers only.** |
| PUT/DELETE | `/api/interests/:examinationId` | Express / withdraw interest (withdraw blocked once committed). |
| GET/POST/DELETE | `/api/availability[/:id]` | **Volunteers only.** Windows in the future, 15 min to 24 h, no overlaps; committed windows can't be removed. |
| GET | `/api/assignments` | Own confirmed arrangements (first name of the other person only). |
| GET | `/api/history` | Own activity feed. |
| GET / POST | `/api/notifications`, `/unread-count`, `/read-all`, `/:id/read` | Own notifications only. |
| GET | `/api/public/faqs` | Published help entries (administrator-managed). |
| * | `/api/admin/*` | Administrator API (admin cookie + CSRF on writes). Dashboard, examinations (+ sessions, locations, rules, preview, publish/unpublish/archive/restore, feature), users (list, detail, suspend, reactivate), verifications (queue, detail, decision), requests (list, detail, transition), reports, audit (read-only), faqs. |
| GET | `/api/public/examinations/:slug` | Public detail incl. sessions and rules. Unpublished, archived and unknown slugs all return 404. |

## Server layout
`routes/` (HTTP wiring + validation) → `services/` (business rules, queries, transactions) → Prisma. A separate `controllers/` layer is added only where handlers grow beyond a few lines. `schemas/` holds Zod input schemas. Shared pieces: `config/` (env, logger, db), `middleware/`, `utils/`.

## Security checklist (status)
| Item | Phase |
|---|---|
| Helmet headers, strict CORS, body size limit, global rate limit | ✅ 1 |
| Public endpoints use explicit `select`s so admin-only fields cannot leak | ✅ 2 |
| Admin-entered URLs rendered only if http(s) (blocks `javascript:`) | ✅ 2 |
| Env validation; dev OTP refused in production | ✅ 1 |
| OTP challenges (hashed, expiring, attempt-limited, single-use), per-IP and per-number limits | ✅ 3 |
| HttpOnly session cookies, hashed session tokens, session fixation prevention, logout revokes server-side | ✅ 3 |
| CSRF token on writes + Origin check; `Cache-Control: no-store` on private responses | ✅ 3 |
| Admin scrypt hashing, lockout, constant-time unknown-email path, audit of sign-in events | ✅ 3 |
| Audit log writes for admin actions (examinations, verification, matching) | 5 |
| Profile routes only touch the signed-in user's own record (no id in the URL) | ✅ 3 |
| Object-level authorization on every other record | 4+ |
| Private document storage + upload validation (no uploads exist yet; verification currently relies on admin review of profile details) | 5 |

## Authentication design (Phase 3)

- **Two identities, two tables, two cookies.** Candidates/volunteers live in `User` (cookie `penzo_session`); admins in `AdminUser` (cookie `penzo_admin_session`). Middleware for one never reads the other's cookie, and `findActiveSession` checks which foreign key is set, so a user token can never resolve as an admin session.
- **Roles are server data.** `requireRole` reads the role from the database row loaded for the session. Request bodies are Zod-parsed with unknown keys stripped; no schema contains `role`.
- **Sessions.** 256-bit random token in an HttpOnly cookie; only its SHA-256 is stored. Fresh token on every login (old one revoked). Absolute expiry (`SESSION_TTL_HOURS`, `ADMIN_SESSION_TTL_HOURS`). Expired rows are purged hourly.
- **CSRF.** Each session has a CSRF token returned by the session endpoints and kept in memory by the client. State-changing routes behind `requireCsrf` need it in `X-CSRF-Token`. `originGuard` additionally rejects writes whose `Origin` isn't `CLIENT_ORIGIN`.
- **Known trade-offs.** (1) Admin lockout reveals that an email exists once it's locked (429 vs 401). (2) Rate-limit counters are in process memory; behind several server instances, move them to Redis. (3) Changing the sign-in mobile number (re-verification) is not built yet.

## Request lifecycle (Phase 4)

`services/requestStateMachine.ts` is the single list of legal status moves; the backend refuses everything else, whoever asks.

```
DRAFT → SUBMITTED → PENDING_REVIEW → AWAITING_VOLUNTEER → MATCH_PROPOSED → VOLUNTEER_ACCEPTED
      → AWAITING_CANDIDATE_CONFIRMATION → CONFIRMED → COMPLETED
Any live status → CANCELLED.  Admin may → REJECTED.  CONFIRMED → REPLACEMENT_REQUIRED → AWAITING_VOLUNTEER / MATCH_PROPOSED.
```
Phase 4 performs: create (→ SUBMITTED) and cancel (→ CANCELLED). Phases 5–6 add the admin and volunteer moves.

Rules that live in the database or in one transaction, not just the UI:
- `ScribeRequest.activeKey` (unique) blocks a second live request for the same session even under a race; an overlap query blocks two live requests at the same time.
- Cancelling updates status with `WHERE status = <seen status>`, so two simultaneous changes can't both win.
- Every request query includes `candidateId = <signed-in user>`; someone else's id returns the same 404 as a missing one.
- The role-based route guards (`requireRole`) are tested: volunteers get 403 on candidate routes and vice versa.
- Volunteers never see a candidate's identity before confirmation; candidates never see volunteer details beyond a first name after confirmation. Contact-detail sharing is a Phase 6 decision.

## Administrator portal design (Phase 5)

- **Single guard.** `adminRouter.use(noStore, requireAdmin, requireCsrf)` is the first line of every `/api/admin/*` route (except `/api/admin/auth/*`, mounted before it so sign-in stays reachable). A candidate or volunteer cookie never reaches these handlers; this is tested route by route.
- **The acting admin is never taken from the request.** Handlers call `adminCtx(req)`, which reads the id from the session.
- **Significant actions need `confirmed: true`** in the body (publish/unpublish/archive, suspend/reactivate, verification decisions, reject/cancel request), and a `reason` where the affected person will read it. Zod rejects the request otherwise, so skipping the UI's confirm step still fails.
- **Audit.** Every admin write calls `writeAudit` with the admin, action, record, IP and a summary. Examination edits store a before/after summary; long free text and internal notes are recorded as "changed" only, so the log doesn't become a second copy of sensitive text. Viewing a full user profile or verification record is itself logged. There is no update/delete route for the log (tested).
- **Concurrency.** Status changes use `updateMany(... where status = <seen>)`, so two admins acting at once can't both succeed.
- **One cancellation implementation.** `cancelWithinTransaction` serves both the candidate's cancel and the admin's, so side effects (withdraw proposals, cancel assignments, release volunteer time, notify) can't drift apart.
- **Examination lifecycle:** DRAFT → PUBLISHED ⇄ UNPUBLISHED → ARCHIVED → (restore) UNPUBLISHED. Publishing needs provenance (`publishBlockers`). Sessions with requests can't be deleted; changing a session time notifies affected people.
- **Reports** are computed with `groupBy`/counts at request time. "Median time to first review" uses the recorded status history; with no history it says so instead of showing a number.

Not in this phase: Match Management (matching phase), document uploads (verification relies on reviewing profile details), CSV export of reports.
