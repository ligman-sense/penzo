# PENZO — Examination Scribe Coordination Platform

**Tagline:** Connecting Candidates with Examination Scribe Volunteers.

PENZO is an independent web application that helps candidates who require scribes for examinations connect with potential volunteer scribes. It is **not** an official government portal. Any match proposed by the platform is a potential match only — final eligibility and approval remain subject to the applicable examination authority's requirements.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5, CSS3, Vanilla JavaScript (ES6+) |
| Backend | Node.js, Express.js (CommonJS) |
| Database | MongoDB via Mongoose |
| Session | HttpOnly cookies, server-managed sessions |
| Auth (users) | Mobile OTP (HMAC-secured) |
| Auth (admin) | Email + scrypt password |

---

## Prerequisites

- **Node.js** ≥ 20 (LTS recommended)
- **MongoDB** ≥ 7.x locally, or a MongoDB Atlas cluster
- **npm** ≥ 10

---

## Quick Start

### 1. Install Dependencies

```bash
cd penzo
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values (see Environment Variables section)
```

### 3. Start MongoDB (local)

```bash
# Using system service:
mongod --dbpath ./data

# Or using Docker:
docker run -d -p 27017:27017 --name penzo-mongo mongo:7
```

### 4. Create the First Admin

```bash
# Set ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD in .env, then:
npm run admin:create
```

### 5. Seed Development Data (optional)

```bash
npm run seed
```

This creates clearly-labelled fictional examination and user records for testing. It **cannot** run in production (NODE_ENV=production is blocked).

### 6. Start the Application

```bash
# Development (with auto-restart on file changes):
npm run dev

# Production:
npm start
```

Open **http://localhost:3000** in your browser.

---

## Application Portals

| Portal | URL |
|--------|-----|
| Public Home | http://localhost:3000/ |
| Candidate Login | http://localhost:3000/login.html |
| Candidate Dashboard | http://localhost:3000/candidate/dashboard.html |
| Volunteer Dashboard | http://localhost:3000/volunteer/dashboard.html |
| Admin Login | http://localhost:3000/admin/login.html |
| Admin Dashboard | http://localhost:3000/admin/dashboard.html |

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | `development` or `production` |
| `PORT` | No | `3000` | HTTP port |
| `MONGODB_URI` | Yes | — | MongoDB connection string |
| `SESSION_SECRET` | Yes | — | Secret for session token signing (≥32 chars) |
| `SESSION_TTL_HOURS` | No | `12` | User session lifetime |
| `ADMIN_SESSION_TTL_HOURS` | No | `8` | Admin session lifetime |
| `OTP_PROVIDER` | No | `development` | `development` or `sms` |
| `OTP_TTL_SECONDS` | No | `300` | OTP expiry time |
| `OTP_MAX_VERIFY_ATTEMPTS` | No | `5` | Max wrong attempts before OTP is locked |
| `OTP_RESEND_COOLDOWN_SECONDS` | No | `30` | Wait time between OTP sends |
| `SMS_API_KEY` | When OTP_PROVIDER=sms | — | SMS gateway API key |
| `SMS_API_SECRET` | When OTP_PROVIDER=sms | — | SMS gateway API secret |
| `SMS_SENDER_ID` | No | `PENZO` | SMS sender ID |
| `ADMIN_BOOTSTRAP_EMAIL` | For admin:create | — | First admin email |
| `ADMIN_BOOTSTRAP_PASSWORD` | For admin:create | — | First admin password |
| `STORAGE_LOCAL_DIR` | No | `./storage` | Directory for uploaded documents |

---

## Development OTP Mode

When `OTP_PROVIDER=development`, the server **prints OTPs to the terminal** instead of sending an SMS:

```
[DEV OTP] code for +919876543210 is 123456  (development adapter, nothing was sent)
```

- This mode is **blocked in production** (`NODE_ENV=production` will refuse to start).
- The OTP is never returned by any API endpoint.
- This mode is for local testing only.

To use real SMS delivery:
1. Set `OTP_PROVIDER=sms`
2. Fill in `SMS_API_KEY` and `SMS_API_SECRET` for your SMS gateway
3. Implement the SMS call in `server/config/otpSender.js`

---

## SMS Provider Integration

Edit `server/config/otpSender.js` and implement the `send()` method in the `SmsOtpSender` class with your provider's API. Popular providers include Twilio, MSG91, and Fast2SMS.

---

## Creating the First Admin

The admin portal has no public registration. Provision the first admin using:

```bash
ADMIN_BOOTSTRAP_EMAIL=admin@yourcompany.com \
ADMIN_BOOTSTRAP_PASSWORD=YourSecurePassword123! \
ADMIN_BOOTSTRAP_NAME="Your Name" \
npm run admin:create
```

Or set these in `.env` and run `npm run admin:create`.

Subsequent admins can be added manually through MongoDB or by re-running the script with different credentials.

---

## User Roles

| Role | Description | Login Method |
|------|-------------|-------------|
| **Candidate** | Person who needs a scribe | Mobile OTP |
| **Volunteer** | Person who can provide scribe services | Mobile OTP |
| **Super Admin** | Platform administrator | Email + Password |

New users select their role (Candidate or Volunteer) after their first OTP verification.

---

## Project Structure

```
penzo/
├── public/                 # Frontend (HTML, CSS, JS)
│   ├── index.html          # Public landing page
│   ├── login.html          # OTP login
│   ├── about.html
│   ├── help.html
│   ├── privacy.html
│   ├── terms.html
│   ├── candidate/          # Candidate portal pages
│   ├── volunteer/          # Volunteer portal pages
│   ├── admin/              # Admin portal pages
│   ├── css/                # Stylesheets
│   │   ├── base.css        # Reset, design tokens
│   │   ├── layout.css      # Page layouts
│   │   ├── components.css  # UI components
│   │   ├── themes.css      # Light/dark themes
│   │   └── pages.css       # Page-specific styles
│   └── js/                 # Frontend JavaScript modules
│       ├── api.js           # API client
│       ├── auth.js          # Session management
│       ├── theme.js         # Dark/light mode
│       ├── navigation.js    # Nav and menus
│       ├── validation.js    # Form validation
│       ├── notifications.js # Toast alerts
│       ├── utils.js         # Shared utilities
│       ├── candidate/       # Candidate page scripts
│       ├── volunteer/       # Volunteer page scripts
│       └── admin/           # Admin page scripts
├── server/                 # Backend
│   ├── app.js              # Express app factory
│   ├── server.js           # Entry point
│   ├── config/
│   │   ├── database.js     # MongoDB connection
│   │   ├── env.js          # Environment validation
│   │   └── otpSender.js    # OTP delivery adapter
│   ├── models/             # Mongoose schemas
│   ├── middleware/         # Express middleware
│   ├── routes/             # API route handlers
│   ├── services/           # Business logic
│   ├── utils/              # Shared utilities
│   └── scripts/
│       └── createAdmin.js  # Admin provisioning
├── scripts/
│   └── seed.js             # Development seed data
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## API Overview

All API endpoints are under `/api/`. Key routes:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/otp/send` | Request an OTP |
| POST | `/api/auth/otp/verify` | Verify OTP and sign in |
| GET | `/api/auth/session` | Get current session |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/profile` | Get own profile |
| PUT | `/api/profile` | Update own profile |
| GET | `/api/public/examinations` | List published examinations |
| GET | `/api/public/examinations/:slug` | Examination details |
| GET | `/api/requests` | Candidate's scribe requests |
| POST | `/api/requests` | Create a scribe request |
| GET | `/api/interests` | Volunteer's examination interests |
| PUT | `/api/interests/:examId` | Express/update interest |
| GET | `/api/dashboard` | Dashboard data |
| GET | `/api/notifications` | Notifications |
| POST | `/api/admin/auth/login` | Admin sign in |
| GET | `/api/admin/examinations` | Admin exam management |
| GET | `/api/admin/users` | Admin user management |
| GET | `/api/admin/reports` | Reports |

---

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `MongoServerError: ECONNREFUSED` | MongoDB not running | Start MongoDB: `mongod` |
| `SESSION_SECRET is too short` | Secret not set | Set a 32+ char secret in `.env` |
| `OTP_PROVIDER=development is not allowed in production` | Wrong env | Set `OTP_PROVIDER=sms` or use `NODE_ENV=development` |
| `Cannot find module` | Dependencies not installed | Run `npm install` |
| Port already in use | Another process on port 3000 | Change `PORT=3001` in `.env` |

---

## Security Notes

- **Never commit `.env`** to version control
- **SESSION_SECRET** must be cryptographically random (≥ 32 chars)
- **Admin passwords** are hashed with scrypt (Node.js built-in, memory-hard)
- **OTP codes** are stored only as HMAC-SHA256 hashes
- **Session tokens** are stored only as SHA-256 hashes in MongoDB
- **HttpOnly cookies** prevent JavaScript access to session tokens
- **CSRF protection** is enforced on all state-changing API requests
- **Rate limiting** is applied to OTP and login endpoints
- **File uploads** are stored privately, not publicly accessible
- Do not expose MongoDB admin credentials in environment variables visible to the frontend

---

## Deployment

For production:
1. Set `NODE_ENV=production`
2. Set a strong `SESSION_SECRET`
3. Set `OTP_PROVIDER=sms` with real SMS credentials
4. Use MongoDB Atlas or a secured MongoDB instance
5. Use a reverse proxy (nginx) in front of Node.js
6. Enable HTTPS
7. Set appropriate CORS origins in `server/app.js`

---

## Limitations and Known Gaps

- SMS delivery requires integration with a real provider (MSG91, Twilio, etc.)
- File upload for verification documents is scaffolded but requires storage configuration
- The matching engine uses a basic scoring algorithm; weights can be tuned in `server/services/matchingService.js`
- Admin email notifications are not implemented (in-app notifications only)
- Matching is triggered manually by admin; automatic background matching is not implemented

---

## Academic Note

This project was developed as part of an MCA Web Application Development lab project. The PENZO platform concept and all data are fictional. Any resemblance to real government examinations or persons is coincidental.

*PENZO does not guarantee official eligibility or approval for any examination. Users should consult the relevant examination authority for official requirements.*
