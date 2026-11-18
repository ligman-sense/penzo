# PENZO — Full-Stack Project Completeness & Review Report

## 1. Summary

**Overall Completion: 61%** (Backend core ~72%, Frontend portals ~56%, Security & Testing ~48%).

PENZO is a functional full-stack **Node.js + Express + MongoDB (Mongoose) + Vanilla HTML/CSS/ES6 JS** application (despite outdated `docs/` referencing PostgreSQL/Prisma/Zod). Core workflows—OTP login, separate admin login, profile completion, verification review, examination listing, scribe request creation, weighted volunteer matching, invitation acceptance with commitment agreement, 5-day lock emergency cancellation, and 2-day alert scheduling—are implemented end-to-end on the backend. However, the project is **not production-ready**: critical security defects exist (unauthenticated role-overwrite endpoint, CSRF middleware never mounted, IDOR on proposed-match lookup, broken admin lockout, stored `javascript:` XSS), several expected UI pages are missing (Availability, Notifications, History, Audit Logs, FAQ Admin), public landing and help pages are static/hardcoded instead of DB-backed, and multiple frontend-to-backend contract mismatches break live UI features (candidate stats always `0`, volunteer withdraw fails with `undefined`, theme toggle double-bound).

---

## 2. Actual Tech Stack and Versions

*Note: `docs/ARCHITECTURE.md` and `docs/DATABASE.md` describe an older/different stack (PostgreSQL, Prisma, Zod, Pino, TypeScript). The actual running codebase detected from `package.json`, `package-lock.json`, `server/`, and `public/` is below.*

| Layer | Technology | Version (Manifest → Lockfile) | Evidence File |
|---|---|---|---|
| Runtime | Node.js (CommonJS backend) | `>=20` (env: `v20.11.0`) | `package.json`, `server/package.json` |
| Package Manager | npm | `10.5.0` (lockfileVersion 3) | `package-lock.json` |
| Frontend Language | HTML5, CSS3, Vanilla JS (ES6 Modules) | Native browser (no transpiler) | `public/*.html`, `public/js/**/*.js` |
| Frontend Styling | Custom CSS with CSS Custom Properties (Light/Dark) | Custom (no CSS framework) | `public/css/base.css`, `layout.css`, `components.css`, `themes.css`, `pages.css` |
| Frontend Build Tool | None (served directly via `express.static`) | N/A | `server/app.js` (`express.static(publicDir)`) |
| Backend Framework | Express.js (REST JSON API under `/api`) | `^4.21.1` → `4.22.3` | `package.json`, `package-lock.json`, `server/app.js` |
| Security / HTTP Middleware | `helmet`, `cors`, `cookie-parser`, `express-rate-limit`, `morgan` | `helmet` `8.3.0`, `cors` `2.8.6`, `cookie-parser` `1.4.7`, `express-rate-limit` `7.5.1`, `morgan` `1.12.1` | `package.json`, `package-lock.json`, `server/app.js`, `server/middleware/rateLimits.js` |
| Config / Env | `dotenv` | `^16.4.5` → `16.6.1` | `package.json`, `package-lock.json`, `server/config/env.js` |
| Database Engine | MongoDB | Unverified locally (not running); README specifies `>=7.x` | `server/config/database.js`, `README.md` |
| ODM / Query Layer | Mongoose (schema-based, no migrations tool) | `^8.8.0` → `8.24.7` | `package.json`, `package-lock.json`, `server/models/*.js` |
| User Authentication | Custom Mobile OTP (HMAC-SHA256) + Custom HttpOnly cookie (`penzo_session`) + SHA-256 hashed `Session` collection | Built-in Node `crypto` | `server/services/otpService.js`, `authService.js`, `sessionService.js`, `utils/crypto.js` |
| Admin Authentication | Separate `AdminUser` collection + Node `crypto.scrypt` password hashing + `penzo_admin_session` cookie | Built-in Node `crypto` | `server/services/adminAuthService.js`, `utils/password.js`, `models/AdminUser.js` |
| Dev Server | `nodemon` | `^3.1.0` → `3.1.14` | `package.json`, `package-lock.json` |
| Unused Dependencies (installed but never imported) | `bcryptjs` (`2.4.3`), `connect-mongo` (`5.1.0`), `csurf` (`1.11.0`, deprecated), `express-session` (`1.19.0`), `multer` (`1.4.5-lts.2`, deprecated) | See lockfile | `package.json`, `server/package.json`, `package-lock.json` |

### Folder Structure & Main Entry Points
- **Backend Entry Point**: `server/server.js` (connects MongoDB via `server/config/database.js`, creates Express app via `server/app.js`, starts hourly `sessionService.purgeExpired()` and 15-min `alertSchedulerService.startAlertScheduler()`).
- **API Router Root**: `server/routes/index.js` mounts `/api/health`, `/api/public/examinations`, `/api/public/faqs`, `/api/auth`, `/api/admin/auth`, `/api/admin`, `/api/profile`, `/api/dashboard`, `/api/requests`, `/api/interests`, `/api/availability`, `/api/assignments`, `/api/history`, `/api/notifications`.
- **Backend Layers**: `server/config/` (3 files), `server/middleware/` (5 files), `server/models/` (22 Mongoose models), `server/routes/` (10 files), `server/services/` (24 files), `server/utils/` (8 files), `server/scripts/createAdmin.js`.
- **Frontend**: `public/` (6 root HTML pages, 6 `candidate/`, 5 `volunteer/`, 8 `admin/` HTML pages; 5 CSS files in `public/css/`; 28 JS ES modules in `public/js/`).
- **Scripts & Tests**: `scripts/seed.js` and 7 Node test scripts in `scripts/test-*.js`.

---

## 3. Feature Checklist

| Feature | Status | Evidence | Missing |
|---|---|---|---|
| **Auth & Access** | | | |
| Mobile OTP login (expiry, attempt limit, resend) | **Partial** | `server/services/otpService.js` (`sendOtp`, `verifyOtp` — 300s TTL, max 5 attempts, prod 30s resend cooldown, HMAC-SHA256 hash); `server/routes/auth.js` (`/otp/send`, `/otp/verify`); `public/login.html`, `public/js/login.js` | Live SMS provider not implemented (`otpService.js:106` throws 503; `server/config/otpSender.js` is unused); resend cooldown skipped outside production; non-atomic attempt increment; `devCode` exposed in API response; hardcoded 1-click demo buttons in `public/login.html` |
| Separate admin login | **Partial** | `server/models/AdminUser.js`, `server/services/adminAuthService.js` (scrypt + constant-time `dummyHash`), `server/routes/adminAuth.js`, `public/admin/login.html` | Admin lockout is broken (`adminAuthService.js:35` uses `failedLoginCount`, while schema field is `failedLoginAttempts`, so counter never persists) |
| Sessions & RBAC | **Partial** | `server/models/Session.js`, `server/services/sessionService.js` (HttpOnly cookies `penzo_session` / `penzo_admin_session`, SHA-256 hashed tokens, revocation), `server/middleware/auth.js` (`requireUser`, `requireAdmin`, `requireRole`) | `POST /api/auth/register` (`server/routes/auth.js:72`) lets any unauthenticated caller overwrite any user's role; `requireCsrf` is never mounted on any route; `originGuard` is an empty stub; admin cookie shadows user cookie in `attachSession` |
| **Profiles** | | | |
| Role selection | **Partial** | `public/login.html` (`#step-role`), `public/js/login.js` (`setupRoleForm`), `server/services/authService.js` | `login.js` calls `/otp/verify` without role (creating a `CANDIDATE` + `CandidateProfile` first), then mutates role via insecure `POST /api/auth/register`, leaving an orphaned `CandidateProfile` for volunteers |
| Step-by-step profile completion & progress indicator | **Partial** | Live progress bar + aria-progressbar in `public/js/profileCompletion.js`, `server/services/profileCompletion.js`, `public/candidate/profile.html`, `public/volunteer/profile.html`, dashboard banners | Single-page form (not a step-by-step wizard); `email` and `mobile-display` inputs stay blank because `profile.js` reads `data.profile.email/mobile` instead of top-level `data.email/mobile` |
| Edit profile & verification status | **Partial** | `GET/PUT /api/profile` (`server/routes/profile.js`, `profileService.js`), auto-creates/resets `VerificationRecord` on completion, `syncUserVerification` | Badge map in `public/js/candidate/profile.js:306` and `volunteer/profile.js:208` checks `NEEDS_CORRECTION` instead of backend's `REQUIRES_CORRECTION`; no document upload (even though `DocumentMetadata.js` and `multer` exist) |
| **Exams** | | | |
| Admin create, edit, publish, unpublish, archive (dates, sessions, regions, rules, official links) | **Partial** | `server/routes/admin.js` (`/examinations*`), `server/services/adminExaminationService.js`, `server/models/Examination.js`, `public/admin/examinations.html`, `examination-form.html` | `examination-form.html` lacks UI inputs for **sessions, locations/regions, rules, eligibility, and languages** (only backend/seed populate them); `examinations.html` lacks an **Archive** button; `unpublishExamination`/`archiveExamination` skip `canMoveExam` |
| Public landing page showing upcoming exams from DB | **Not started** (UI) / **Done** (API) | Backend `GET /api/public/examinations` (`routes/publicExaminations.js`, `examinationService.js`) works | `public/index.html` is 100% static HTML (Hero, How It Works, Disclaimer) and never fetches or renders examinations from MongoDB |
| **Candidate** | | | |
| Dashboard | **Partial** | `public/candidate/dashboard.html`, `public/js/candidate/dashboard.js`, `GET /api/dashboard` (`dashboardService.js`) | All 4 stat cards always show `0` (`dashboard.js:102` reads `data.totalRequests` instead of `data.stats.totalRequests`; `completed` is not returned at all) |
| Browse & filter exams | **Partial** | `public/candidate/examinations.html`, `public/js/candidate/examinations.js`, `GET /api/public/examinations` | Modal renders `[object Object]` for rules, uses wrong keys (`s.date`, `s.venue`, `l.centre`, `exam.infoUrl`), and backend ignores `dateFrom` filter |
| Scribe request flow (details, checklist, review, submit, ref #) | **Partial** | `public/candidate/request-form.html`, `request-form.js`, `POST /api/requests`, `requestService.js` (`generateReference` → `REQ-YYYY-NNNNN`), venue details + 1 consent checkbox | No multi-step checklist or pre-submit review screen; rules render as `[object Object]`; backend does not check `exam.status === 'PUBLISHED'` or require consent/checklist |
| Duplicate-request prevention | **Partial** | `server/services/requestService.js:93-100` blocks second request per `(candidateId, examinationId)` where status not in `CANCELLED`/`REJECTED` | Application-level query only (no DB unique `activeKey` index, race-condition prone); no overlapping-time check across different exams; blocks re-request even if prior exam is `COMPLETED` |
| Status tracking, view & confirm proposed match | **Partial** | `public/candidate/requests.html`, `request-details.html`, `GET /api/requests/:id/proposed-match`, `POST /:id/confirm-match`, `POST /:id/decline-match` | `GET /:id/proposed-match` has an IDOR (missing ownership check); `startsOn` omitted in request list/detail responses (`TBD`); Verified badge hardcoded even on override; `declineMatch` bypasses state checks |
| Edit or cancel request | **Partial** | Backend `PATCH /api/requests/:id` and `POST /api/requests/:id/cancel` (`requestService.js`); Cancel modal in `request-details.html` | No UI to **edit** a request; `cancelRequest` does not withdraw proposals, cancel confirmed assignments, release volunteer availability, or notify volunteer |
| Candidate history & notifications | **Partial** | Backend `GET /api/history` (`historyService.js`), `/api/notifications/*` (`notificationService.js`) | No Candidate History page, no Notifications page, and no header notification bell UI (`.notification-badge` absent in HTML) |
| **Volunteer** | | | |
| Dashboard | **Partial** | `public/volunteer/dashboard.html`, `dashboard.js`, `GET /api/dashboard` | `Completed` stat always `0` (`dashboardService.js` does not compute/return `completedSessions`) |
| Browse exams & "I'm interested" flow | **Partial** | `public/volunteer/examinations.html`, `interests.html`, `PUT/DELETE /api/interests/:examinationId`, `interestService.js` | `examinations.js:66` fails to read array response from `/api/interests` and checks `i.examinationId` instead of `i.examination.id` (existing interests never marked); `interests.js:85` uses `interest.examinationId` (`undefined`), breaking Withdraw; no interest form for notes/confirmations; backend `withdrawInterest` does not block withdrawal when committed |
| Availability management | **Partial** | Backend `GET/POST/DELETE /api/availability` (`routes/volunteer.js`, `availabilityService.js`, `VolunteerAvailability.js`) with overlap check & `COMMITTED` protection | **No frontend UI page** for managing availability slots; `confirmMatch` never sets slots to `COMMITTED` |
| Invitations (accept/decline) & commitments | **Done** (with minor gaps) | `public/volunteer/commitments.html`, `commitments.js`, `GET /api/interests/invitations`, `POST /accept` (3-checkbox Commitment Agreement), `POST /decline`, `GET /api/assignments`, `POST /api/assignments/:id/cancel` (5-day lock + emergency cancellation) | `venue.mapLink` allows `javascript:` XSS; `commitments.js` session renderer reads `s.date` instead of `s.startsAt`; candidate-side `cancelAssignment` leaves `ScribeRequest` stale |
| Volunteer history & notifications | **Partial** | Backend `GET /api/history` and `/api/notifications/*` | No Volunteer History UI page, no Notifications UI page, no header bell |
| **Admin** | | | |
| Dashboard metrics | **Done** | `public/admin/dashboard.html`, `dashboard.js`, `GET /api/admin/dashboard` (`adminReportService.js`) | — |
| Verification centre (verify, reject, request correction) | **Done** | `public/admin/verification.html`, `verification.js`, `GET /api/admin/verifications[/metrics/:id]`, `POST /:id/decide` (`adminPeopleService.js`) | Document preview/download not implemented (profile-only review); `.grid-cols-5` CSS class undefined in `layout.css` |
| User management (suspend, reactivate) | **Partial** | `public/admin/users.html`, `users.js`, `GET /api/admin/users[/:id]`, `PATCH /:id/status` (`adminPeopleService.js`) | No search input or user detail modal in `users.html` (backend supports both); suspending does not explicitly call `revokeAllUserSessions` (though session lookup checks `status === 'ACTIVE'`) |
| Request & match management | **Partial** | `public/admin/requests.html`, `requests.js`, `adminRequestService.js`, `matchingService.js` (3 tabs, 4 modals, venue edit/confirm, find matches, propose + override) | Table column count mismatch in Interests (6 vs 7) and Matches (7 vs 8); `startsOn` missing in request list; admin reject/cancel does not cascade to proposals/assignments; no UI to mark `COMPLETED` or cancel confirmed assignments |
| Cancellations & replacements | **Partial** | Volunteer 5-day lock & emergency cancellation sets `REPLACEMENT_REQUIRED` and alerts admin (`assignmentService.js`); admin can re-propose from `REPLACEMENT_REQUIRED` | Admin cannot view `adminAlert` notifications (no `/api/admin/notifications` endpoint); `ConfirmedAssignment.replacedById` is never linked; candidate cancel does not trigger replacement/cleanup |
| Reports | **Partial** | `public/admin/reports.html`, `reports.js`, `GET /api/admin/reports` (`adminReportService.js` — 4 MongoDB `$group` aggregations) | No date-range filters, turnaround/SLA metrics, match-rate stats, or CSV export |
| Audit logs | **Partial** | `AdminAuditLog.js`, `auditService.js`, `GET /api/admin/audit` (paginated), 10-row widget on `admin/dashboard.html` | No dedicated Audit Logs UI page with pagination/filters; FAQ CRUD actions are not audited; `getUser` views not audited |
| **Matching** | | | |
| Mandatory rules first + weighted score + explainable result | **Partial** | `server/services/matchingService.js` (`scoreVolunteer`, `findPotentialMatches`, `proposeMatch`): filters by same exam interest, active/complete volunteer, venue confirmed, overlap block, verification check; weighted 30/25/20/15/10 score + `scoreBreakdown` + `compatibility.reasons` & `matrix` | Qualification score (15%) only checks `profile.subjects.length > 0` (does not check volunteer qualification against candidate/exam rules; qualification fields deprecated in `VolunteerProfile.js`) |
| No double-booking of a volunteer | **Partial** | `server/utils/conflictChecker.js` (`checkVolunteerConflict` with 45-min travel buffer) enforced on `setInterest`, `proposeMatch` (non-overridable), `acceptInvitation`, and `confirmMatch` | Application-level read-then-write only (no DB-level constraint or transaction), so concurrent acceptances/confirmations can race |
| **Workflow** | | | |
| 12-status request lifecycle with history | **Partial** | All 12 statuses defined in `ScribeRequest.js` and `requestStateMachine.js` (`DRAFT` through `COMPLETED`, `REJECTED`, `CANCELLED`, `REPLACEMENT_REQUIRED`); `RequestStatusHistory.js` records transitions | `DRAFT` and `AWAITING_CANDIDATE_CONFIRMATION` are never entered by normal flows; `proposeMatch`, `acceptInvitation`, `declineInvitation`, `confirmMatch`, `declineMatch`, and `cancelAssignment` mutate `request.status` directly without calling `assertTransition` |
| **General** | | | |
| In-app notifications | **Partial** | `Notification.js`, `notificationService.js`, `/api/notifications/*`, `alertSchedulerService.js` (2-day unresolved alerts), toast alerts (`public/js/notifications.js`) | No Notifications inbox page or header bell dropdown anywhere in UI; no `/api/admin/notifications` route for `adminAlert` notifications |
| Help/FAQ, About, Privacy, Terms | **Partial** | `public/help.html`, `about.html`, `privacy.html`, `terms.html`; backend `FAQ.js`, `GET /api/public/faqs`, `/api/admin/faqs` CRUD | `help.html` is hardcoded (never fetches `/api/public/faqs`); no Admin FAQ management UI; `SupportRequest` model unused |
| Light/dark theme | **Partial** | CSS tokens in `public/css/base.css` & `themes.css`, FOUC-prevention inline script in `<head>`, `public/js/theme.js` | `theme.js` auto-runs `initTheme()` on load **and** 12 portal/login scripts call `initTheme()` again without an idempotency guard, attaching 2 click handlers that cancel each other out on every click |
| Responsive & accessible UI | **Partial** | Skip links, semantic landmarks (`header`/`nav`/`main`/`footer`), `:focus-visible`, `prefers-reduced-motion`, modal Escape/focus restore (`modal.js`), `aria-live` toasts, `role="progressbar"`, responsive media queries | `.nav-links` hidden below 640px with no hamburger menu HTML; `.grid-cols-5` missing in CSS; some modals (`cancel-modal`, `exam-modal`, `verification-modal`, `requests.html` modals) lack `role="dialog"`/`aria-modal="true"` or focus trapping |

---

## 4. UI Pages

| Expected Page | Route / File | Status | Notes / Placeholders / Hardcoded Data |
|---|---|---|---|
| Landing | `/` (`public/index.html`) | **Partial** | Static only — **does not load upcoming exams from DB** |
| Login / OTP | `/login.html` (`public/login.html`, `public/js/login.js`) | **Partial** | 3-step UI works, but includes hardcoded 1-click demo buttons (`+00012345001`, `+00012345002`) visible in all envs |
| Role selection & profile setup | `/login.html` (`#step-role`), `/candidate/profile.html`, `/volunteer/profile.html` | **Partial** | Role selection is Step 3 of `login.html`; profile setup is a single-page edit form (not step-by-step wizard) |
| Candidate dashboard | `/candidate/dashboard.html` (`public/js/candidate/dashboard.js`) | **Partial** | Stats cards always display `0` due to `data.stats` key mismatch |
| Exam list & details | `/candidate/examinations.html` + modal, `/volunteer/examinations.html` | **Partial** | Candidate modal renders `[object Object]` for rules & wrong session/link fields; Volunteer page has no detail modal and never marks existing interests |
| Request a scribe | `/candidate/request-form.html` (`public/js/candidate/request-form.js`) | **Partial** | Single-page form (no multi-step checklist/review); rules render `[object Object]` |
| My requests & matches | `/candidate/requests.html`, `/candidate/request-details.html` | **Partial** | No edit-request UI; `Exam Date` shows `TBD`; `Scribe Contact` hardcoded as `"Available via Penzo Support"`; `Verified` badge hardcoded |
| Volunteer dashboard | `/volunteer/dashboard.html` (`public/js/volunteer/dashboard.js`) | **Partial** | `Completed` stat always `0` (`completedSessions` not returned by API) |
| Interest form | `/volunteer/examinations.html`, `/volunteer/interests.html` | **Partial** | 1-click button only (no notes/confirmation form); Withdraw button broken (`DELETE /api/interests/undefined`) |
| Availability | *(none)* | **Missing** | Backend `/api/availability` exists, but no HTML/JS page exists |
| Invitations | `/volunteer/commitments.html` (`#invitations-section`) | **Done** | Combined into Commitments page with Accept (Commitment Agreement modal) & Decline modal |
| Commitments | `/volunteer/commitments.html` (`#commitments-section`) | **Done** | Includes 5-day lock badge & Emergency Cancellation modal; minor `s.date` bug in session display |
| Notifications | *(none)* | **Missing** | No page or header bell UI; only transient toast helper (`public/js/notifications.js`) |
| History | *(none)* | **Missing** | Backend `GET /api/history` exists, but no UI page for Candidate or Volunteer |
| Profile (Candidate & Volunteer) | `/candidate/profile.html`, `/volunteer/profile.html` | **Partial** | Live progress bar works; `email` and `mobile-display` blank on load; `NEEDS_CORRECTION` vs `REQUIRES_CORRECTION` mismatch |
| Admin login | `/admin/login.html` (`public/js/admin/login.js`) | **Done** | Separate email/password login portal |
| Admin dashboard | `/admin/dashboard.html` (`public/js/admin/dashboard.js`) | **Done** | 6 live metrics + 10 recent audit entries |
| Exam management | `/admin/examinations.html`, `/admin/examination-form.html` | **Partial** | No Archive button in list; form missing sessions, locations/regions, rules, eligibility, languages |
| Verification centre | `/admin/verification.html` (`public/js/admin/verification.js`) | **Done** | Metrics, filters, modal review, approve/reject/correction; `.grid-cols-5` CSS class undefined |
| User management | `/admin/users.html` (`public/js/admin/users.js`) | **Partial** | Filter by role/status + suspend/reactivate via `prompt()`; missing search bar and user-detail modal |
| Request & Match management | `/admin/requests.html` (`public/js/admin/requests.js`) | **Partial** | 3 tabs + 4 modals (Request Detail, Venue Confirm, Matching, Propose); table header/cell column mismatches; `startsOn` shows `—` |
| Reports | `/admin/reports.html` (`public/js/admin/reports.js`) | **Partial** | 4 live collection counts; no filters, charts, turnaround metrics, or export |
| Audit logs | *(none dedicated — 10 rows on `/admin/dashboard.html`)* | **Missing** | Paginated `/api/admin/audit` API exists, but no dedicated page |
| Help / FAQ | `/help.html` (`public/help.html`) | **Partial** | **3 hardcoded FAQ cards**; never calls `/api/public/faqs`; no Admin FAQ UI |
| About | `/about.html` (`public/about.html`) | **Done** | Static page with clear non-government disclaimer |
| Privacy | `/privacy.html` (`public/privacy.html`) | **Done** | Static privacy notice |
| Terms | `/terms.html` (`public/terms.html`) | **Done** | Static terms & conditions |

---

## 5. Database Design and Gaps

**Engine & ODM**: MongoDB via Mongoose (`server/models/*.js`). There are **22 model files** (17 actively used, 5 unused/duplicate). No migration runner exists (schema-on-write via Mongoose).

### Collections & Key Fields / Relations
1. **`User`** (`server/models/User.js`): `role` (`CANDIDATE`|`VOLUNTEER`), `mobileE164` (unique), `mobileVerifiedAt`, `email`, `status` (`ACTIVE`|`SUSPENDED`), `profileComplete`, `verificationStatus`, `termsAcceptedAt`, `privacyAcceptedAt`, `lastLoginAt`. Index: `{ role: 1, status: 1 }`.
2. **`AdminUser`** (`server/models/AdminUser.js`): `email` (unique), `name`, `passwordHash`, `isActive`, `failedLoginAttempts`, `lockedUntil`, `lastLoginAt`.
3. **`Session`** (`server/models/Session.js`): `tokenHash` (unique), `csrfToken`, `userId` (ref `User`), `adminId` (ref `AdminUser`), `expiresAt` (TTL index `expireAfterSeconds: 0`), `revokedAt`, `lastSeenAt`, `ipAddress`, `userAgent`. Indexes: `userId`, `adminId`, TTL `expiresAt`.
4. **`OtpChallenge`** (`server/models/OtpChallenge.js`): `mobileE164`, `codeHash`, `expiresAt` (TTL index), `maxAttempts`, `attempts`, `consumedAt`, `provider`, `ipAddress`, `sentAt`. Index: `{ mobileE164: 1, createdAt: -1 }`.
5. **`CandidateProfile`** (`server/models/CandidateProfile.js`): `userId` (unique ref `User`), `fullName`/`firstName`/`lastName`, `dateOfBirth`, `gender`, `languages`/`preferredLanguages`, `qualification`/`currentlyPursuing`/`education`, `city`/`preferredExamCity`/`state`/`pincode`, `disabilityType`/`disabilityDescription`/`assistanceNeeds`, `emergencyContactName`/`Phone`, `completionPercentage`, `verificationStatus`.
6. **`VolunteerProfile`** (`server/models/VolunteerProfile.js`): `userId` (unique ref `User`), `fullName`/`firstName`/`lastName`, deprecated `educationLevel`/`highestEducation`, `institution`, `occupation`, `languages`, `subjects`, `city`/`state`/`pincode`, `serviceRadiusKm`, `serviceLocations`, `hasPriorExperience`/`hasScribeExperience`, `previousScribeCount`, `bio`, `completionPercentage`, `verificationStatus`.
7. **`VerificationRecord`** (`server/models/VerificationRecord.js`): `userId` (ref `User`), `kind` (`IDENTITY`|`QUALIFICATION`|`ASSISTANCE_NEED`), `status`, `documentKey`, `reason`, `reviewedById` (ref `AdminUser`), `reviewedAt`, embedded `history[]`. Indexes: `{ userId: 1, kind: 1 }`, `{ status: 1 }`.
8. **`Examination`** (`server/models/Examination.js`): `name`/`title`, `slug` (unique), `authority`/`conductingBody`, `description`, `officialUrl`/`officialWebsite`, `notificationUrl`, `registrationOpensAt`, `registrationDeadline`, `startsOn`, `endsOn`, `status` (`DRAFT`|`PUBLISHED`|`UNPUBLISHED`|`ARCHIVED`), `publishedAt`, `isFeatured`, `isSampleData`, `informationSource`, `sourceType`, `lastVerifiedAt`, `adminNotes`, scribe info fields, `languagesAllowed[]`, embedded `sessions[]`, `locations[]`, `rules[]`. Indexes: `status`, `isFeatured`, `startsOn`.
9. **`ScribeRequest`** (`server/models/ScribeRequest.js`): `candidateId` (ref `User`), `examinationId` (ref `Examination`), `sessionId`, `reference` (unique, default `null`), `status` (12-value enum), `language`, `city`, `requirements`, `cancelReason`, embedded `venue` (`centreName`, `address`, `area`, `city`, `state`, `pincode`, `landmark`, `mapLink`, `confirmed`, `confirmedAt`, `confirmedBy`), `twoDayAlertSentAt`, `twoDayAlertCandidateSentAt`, `submittedAt`. Indexes: `{ candidateId: 1, status: 1 }`, `{ examinationId: 1, status: 1 }`.
10. **`RequestStatusHistory`** (`server/models/RequestStatusHistory.js`): `requestId` (ref `ScribeRequest`), `fromStatus`, `toStatus`, `actorType` (`CANDIDATE`|`VOLUNTEER`|`ADMIN`|`SYSTEM`), `actorUserId`, `actorAdminId`, `reason`. Index: `{ requestId: 1, createdAt: 1 }`.
11. **`MatchProposal`** (`server/models/MatchProposal.js`): `requestId`, `volunteerId`, `candidateId`, `examinationId`, `interestId`, `matchReference`, `score`, `scoreBreakdown` (5 fields), `compatibility`, `hasBlockingFailure`, `blockingReason`, `needsReview`, `isOverride`, `overrideJustification`, `adminNote`, `termsAccepted`/`Version`/`At`, `declineReason`, `candidateDeclineReason`, `status` (8-value enum), `reviewedById`, `invitedAt`, `respondedAt`. Indexes: `{ requestId: 1, status: 1 }`, `{ volunteerId: 1, status: 1 }`, `{ examinationId: 1 }`.
12. **`ConfirmedAssignment`** (`server/models/ConfirmedAssignment.js`): `requestId`, `matchProposalId`, `candidateId`, `volunteerId`, `startsAt`, `endsAt`, `status` (`CONFIRMED`|`CANCELLED`|`COMPLETED`), cancellation & 5-day lock fields (`lockDeadline`, `isLocked`, `isEmergencyCancelled`, `cancellationReason`, `cancellationExplanation`), `replacedById`, `termsAccepted*`. Indexes: `{ candidateId: 1, status: 1 }`, `{ volunteerId: 1, status: 1 }`, `{ requestId: 1 }`.
13. **`VolunteerInterest`** (`server/models/VolunteerInterest.js`): `volunteerId`, `examinationId`, `status` (`ACTIVE`|`WITHDRAWN`), `notes`, 4 confirmation booleans. Unique index: `{ volunteerId: 1, examinationId: 1 }`; index: `{ examinationId: 1, status: 1 }`.
14. **`VolunteerAvailability`** (`server/models/VolunteerAvailability.js`): `volunteerId`, `startsAt`, `endsAt`, `status` (`OPEN`|`COMMITTED`). Indexes: `{ volunteerId: 1, startsAt: 1 }`, `{ status: 1, startsAt: 1 }`.
15. **`Notification`** (`server/models/Notification.js`): `userId` (ref `User` — also stores `AdminUser._id` when `adminAlert: true`), `type`, `title`, `body`, `linkPath`, `readAt`, `idempotencyKey`, `adminAlert`, `requestId`. Indexes: `{ userId: 1, readAt: 1, createdAt: -1 }`, `{ idempotencyKey: 1 }` (sparse, **not unique**).
16. **`FAQ`** (`server/models/FAQ.js`): `question`, `answer`, `category`, `sortOrder`, `isPublished`. Indexes: `{ isPublished: 1, sortOrder: 1 }`, `{ category: 1 }`.
17. **`AdminAuditLog`** (`server/models/AdminAuditLog.js`): `adminId` (ref `AdminUser`), `action`, `entityType`, `entityId`, `details`, `ipAddress`. Indexes: `{ adminId: 1, createdAt: -1 }`, `{ entityType: 1, entityId: 1 }`, `{ createdAt: -1 }`.
18. **Unused / Redundant Models (5)**: `DocumentMetadata.js` (no upload routes), `SupportRequest.js` (imported in `adminMiscService.js:5`, never queried), and standalone `ExaminationSession.js`, `ExaminationLocation.js`, `ExaminationRule.js` (never imported; embedded inside `Examination.js` instead).

### Missing Constraints, Indexes & Schema Gaps
- **`ScribeRequest.reference` unique index is NOT sparse** (`server/models/ScribeRequest.js:9`): `{ unique: true, default: null }` will throw E11000 duplicate key errors if more than one `DRAFT` request has `reference: null`.
- **No DB-level duplicate-request constraint**: `ScribeRequest` lacks an `activeKey` partial unique index (`candidateId` + `examinationId`/`sessionId` where status is active).
- **No DB-level unique active assignment or overlap guard**: `ConfirmedAssignment` has no partial unique index on `{ requestId: 1 }` where `status: 'CONFIRMED'` and no concurrency lock/transaction for volunteer time overlap.
- **`VerificationRecord` index `{ userId: 1, kind: 1 }` is not unique**, allowing duplicate records under concurrent profile saves.
- **`Notification.idempotencyKey` index is sparse but NOT unique**, allowing duplicate scheduled alerts under race conditions; also mixes `User._id` and `AdminUser._id` into `userId`.
- **`MatchProposal.matchReference` has no unique index**; `AdminAuditLog` has no index on `action`; `Examination` has no text/compound index for search (`status`, `isFeatured`, `startsOn`).
- **Schema field drift**: `AdminUser.failedLoginAttempts` vs code's `failedLoginCount`; duplicate alias fields (`name`/`title`, `languages`/`preferredLanguages`, `qualification`/`education`, `hasPriorExperience`/`hasScribeExperience`, `cancelReason`/`cancellationReason`).

---

## 6. Security and Quality Findings

### Authentication & OTP
- **Strengths**: 6-digit OTPs generated with `crypto.randomInt`, HMAC-SHA256 hashed (`utils/crypto.js`), 300s expiry, 5-attempt cap; admin passwords hashed with `crypto.scrypt` (`N=32768`, `r=8`, `p=1`) with timing-safe verification and constant-time unknown-email `dummyHash`; session cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in prod, SHA-256 hashed in DB; `env.js` blocks `OTP_PROVIDER=development` in production.
- **Defects**:
  1. **Unauthenticated role overwrite**: `POST /api/auth/register` (`server/routes/auth.js:72-84`) accepts `{ mobile, role }` with **no auth, no OTP check, no CSRF, no rate limit**, allowing anyone to change any existing user's `role`.
  2. **Broken admin lockout**: `adminAuthService.js:35-38` reads/writes `admin.failedLoginCount`, which is absent from `AdminUser.js` (`failedLoginAttempts`), so failed login counts never save and accounts never lock.
  3. **Timing & race weaknesses in OTP**: `otpService.js:76` compares hashes with `===` instead of `utils/crypto.safeEqual`; `verifyOtp` uses non-atomic read-then-save (vulnerable to parallel brute-force race); `routes/auth.js:34-36` returns `devCode` in JSON response whenever `NODE_ENV !== 'production'` (contradicting `README.md`).
  4. **Missing `SESSION_SECRET` entropy check**: `server/config/env.js` accepts any non-empty string in production (doesn't enforce `>= 32` chars as documented).

### Authorization & CSRF
- **Protected routes**: `requireAdmin` wraps all `/api/admin/*` routes (`routes/admin.js:49`); `requireUser` + `requireRole(...)` wrap `/api/profile`, `/api/requests`, `/api/interests`, `/api/availability`, `/api/dashboard`, `/api/assignments`, `/api/history`, `/api/notifications`.
- **Defects**:
  1. **CSRF completely unenforced**: `requireCsrf` (`middleware/auth.js:83`) is **never mounted on any route**; `originGuard` (`middleware/auth.js:96-106`) is an empty no-op; `cors({ origin: true, credentials: true })` (`server/app.js:26-32`) reflects any cross-origin domain with credentials!
  2. **IDOR on proposed match**: `GET /api/requests/:id/proposed-match` (`server/routes/requests.js:49-82`) does **not** verify that `req.params.id` belongs to `req.auth.user._id`, letting any authenticated candidate inspect any other candidate's matched volunteer.
  3. **Cookie precedence conflict**: `attachSession` (`middleware/auth.js:20-44`) prioritizes `ADMIN_COOKIE` over `USER_COOKIE`; an admin testing candidate/volunteer portals in the same browser gets 401/403 on user endpoints.

### Input Validation, XSS, Injection & Sensitive Data
- **Validation**: `server/middleware/validate.js` is unused and minimal; routes pass raw `req.body` into services with ad-hoc checks. Invalid MongoDB ObjectIds cause unhandled `CastError` (500) and `errorHandler.js:10` returns raw `err.message` even on 500s.
- **Stored XSS (`javascript:` URLs)**: `venue.mapLink` is rendered directly in `<a href="${escapeHtml(venue.mapLink)}">` in `public/js/candidate/request-details.js:242`, `public/js/volunteer/commitments.js:187,479`, and `public/js/admin/requests.js:851` without validating `https?://` scheme.
- **ReDoS / Regex Injection**: Unescaped `new RegExp(search, 'i')` on user query params in `examinationService.js:11,15,18`, `adminExaminationService.js:12`, `adminPeopleService.js:17,158,166`, `adminRequestService.js:18`, and `matchingService.js:724`.
- **Unbounded pagination**: `admin.js`, `publicExaminations.js`, and `account.js` call `parseInt(req.query.pageSize, 10)` directly without clamping (ignoring `server/utils/pagination.js`).
- **Helmet CSP disabled**: `server/app.js:21` sets `contentSecurityPolicy: false`.
- **Sensitive data**: `assignmentService.js:78-79` returns raw `candidateMobile` and `volunteerMobile` even for cancelled assignments; `admin/users.html` and `admin/requests.html` expose full mobile numbers (expected for admin, acceptable).

### Accessibility Basics
- **Good**: All HTML pages include `<a href="#main-content" class="skip-link">`, semantic landmarks, associated `<label for>` elements, `:focus-visible` outlines (`base.css:193`), `prefers-reduced-motion` handling (`components.css:442`), `aria-live="polite"` toast container, `role="progressbar"` with `aria-valuetext`, and Escape/focus-restore in `public/js/modal.js`.
- **Gaps**: Mobile `.nav-links` disappear at `<=640px` with no `.hamburger` button in HTML; several modals (`exam-modal`, `cancel-modal`, `verification-modal`, `requests.html` modals) lack `role="dialog"` / `aria-modal="true"` and Tab focus trapping; `admin/users.js:91` and `admin/requests.js:198` rely on native `window.prompt()`/`confirm()`; broken `#theme-toggle` double-listener impairs dark/light contrast switching on portal pages.

---

## 7. Build and Test Results

Environment: Windows, Node `v20.11.0`, npm `10.5.0`. No `.env` file present; local MongoDB (`127.0.0.1:27017`) is **not running** (`Test-NetConnection` → `False`).

| Step | Command | Result | Details / Errors |
|---|---|---|---|
| **Install** | `npm ci` | **PASS** (with warnings) | Installed 175 packages in 7s. Warnings: deprecated `csurf@1.11.0` and `multer@1.4.5-lts.2` (both unused). `npm audit`: **8 vulnerabilities (2 low, 1 moderate, 5 high)**. |
| **Build** | *(no build script in `package.json`)* | **N/A** | Static HTML/CSS/ESM frontend + CommonJS Node backend; no bundler/transpiler configured. |
| **Lint** | *(no lint script or ESLint config)* | **Not configured** | No linter/formatter present in `package.json` or repo root. |
| **Syntax & App Load Check** | `node --check` on all `server/` & `scripts/` `.js` + `require('./server/app').createApp()` | **PASS** | Zero syntax errors across all server/script files; Express app factory instantiates cleanly. |
| **Unit Test (Offline)** | `node scripts/test-profile-completion-parity.js` | **PASS** | 11/11 candidate & volunteer profile completion parity assertions passed between `server/services/profileCompletion.js` and `public/js/profileCompletion.js`. |
| **Endpoint Test (`npm test`)** | `npm test` (`node scripts/test-endpoints.js`) | **FAIL (env)** | Exited code 1: `MongoDB connection failed: connect ECONNREFUSED 127.0.0.1:27017`. |
| **E2E Scripts (5 scripts)** | `test-login-flow.js`, `test-candidate-examinations-flow.js`, `test-admin-modal-behavior.js`, `test-admin-verification-matching-flow.js`, `test-enhancements-e2e.js` | **Not run (env)** | All 5 target `http://localhost:3000` and require both a running MongoDB instance and a live server. |

---

## 8. Phase Completion (Review-Slide Ready)

| Phase | % Complete | Status | Done vs. Pending (Plain Language) |
|---|---|---|---|
| **1. Foundation, database design, setup** | **75%** | In Progress | **Done:** Express server, MongoDB connection, 22 data models, seed/admin scripts, health endpoint, background scheduler. **Pending:** Add DB-level uniqueness/overlap constraints, remove 5 unused packages & 5 dead models, update outdated architecture/DB docs, add linter. |
| **2. Public site and theme** | **55%** | Partial | **Done:** Home, About, Help, Privacy, Terms pages with clear non-government disclaimers, light/dark CSS tokens, public exam/FAQ APIs. **Pending:** Wire Home page to show live upcoming exams from DB, wire Help page to DB FAQs, fix broken double-bound theme toggle, add mobile nav menu. |
| **3. Auth, OTP and profiles** | **65%** | Partial | **Done:** Mobile OTP challenge flow, separate scrypt admin login, HttpOnly DB sessions, RBAC guards, Candidate/Volunteer profile forms with live progress bar. **Pending:** Remove unauthenticated `/api/auth/register` flaw, mount CSRF protection, fix broken admin lockout, integrate real SMS provider, fix blank email/mobile fields, add document uploads. |
| **4. Candidate and volunteer portals** | **60%** | Partial | **Done:** Dashboards, exam browsing, request submission with venue & reference number, request tracking, match confirm/decline, volunteer interests, invitations with commitment agreement, 5-day lock & emergency cancel. **Pending:** Fix candidate `0`-stats bug, volunteer withdraw `undefined` bug, and `[object Object]` rules; add Availability, History, Notifications, and Edit Request UIs. |
| **5. Admin portal and exam management** | **70%** | Partial | **Done:** Admin dashboard, exam list/create/edit/publish/unpublish, full Verification Centre, user suspend/reactivate, request/venue/match management, live reports, audit logging. **Pending:** Add sessions/locations/rules inputs to exam form, add Archive button, build dedicated Audit Logs & FAQ admin pages, fix table column mismatches, cascade request cancellations. |
| **6. Matching, invitations, assignments** | **70%** | Partial | **Done:** Mandatory eligibility checks, 5-factor weighted scoring with explanations, 45-min conflict checker, venue-confirmed gate, override justification, full propose→accept→confirm→lock→replacement flow. **Pending:** Fix IDOR on proposed-match endpoint, enforce state machine on `declineMatch`/all transitions, link `VolunteerAvailability` locking, add DB-level double-booking guard. |
| **7. Notifications, reports, help pages** | **45%** | Partial | **Done:** Notification DB/API, automated 2-day unresolved alerts, toast UI, 4 live admin report aggregations, static Help/About/Privacy/Terms pages. **Pending:** Build in-app Notifications inbox & header bell, add `/api/admin/notifications` for admin alerts, connect Help page to DB FAQs, add report filters/CSV export. |
| **8. Testing, documentation, demo** | **50%** | Partial | **Done:** Fictional seed script with prod guard, 7 Node test scripts (parity test passes offline), detailed README and `.env.example`. **Pending:** Adopt a standard test runner with isolated test DB, fix outdated PostgreSQL/Prisma docs, remove hardcoded demo buttons for production, resolve 8 `npm audit` vulnerabilities. |

---

## 9. Ranked Risks and Recommended Next Steps

### Top 10 Risks & Bugs (Ranked by Severity)

| Rank | Severity | Issue | Evidence (File Path) | Suggested Fix |
|---|---|---|---|---|
| **1** | **Critical** | **Unauthenticated role-overwrite endpoint (`POST /api/auth/register`)** allows anyone knowing a mobile number to switch any user's role (`CANDIDATE` ↔ `VOLUNTEER`). | `server/routes/auth.js:72-84`, `public/js/login.js:152` | Delete `/api/auth/register` or require `requireUser` + `requireCsrf` and allow role selection **only** once during onboarding before OTP verify creates a profile (pass `role` directly to `/api/auth/otp/verify` or gate on `rolePending`). |
| **2** | **Critical** | **CSRF protection is completely unenforced** (`requireCsrf` never mounted on any route, `originGuard` is empty, `cors({ origin: true, credentials: true })` reflects any origin). | `server/middleware/auth.js:83-106`, `server/app.js:26-32,50`, `server/routes/*.js` | Restrict CORS `origin` to an explicit `CLIENT_ORIGIN` allowlist, implement host/origin verification in `originGuard`, and mount `requireCsrf` on all authenticated state-changing routers (`/api/profile`, `/api/requests`, `/api/interests`, `/api/availability`, `/api/assignments`, `/api/notifications`, `/api/admin`, `/api/auth/logout`, `/api/admin/auth/logout`). |
| **3** | **Critical** | **IDOR on `GET /api/requests/:id/proposed-match`**: does not verify the `ScribeRequest` belongs to `req.auth.user._id`, exposing other candidates' matched volunteer details. | `server/routes/requests.js:49-82` | Fetch `ScribeRequest.findOne({ _id: req.params.id, candidateId: req.auth.user._id })` first; return `404` if not found before querying `MatchProposal`. |
| **4** | **High** | **Admin brute-force lockout never activates**: `adminAuthService` reads/writes `admin.failedLoginCount`, while `AdminUser` schema defines `failedLoginAttempts`, so Mongoose drops the update. | `server/services/adminAuthService.js:35-38,51`, `server/models/AdminUser.js:9` | Change `failedLoginCount` to `failedLoginAttempts` in `adminAuthService.js` and add a unit/integration test asserting lockout after 5 wrong passwords. |
| **5** | **High** | **State-machine bypass & orphaned records on cancel/decline**: `declineMatch` resets any request (even `CONFIRMED`/`COMPLETED`) to `AWAITING_VOLUNTEER`; `cancelRequest` & admin reject/cancel don't withdraw `MatchProposal`s or cancel `ConfirmedAssignment`s; candidate `cancelAssignment` doesn't update `ScribeRequest`. | `server/services/matchingService.js:685-714`, `server/services/requestService.js:232-256`, `server/services/adminRequestService.js:155-192`, `server/services/assignmentService.js:221-228` | Call `assertTransition()` in every status-changing service function; unify cancellation into one shared service function (using MongoDB transactions on replica set) that cancels assignments, withdraws proposals, releases availability, and notifies both parties. |
| **6** | **High** | **Stored XSS via unvalidated `venue.mapLink` (`javascript:` URI)** rendered directly in `<a href>` across Candidate, Volunteer, and Admin portals. | `public/js/candidate/request-details.js:242`, `public/js/volunteer/commitments.js:187,479`, `public/js/admin/requests.js:851` | Add a shared `safeHttpUrl(url)` helper on both backend and frontend that parses via `new URL(url)` and only allows `http:` and `https:` protocols; re-enable Helmet CSP. |
| **7** | **High** | **ReDoS (unescaped `RegExp` on user search) & unbounded pagination** allow denial-of-service queries and raw 500 error leaks. | `server/services/examinationService.js:11-18`, `adminExaminationService.js:12`, `adminPeopleService.js:17,158,166`, `adminRequestService.js:18`, `matchingService.js:724`, `server/middleware/errorHandler.js:10` | Escape regex special chars (`str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`), wire `server/utils/pagination.js` (`parsePagination`) on every list route, validate ObjectIds, and mask `500` error messages in production. |
| **8** | **High** | **Multiple broken UI flows from API contract mismatches & double-bound theme toggle**: Candidate dashboard stats always `0`; Volunteer withdraw sends `DELETE /api/interests/undefined`; Volunteer browse ignores registered interests; Profile `email`/`mobile` blank; Exam rules show `[object Object]`; `#theme-toggle` fires twice (no-op) on all portals. | `public/js/candidate/dashboard.js:100-106`, `public/js/volunteer/interests.js:72,85`, `public/js/volunteer/examinations.js:66-67`, `public/js/candidate/profile.js:68,111`, `public/js/volunteer/profile.js:73,76`, `public/js/candidate/examinations.js:185-214`, `public/js/theme.js:15-43` | Guard `initTheme()` with a module-level `_initialized` flag; align frontend field access with actual API responses (`data.stats.*`, `i.examination.id`, top-level `data.email`/`data.mobile`, `r.title || r.body || r.rule`, `s.startsAt`, `officialUrl`); include `startsOn` in `requestService` & `adminRequestService` projections. |
| **9** | **Medium** | **Missing DB integrity constraints**: `ScribeRequest.reference` unique index is not `sparse: true` (breaks multiple `DRAFT`s); duplicate requests and volunteer double-booking rely only on racy app queries; `Notification.idempotencyKey` is not unique. | `server/models/ScribeRequest.js:9`, `server/models/ConfirmedAssignment.js`, `server/models/Notification.js:17`, `server/utils/conflictChecker.js` | Add `sparse: true` to `ScribeRequest.reference`, add partial unique indexes for active candidate requests and confirmed assignments per request, make `idempotencyKey` `{ unique: true, sparse: true }`, and wrap match confirmation in a transaction/atomic guard. |
| **10** | **Medium** | **Unimplemented live SMS OTP, `devCode` API leak, hardcoded demo buttons, and 5 high-severity unused dependency vulnerabilities (`csurf`, `multer@1.x`).** | `server/services/otpService.js:106-109`, `server/routes/auth.js:34-36`, `public/login.html:75-87`, `package.json` | Implement a real SMS gateway adapter via `otpSender.js`, remove `devCode` from HTTP responses (terminal-log only), hide demo login buttons behind a dev-only feature flag, and uninstall unused packages (`bcryptjs`, `connect-mongo`, `csurf`, `express-session`, `multer`). |

### Recommended Next Steps (Priority Order)
1. **Immediate Security Patch Sprint (Risks #1–#7)**: Remove `/api/auth/register` flaw, enforce `requireCsrf` + strict CORS + `originGuard`, fix `proposed-match` IDOR, fix `failedLoginAttempts` lockout, enforce `assertTransition` + cascading cancels, sanitize `mapLink` URLs, escape search regexes, and prune vulnerable unused npm packages.
2. **Fix Broken UI Contracts (Risk #8)**: Fix `theme.js` double-binding, candidate dashboard stats, volunteer interest list/withdraw, profile email/mobile display, exam rules/session rendering, and `admin/requests.html` column headers.
3. **Complete Missing User-Facing Pages & Wiring**: Fetch live exams on `public/index.html` and live FAQs on `public/help.html`; add Availability, Notifications (plus header bell + `/api/admin/notifications`), History, Admin Audit Logs, Admin Exam sessions/locations/rules/archive controls, and Candidate Edit Request UI.
4. **Harden Testing & Docs**: Replace stale PostgreSQL/Prisma docs in `docs/` with accurate MongoDB/Mongoose documentation, add ESLint, and run automated security + workflow tests against an isolated test MongoDB instance in CI.
