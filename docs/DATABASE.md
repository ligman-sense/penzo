# Database design

PostgreSQL via Prisma. Source of truth: `server/prisma/schema.prisma` (22 models, 15 enums).

## Groups
| Group | Models |
|---|---|
| Identity & sessions | `User` (candidates/volunteers), `AdminUser`, `Session`, `OtpChallenge` |
| Profiles | `CandidateProfile`, `VolunteerProfile` |
| Verification & documents | `VerificationRecord`, `DocumentMetadata` |
| Examinations | `Examination`, `ExaminationSession`, `ExaminationLocation`, `ExaminationRule` |
| Requests & matching | `ScribeRequest`, `RequestStatusHistory`, `MatchProposal`, `ConfirmedAssignment` |
| Volunteer side | `VolunteerExaminationInterest`, `VolunteerAvailability` |
| Platform | `Notification`, `FAQ`, `SupportRequest`, `AdminAuditLog` |

## Design decisions
- **Duplicate live requests blocked by `ScribeRequest.activeKey`** — set to `candidateId:sessionId` while a request is live and `NULL` after cancel/reject/complete. Its unique index prevents duplicates yet still allows a later re-request.
- **Overlapping assignments blocked in the database** — an `EXCLUDE USING gist` constraint on `ConfirmedAssignment` (see below). Application checks inside a transaction give friendly errors; the constraint is the backstop if two requests race.
- **History is never deleted** — `RequestStatusHistory.requestId` uses `onDelete: Restrict`; cancellations change status and keep the record. `AdminAuditLog` is append-only (no update/delete route).
- **OTPs and session tokens are stored hashed** (`codeHash`, `Session.tokenHash`).
- **Minimal sensitive data** — documents are metadata rows pointing at private storage; `assistanceNeeds` is free text meant for need-to-know descriptions, not diagnoses.
- **Exam times are full timestamps** (`startsAt`/`endsAt`) so overlap logic is exact. Prisma `DateTime` maps to `timestamp(3)` (no zone); the app stores **UTC instants** and the client displays session times in IST (`Asia/Kolkata`). Date-only columns (`startsOn`, `endsOn`) are shown as calendar dates.

## Creating the database
```bash
npm run db:up                         # start PostgreSQL (Docker)
npm run db:migrate -- --name init     # generates server/prisma/migrations/…_init
```

### One-time: constraints Prisma can't express
Prisma cannot declare exclusion or CHECK constraints, so they live in `server/prisma/sql/assignment_overlap.sql`:
```bash
cd server
npx dotenv -e ../.env -- prisma migrate dev --create-only --name db_constraints
# open the new prisma/migrations/…_db_constraints/migration.sql (empty) and paste the SQL file into it
cd .. && npm run db:migrate
```
This adds: no two `CONFIRMED` assignments for one volunteer may overlap in time, and `endsAt > startsAt` on sessions, availability and assignments.

## Matching-related enums
`RequestStatus`: DRAFT → SUBMITTED → PENDING_REVIEW → AWAITING_VOLUNTEER → MATCH_PROPOSED → VOLUNTEER_ACCEPTED → AWAITING_CANDIDATE_CONFIRMATION → CONFIRMED → COMPLETED, with REJECTED, CANCELLED and REPLACEMENT_REQUIRED branches. Valid transitions are enforced in the service layer (Phase 6).
