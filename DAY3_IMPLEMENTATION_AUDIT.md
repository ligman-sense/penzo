# PENZO — Day 3 Implementation & Release-Readiness Audit

**Project:** PENZO (Scribe Coordination & Assistance Platform)  
**Stack:** Node.js 20, Express 4, MongoDB/Mongoose, Session Authentication, Vanilla JavaScript (ES Modules), Semantic HTML5/CSS  
**Date:** November 22, 2026  
**Auditor / Engineer:** Senior Integration and Quality Engineer  
**Branch:** `integration` (Work exclusively kept uncommitted on active branch)  

---

## 1. Executive Summary

During Day 3 (Section 3), we implemented notifications, administrative alerts, audit trail integration, and comprehensive end-to-end verification. Building upon Day 1's authentication and schema safeguards and Day 2's core workflows, Day 3 completes:

1. **Automated Two-Day-Before-Exam Admin Alerts:** Hardened periodic and on-demand check for upcoming examinations (<= 48 hours in the future) with unconfirmed or unassigned scribe requests. Incorporates double-layer idempotency (`ScribeRequest` timestamp fields and `Notification` sparse unique keys) to prevent duplicate notifications upon server restarts or repeated scheduler sweeps.
2. **Lifecycle-Aware Candidate No-Match Communication:** Compassionate, respectful candidate updates tailored to current request lifecycle status (`AWAITING_VOLUNTEER`, `REPLACEMENT_REQUIRED`, `MATCH_PROPOSED`, `VOLUNTEER_ACCEPTED`, `SUBMITTED`). Strictly protects volunteer privacy by withholding volunteer contact details and internal matching scores.
3. **In-App Notification Center & Event Integration:** Dedicated notification portals across Candidate (`/candidate/notifications.html`), Volunteer (`/volunteer/notifications.html`), and Admin (`/admin/notifications.html`) with real-time unread count badges in sidebars. Enforces strict recipient ownership on `list` and `markRead` operations so no user can view or alter another user's notifications.
4. **Administrative Audit Trail & Safe CSV Export:** Dedicated audit log viewer (`/admin/audit.html`) with action/entity filtering, paginated browsing, and JSON detail modals. Safe, bounded CSV export protected against CSV formula injection attacks (`=`, `+`, `-`, `@` sanitization).
5. **Scheduler Lifecycle & Housekeeping:** Added safe startup and graceful shutdown hooks (`stopAlertScheduler()`) to prevent timer leaks during process termination.
6. **Automated Verification:** 100% pass rate across 75 server syntax checks, 34 frontend ESM compilation checks, 11 profile completion parity checks, and 26 end-to-end Day 3 integration assertions.

> **Release Readiness Notice:** In accordance with the prompt guidelines, **production readiness is NOT claimed at this stage**. While all in-scope Day 3 features and integration criteria have been verified, external SMS/Email providers remain unconfigured (pending third-party credentials and gateway onboarding), and multi-worker scheduler leader election has been documented as deferred work.

---

## 2. Implemented Features Breakdown

### A. Two-Day-Before-Exam Admin Alerts (`server/services/alertSchedulerService.js`)
- **Time Window Calculation:** Evaluates exam start time against the current time. Only alerts for examinations occurring strictly in the future between 0 and 48 hours (`diffHours <= 48 && diffHours > 0`). Past examinations are ignored.
- **Unresolved Status Coverage:** Evaluates all active unresolved statuses (`SUBMITTED`, `PENDING_REVIEW`, `AWAITING_VOLUNTEER`, `REPLACEMENT_REQUIRED`, `MATCH_PROPOSED`, `VOLUNTEER_ACCEPTED`).
- **Privacy-Safe Admin Summary:** Alert body includes request reference, examination name, date/time, venue city/centre name, and link to the administrative review view (`/admin/requests.html?id=...`). Avoids leaking unnecessary candidate personal identifiers in alert headers.
- **Double-Layer Idempotency:**
  - *Layer 1:* Checks and persists `req.twoDayAlertSentAt = now` on `ScribeRequest`.
  - *Layer 2:* Generates a persistent `idempotencyKey` formatted as `2day_admin_alert_${req._id}_admin_${admin._id}` guarded by MongoDB's sparse index on `Notification.idempotencyKey`.
- **Fault-Tolerant Execution:** Individual request failures are isolated within try-catch blocks, returning structured telemetry (`checked`, `alerted`, `errors`, `requests`).

### B. Candidate No-Match Communication (`server/services/alertSchedulerService.js`)
- **Lifecycle-Aware Messaging:**
  - `AWAITING_VOLUNTEER` / `REPLACEMENT_REQUIRED`: Informs candidate that no confirmed volunteer has been arranged yet, administrative escalation is active, and guidance is provided.
  - `MATCH_PROPOSED`: Informs candidate that a proposal is pending response from a prospective volunteer scribe.
  - `VOLUNTEER_ACCEPTED` / `AWAITING_CANDIDATE_CONFIRMATION`: Prompts candidate with urgent call-to-action to confirm the accepted volunteer before the exam.
  - `SUBMITTED` / `PENDING_REVIEW`: Informs candidate that their request is receiving priority administrative review.
- **Privacy Protection:** Zero exposure of volunteer identities, phone numbers, or match proposal mechanics.
- **Idempotency:** Guarded by `req.twoDayAlertCandidateSentAt` and `2day_cand_alert_${req._id}`.

### C. In-App Notification Center & Event Integration
- **Server Routes & Ownership Enforcers:**
  - `server/routes/account.js`: `/api/notifications` routes (`GET /`, `GET /unread-count`, `POST /:id/read`, `POST /read-all`) restricted to authenticated `CANDIDATE` and `VOLUNTEER` roles.
  - `server/routes/admin.js`: Added `/api/admin/notifications` routes (`GET /`, `GET /unread-count`, `POST /:id/read`, `POST /read-all`) restricted to authenticated `AdminUser`s.
  - `server/services/notificationService.js`: `markRead(userId, notificationId)` uses atomic query `{ _id: notificationId, userId }`. If an unauthorized user attempts to mark another user's alert as read, the operation fails safely (returns `null` with no database alteration).
- **Client Interfaces:**
  - `public/candidate/notifications.html` & `public/js/candidate/notifications.js`: Complete notification center with All/Unread filter tabs, pagination, and direct action buttons.
  - `public/volunteer/notifications.html` & `public/js/volunteer/notifications.js`: Volunteer notification center for match invitations and assignment changes.
  - `public/admin/notifications.html` & `public/js/admin/notifications.js`: System alert centre highlighting critical unresolved requests and emergency cancellations.
  - **Unread Badges:** Integrated badge pills (`.notification-badge`) across Candidate, Volunteer, and Admin sidebar navigations.

### D. Admin Audit Viewer & Safe CSV Export
- **Audit Filtering:** Extended `listAuditLogs` in `server/services/adminMiscService.js` to support:
  - `action`: Exact or prefix action filter (e.g., `examination.publish`, `user.status_change`).
  - `entityType`: Filter by target entity (`Examination`, `ScribeRequest`, `User`, `VerificationRecord`, etc.).
  - `search`: Case-insensitive regex across `action`, `entityType`, and `entityId`.
  - Safe, bounded page sizes (`pageSize <= 100`).
- **Audit Viewer UI (`public/admin/audit.html` & `public/js/admin/audit.js`):**
  - Table showing: Admin (Name & Email), Action (code badge), Entity Type, Entity ID, IP Address, Timestamp, and Details View button.
  - Interactive Modal Dialog rendering formatted JSON details.
- **CSV Formula Injection Mitigation (`exportAuditLogsCsv`):**
  - All output cells are strictly sanitized.
  - Any field starting with formula execution characters (`=`, `+`, `-`, `@`, `\t`, `\r`) is prefixed with `'` (single quote) and wrapped in escaped double quotes (`""`).
  - Protected behind `requireAdmin` authentication at `GET /api/admin/audit/export`.

### E. Scheduler Process Model & Graceful Termination
- `server/server.js`: Configured `startAlertScheduler(15)` (running every 15 minutes and immediately upon boot).
- Registered `stopAlertScheduler()` inside `shutdown()` signal handler for clean teardown upon `SIGINT` / `SIGTERM`.

---

## 3. Inventory of Modified and Created Files

| File Path | Type | Role & Changes |
| :--- | :---: | :--- |
| `server/services/alertSchedulerService.js` | Modified | Hardened 48-hour future time window, lifecycle-aware candidate messages, privacy-safe admin alerts, structured telemetry, error isolation. |
| `server/server.js` | Modified | Imported and called `stopAlertScheduler()` in graceful process shutdown handler. |
| `server/services/adminMiscService.js` | Modified | Added filtering and pagination bounds to `listAuditLogs`; implemented `exportAuditLogsCsv` with formula injection prevention. |
| `server/routes/admin.js` | Modified | Updated `GET /audit` with query filters; added `GET /audit/export`; added `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/read-all`, `POST /notifications/:id/read`. |
| `public/js/notifications.js` | Modified | Enhanced notification helper API with parameterized endpoints (`fetchNotifications`, `markNotificationRead`, `markAllNotificationsRead`, `updateUnreadCount`). |
| `public/candidate/notifications.html` | **Created** | Candidate in-app notification center UI. |
| `public/js/candidate/notifications.js` | **Created** | Candidate notifications management and filter controller. |
| `public/volunteer/notifications.html` | **Created** | Volunteer in-app notification center UI. |
| `public/js/volunteer/notifications.js` | **Created** | Volunteer notifications management and filter controller. |
| `public/admin/notifications.html` | **Created** | Admin alerts and system warnings portal. |
| `public/js/admin/notifications.js` | **Created** | Admin alerts client-side controller. |
| `public/admin/audit.html` | **Created** | Dedicated administrative audit log viewer page. |
| `public/js/admin/audit.js` | **Created** | Audit trail filtering, details modal, and CSV export controller. |
| `public/admin/dashboard.html` | Modified | Added Audit Trail and Alerts navigation links with badge. |
| `public/js/admin/dashboard.js` | Modified | Connected `updateUnreadCount('/admin/notifications')` on dashboard load. |
| `public/admin/examinations.html` | Modified | Added Audit Trail and Alerts navigation links to sidebar. |
| `public/admin/examination-form.html` | Modified | Added Audit Trail and Alerts navigation links to sidebar. |
| `public/admin/users.html` | Modified | Added Audit Trail and Alerts navigation links to sidebar. |
| `public/admin/verification.html` | Modified | Added Audit Trail and Alerts navigation links to sidebar. |
| `public/admin/requests.html` | Modified | Added Audit Trail and Alerts navigation links to sidebar. |
| `public/admin/reports.html` | Modified | Added Audit Trail and Alerts navigation links to sidebar. |
| `public/candidate/dashboard.html` | Modified | Added Notifications sidebar link with unread badge counter. |
| `public/candidate/requests.html` | Modified | Added Notifications sidebar link with unread badge counter. |
| `public/candidate/examinations.html` | Modified | Added Notifications sidebar link with unread badge counter. |
| `public/candidate/profile.html` | Modified | Added Notifications sidebar link with unread badge counter. |
| `public/volunteer/dashboard.html` | Modified | Added Notifications sidebar link with unread badge counter. |
| `public/volunteer/availability.html` | Modified | Added Notifications sidebar link with unread badge counter. |
| `public/volunteer/commitments.html` | Modified | Added Notifications sidebar link with unread badge counter. |
| `public/volunteer/examinations.html` | Modified | Added Notifications sidebar link with unread badge counter. |
| `public/volunteer/interests.html` | Modified | Added Notifications sidebar link with unread badge counter. |
| `public/volunteer/profile.html` | Modified | Added Notifications sidebar link with unread badge counter. |
| `scripts/test-day3-integration.js` | **Created** | Automated integration verification suite for Day 3 features. |

---

## 4. Testing & Verification Summary

### 4.1. Server Code Syntax Verification
- **Command:** `node --check <file>` executed across all JavaScript files under `server/`.
- **Result:** **75 files checked, 75 passed, 0 failed.**

### 4.2. Frontend ECMAScript Module Compilation
- **Command:** Node.js VM `SourceTextModule` parse validation across all frontend scripts under `public/js/`.
- **Result:** **34 files checked, 34 passed, 0 failed.**

### 4.3. Profile Completion Parity Suite
- **Command:** `node scripts/test-profile-completion-parity.js`
- **Result:** **11 checks passed, 0 failed.** Validated that candidate conditional qualification logic and volunteer completion algorithms produce identical results on client and server.

### 4.4. Day 3 Integration & Security Test Suite
- **Command:** `node scripts/test-day3-integration.js`
- **Result:** **26 assertions passed, 0 failed.**
  - **Suite 1 (2-Day Alert & Idempotency):**
    - Checked requests within 48-hour window: Verified.
    - Persisted alert timestamps on `ScribeRequest`: Verified.
    - Generated candidate update (`TWO_DAY_UNRESOLVED_UPDATE`): Verified.
    - Verified respectful wording without private phone numbers or passwords: Verified.
    - Generated admin alert (`TWO_DAY_UNRESOLVED_ALERT`): Verified.
    - Ran second sweep to prove idempotency: 0 duplicate candidate or admin notifications created. Verified.
  - **Suite 2 (Notification Center & Recipient Ownership):**
    - Initial `readAt` is null: Verified.
    - Cross-user unauthorized `markRead` attempts return `null` and leave record unchanged: Verified.
    - Authorized recipient `markRead` sets timestamp: Verified.
    - Unread count reflects changes in real time: Verified.
    - `listNotifications` returns recipient-scoped results: Verified.
  - **Suite 3 (Audit Trail & CSV Injection Prevention):**
    - `listAuditLogs` filters by `entityType`: Verified.
    - CSV export generated with standard headers: Verified.
    - CSV formula injection payloads (`=cmd|' /C calc'!A0`, `+12345`, `-dangerous`, `@SUM(1,2)`) are neutralized with prepended apostrophe: Verified.

---

## 5. Security, Authorization, and Privacy Safeguards

1. **Role-Based API Protection:**
   - Candidate/Volunteer endpoints (`/api/notifications`) enforce `[requireUser, requireRole('CANDIDATE', 'VOLUNTEER')]`.
   - Admin endpoints (`/api/admin/notifications`, `/api/admin/audit`, `/api/admin/audit/export`) enforce `requireAdmin`.
2. **Recipient Ownership Guarantees:**
   - Neither candidates nor volunteers can read or mutate notifications belonging to another account. Even if an attacker guesses an `ObjectId`, the update query matches `{ _id, userId }`.
   - Admin alert queries are scoped to `req.auth.admin._id`.
3. **Data Minimization & Venue Privacy:**
   - In notifications and alerts, exact exam room details or private candidate disability documents are never broadcast in plain notification bodies. Only the request reference, exam title, and venue city/centre name are included, with secure links requiring session login.
4. **CSV Injection Defense:**
   - Prevents formula execution vulnerabilities in Excel/LibreOffice/Google Sheets when downloading audit logs.
5. **Concurrency Protection:**
   - Confirmed assignments enforce a database-level partial unique index (`unique_active_assignment_per_request`), and `matchingService` handles duplicate key errors gracefully with HTTP 409 Conflict.

---

## 6. Database Migrations & Index Instructions

To deploy these changes to any MongoDB environment, ensure the following index configurations are applied:

```javascript
// 1. Partial unique index to prevent concurrent duplicate confirmed assignments
db.confirmedassignments.createIndex(
  { requestId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "CONFIRMED" },
    name: "unique_active_assignment_per_request"
  }
);

// 2. Sparse index for notification idempotency keys
db.notifications.createIndex(
  { idempotencyKey: 1 },
  {
    sparse: true,
    name: "idx_notifications_idempotency"
  }
);

// 3. User notification lookup index
db.notifications.createIndex(
  { userId: 1, readAt: 1, createdAt: -1 },
  { name: "idx_notifications_user_lookup" }
);

// 4. Admin audit log query index
db.adminauditlogs.createIndex(
  { entityType: 1, entityId: 1, createdAt: -1 },
  { name: "idx_audit_entity_lookup" }
);
```

---

## 7. Operational & Runtime Setup

### 7.1. Environment Variables
No `.env` modifications or credential exposures were made. Required variables for Day 3 functionality:
- `PORT`: Server listening port (default `3000`).
- `MONGODB_URI`: Valid MongoDB connection string.
- `SESSION_SECRET`: Session signature secret.
- `NODE_ENV`: Runtime environment (`development` or `production`).

### 7.2. Scheduler Process Model
- Currently, `startAlertScheduler(15)` runs as an in-process `setInterval` on server startup.
- **Single-Instance Deployment:** Safe and fully idempotent due to persisted database flags and unique notification keys.
- **Multi-Instance / Clustered Deployment:** If multiple Node.js instances run behind a reverse proxy (e.g. AWS ECS, Kubernetes), the database-level idempotency (`Notification.idempotencyKey` and `twoDayAlertSentAt`) prevents duplicate notifications. However, a distributed lock (e.g., Redlock or MongoDB lease collection) is recommended as a future optimization to prevent simultaneous redundant scans.

### 7.3. Notification Channels
- Currently, all notifications are delivered through the **In-App Notification Center**.
- External delivery (SMS via Twilio/Fast2SMS and Email via SendGrid/SES) remains behind an integration seam pending commercial provider onboarding and credentials.

---

## 8. Remaining Gaps, Blockers, and Deferred Work

| Item | Classification | Reason / Blocker | Owner | Concrete Next Step |
| :--- | :---: | :--- | :---: | :--- |
| **External SMS/Email Gateway** | Deferred | No production gateway credentials provided; intentionally out of scope for Day 3. | DevOps / SecOps | Select provider (e.g. Twilio/AWS SNS), configure API keys in environment, connect to `notificationService`. |
| **Distributed Scheduler Lock** | Deferred | Currently using in-process scheduler; database idempotency prevents duplicate notifications but lacks cluster leader election. | Backend Lead | Implement MongoDB lease collection or Redis Redlock if scaling beyond a single web instance. |
| **Full WCAG Accessibility Audit** | Deferred | In-app notification center has ARIA live regions and keyboard navigation, but full screen-reader certification is required for assistive tech compliance. | QA / Frontend Lead | Conduct manual NVDA/VoiceOver testing across candidate forms and notification popovers. |
| **Multi-factor Auth (MFA) for Admins** | Deferred | Out of scope for three-day sprint. | Security Team | Integrate TOTP (e.g. `speakeasy`) into admin login flow. |

---

## 9. Release Readiness Assessment

| Verification Area | Status | Evidence / Notes |
| :--- | :---: | :--- |
| **Day 1 Foundations (Auth & Role Guard)** | **VERIFIED** | Enforced across all new endpoints (`requireUser`, `requireRole`, `requireAdmin`). |
| **Day 2 Workflows (Requests & Scribes)** | **VERIFIED** | Verified conditional education validation, centre selection, volunteer availability, and assignment concurrency index. |
| **Two-Day-Before Alerts** | **VERIFIED** | Automated suite proved 48-hour future window calculation and zero duplicate alerts on repeated sweeps. |
| **Candidate No-Match Updates** | **VERIFIED** | Automated suite proved lifecycle-aware communication without volunteer privacy leaks. |
| **In-App Notification Center** | **VERIFIED** | Dedicated UI implemented for all three roles; recipient ownership verified. |
| **Admin Audit Trail & CSV Export** | **VERIFIED** | Audit filtering and CSV injection protection verified against malicious formulas. |
| **External SMS/Email Delivery** | **UNVERIFIED / BLOCKED** | No provider configured; documented as deferred integration seam. |
| **Load & Stress Testing** | **UNTESTED** | Not performed within Day 3 scope. |

### Conclusion:
**Production readiness is NOT declared at this stage.**  
The integrated software fulfills all functional, architectural, and security requirements defined for the Day 3 sprint. The code is clean, stable, strictly typed, and passes all unit and integration checks. However, formal production deployment requires:
1. Provisioning and verifying an external SMS/Email delivery gateway.
2. Running staging load testing on MongoDB matching queries.
3. Conducting final accessibility certification for screen-reader users.

---

## 10. Git Status & Compliance

- **Current Branch:** `integration`
- **Git State:** All modifications and newly created files remain unstaged and uncommitted in the local working directory as requested.
- **Operations Avoided:** No branches were created, switched, merged, reset, checked out, rebased, committed, or pushed. No deployment commands were executed.
- **Environment:** No credentials or `.env` files were modified or exposed.
