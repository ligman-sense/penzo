# PENZO — Complete Production Deployment Guide

A step-by-step, beginner-friendly guide for hosting the **PENZO** application in production using **Render** and **MongoDB Atlas**.

---

## Table of Contents

1. [Overview & Recommended Architecture](#1-overview--recommended-architecture)
2. [Hosting Platform Evaluation & Free-Tier Limits](#2-hosting-platform-evaluation--free-tier-limits)
3. [System Requirements & Supported Versions](#3-system-requirements--supported-versions)
4. [Step 1: MongoDB Atlas Database Setup](#4-step-1-mongodb-atlas-database-setup)
5. [Step 2: Connecting GitHub & Selecting Branch](#5-step-2-connecting-github--selecting-branch)
6. [Step 3: Render Web Service Configuration](#6-step-3-render-web-service-configuration)
7. [Step 4: Environment Variables Reference](#7-step-4-environment-variables-reference)
8. [Step 5: Super-Admin Initialization](#8-step-5-super-admin-initialization)
9. [Step 6: Post-Deployment Verification Checklist](#9-step-6-post-deployment-verification-checklist)
10. [Troubleshooting Common Deployment Issues](#10-troubleshooting-common-deployment-issues)
11. [Database Backup & Recovery Procedures](#11-database-backup--recovery-procedures)
12. [Redeployment, Updates & Rollbacks](#12-redeployment-updates--rollbacks)

---

## 1. Overview & Recommended Architecture

PENZO is architected as a **unified full-stack application**:
- **Frontend**: Vanilla JavaScript (ES Modules), accessible HTML5, responsive Chase Summer CSS.
- **Backend**: Node.js & Express.js.
- **Database**: MongoDB via Mongoose.
- **Serving Architecture**: Express serves both the static frontend portal (`/public`) and the REST API (`/api`). This avoids cross-origin friction, simplifies SSL/TLS certificates, and allows the entire project to run under a single hosted web service.

```
                      ┌──────────────────────────────────────────────┐
                      │          Cloudflare / Render Edge SSL        │
                      └──────────────────────┬───────────────────────┘
                                             │ HTTPS (Port 443)
                                             ▼
                      ┌──────────────────────────────────────────────┐
                      │          Render Web Service (Node.js)        │
                      │  ┌────────────────────┬───────────────────┐  │
                      │  │   Static Portals   │     REST API      │  │
                      │  │  (/candidate, etc) │      (/api/*)     │  │
                      │  └────────────────────┴───────────────────┘  │
                      └──────────────────────┬───────────────────────┘
                                             │ TLS (Port 27017)
                                             ▼
                      ┌──────────────────────────────────────────────┐
                      │           MongoDB Atlas (M0 Cluster)         │
                      └──────────────────────────────────────────────┘
```

---

## 2. Hosting Platform Evaluation & Free-Tier Limits

### Recommended: **Render (Web Service) + MongoDB Atlas (Database)**

| Component | Platform | Plan | Monthly Cost | Details |
|---|---|---|---|---|
| **Web Service (API + UI)** | Render | Free Tier | **$0.00** | 512 MB RAM, 0.1 CPU, automatic free SSL certificate. |
| **Database** | MongoDB Atlas | Free (M0 Sandbox) | **$0.00** | 512 MB storage, shared RAM, automatic replica set. |
| **Email (Password Reset)** | Resend | Free Tier | **$0.00** | 3,000 emails/month, 100 emails/day. |
| **Total Estimated Cost** | — | — | **$0.00 / month** | Suitable for academic, testing, and pilot deployments. |

### Free-Tier Operating Characteristics & Constraints

1. **Render Free-Tier Spin-Down (Inactivity Sleep)**:
   - If no web traffic is received for **15 consecutive minutes**, Render spins down the free instance into an idle state.
   - Upon the next incoming HTTP request, Render spins the container back up (**cold start**). Cold starts typically take **30 to 50 seconds**. Subsequent requests are fast and responsive.
   - *Upgrade Option*: If 24/7 instant response without cold starts is required in the future, upgrading to the **Starter Plan** costs **$7.00/month**.
2. **Ephemeral File Storage**:
   - Free instances use ephemeral container storage. Uploaded local files disappear when the instance restarts.
   - PENZO stores all candidate requests, volunteer commitments, verification records, and document metadata directly inside MongoDB Atlas, making records persistent across container restarts.
3. **Database Bandwidth & Connections**:
   - Atlas M0 supports up to **500 concurrent connections**, far exceeding typical academic or departmental needs.
   - Mongoose connection pooling is configured to `maxPoolSize: 10` to conserve database handles.

---

## 3. System Requirements & Supported Versions

- **Node.js**: `v20.x` LTS or `v22.x` LTS (validated with Node >= 20 in `package.json`).
- **npm**: `v10.x` or later.
- **MongoDB**: `v6.0`, `v7.0`, or `v8.0` (MongoDB Atlas runs the latest stable production engine).

---

## 4. Step 1: MongoDB Atlas Database Setup

Follow these steps to create your free, cloud-hosted MongoDB database:

1. **Sign Up**:
   - Visit [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) and register for a free account.
2. **Create a Database Cluster**:
   - In the Atlas Console, click **+ Create**.
   - Choose the **M0 (Free)** tier.
   - Select a Cloud Provider & Region geographically closest to your users (e.g., AWS / `ap-south-1` Mumbai or `eu-central-1` Frankfurt).
   - Click **Create Deployment**.
3. **Set Up Database User Authentication**:
   - Go to **Security > Database Access** from the left navigation menu.
   - Click **+ Add New Database User**.
   - Authentication Method: **Password**.
   - Username: e.g. `penzo_admin`.
   - Password: Click **Autogenerate Secure Password** or enter a strong password (save this safely!).
   - Database User Privileges: Select **Read and write to any database** (or **Atlas admin**).
   - Click **Add User**.
4. **Configure Network Access (Firewall Rules)**:
   - Go to **Security > Network Access** from the left navigation menu.
   - Click **+ Add IP Address**.
   - Select **Allow Access from Anywhere (`0.0.0.0/0`)**.
   - *Reason*: Render's free tier uses dynamic egress IP addresses from cloud IP pools. Allowing `0.0.0.0/0` with strong username/password authentication ensures uninterrupted connectivity.
   - Click **Confirm**.
5. **Obtain the Connection URI**:
   - Go to **Database > Clusters** and click **Connect**.
   - Choose **Drivers** (Node.js).
   - Copy the connection string. It will look like this:
     ```
     mongodb+srv://penzo_admin:<password>@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
     ```
   - Replace `<password>` with your actual database user password.
   - Append the database name `/penzo` before the query parameters:
     ```
     mongodb+srv://penzo_admin:YourPassword123@cluster0.abcde.mongodb.net/penzo?retryWrites=true&w=majority
     ```
   - Save this connection string for Step 4.

---

## 5. Step 2: Connecting GitHub & Selecting Branch

1. Ensure all deployment preparation changes are pushed to branch `depUpdate` on GitHub:
   ```bash
   git branch --show-current
   # Output must be: depUpdate
   ```
2. Log in to [Render](https://dashboard.render.com).
3. If this is your first time using Render, connect your GitHub account under **Account Settings > Connected Accounts**.

---

## 6. Step 3: Render Web Service Configuration

You can deploy using either **Option A (Render Blueprint)** or **Option B (Manual Web Service)**.

### Option A: Quick Blueprint Deployment (Recommended)

PENZO includes a pre-configured `render.yaml` file in the root directory.

1. In the Render Dashboard, click **New + > Blueprint**.
2. Select your `penzo` repository.
3. Select the branch: **`depUpdate`**.
4. Render will parse `render.yaml` and prompt you to input the secret environment variables (`MONGODB_URI`, `ADMIN_BOOTSTRAP_PASSWORD`, etc.).
5. Fill in the values and click **Apply**.

---

### Option B: Manual Web Service Setup

1. In the Render Dashboard, click **New + > Web Service**.
2. Choose **Build and deploy from a Git repository** and select your `penzo` repository.
3. Configure the service settings:
   - **Name**: `penzo` (or your preferred name, e.g. `penzo-portal`).
   - **Region**: Choose the region closest to your MongoDB Atlas cluster (e.g. `Oregon (US West)` or `Frankfurt (EU)`).
   - **Branch**: **`depUpdate`** *(Important: ensure this is set to `depUpdate`)*.
   - **Root Directory**: *(Leave blank)*.
   - **Runtime**: **`Node`**.
   - **Build Command**: `npm install`
   - **Start Command**: `npm run start`
   - **Plan**: **`Free`**.
4. Scroll to **Advanced Settings**:
   - **Health Check Path**: `/health`
   - **Auto-Deploy**: `Yes`
5. Click **Create Web Service**.

---

## 7. Step 4: Environment Variables Reference

In the Render Dashboard under your Web Service, navigate to **Environment** and add the following variables:

| Variable Name | Value / Format | Required? | Purpose |
|---|---|---|---|
| `NODE_ENV` | `production` | **Yes** | Enables production security, cookie encryption, and error masking. |
| `PORT` | `10000` | Optional | Port assigned by Render (automatically set to 10000 by default). |
| `MONGODB_URI` | `mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/penzo?retryWrites=true&w=majority` | **Yes** | Your MongoDB Atlas connection URI from Step 1. |
| `SESSION_SECRET` | 32+ character random hex string | **Yes** | Cryptographic key for session cookies. Generate via `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `TRUST_PROXY` | `1` | **Yes** | Informs Express that traffic passes through Render's HTTPS reverse proxy. |
| `ADMIN_BOOTSTRAP_EMAIL` | `admin@penzo.edu` | **Yes** | Initial Super-Admin email for first login. |
| `ADMIN_BOOTSTRAP_PASSWORD` | Strong password (e.g. `AdminSafePass2026!`) | **Yes** | Initial Super-Admin password. |
| `ADMIN_BOOTSTRAP_NAME` | `Super Administrator` | Optional | Display name for the Super-Admin. |
| `ENABLE_BACKGROUND_SCHEDULER` | `true` | **Yes** | Enables the 2-day unresolved-request alert scheduler. |
| `APP_URL` | `https://penzo.onrender.com` | Optional | Your Render public service URL. |
| `RESEND_API_KEY` | `re_xxxxxxxxxxxx` | Optional | Free Resend API key for password reset emails. If empty, OTPs are logged in server console. |
| `EMAIL_FROM` | `PENZO <onboarding@resend.dev>` | Optional | Sender address for Resend emails. |
| `OTP_PROVIDER` | `development` | Optional | Set to `development` for testing. |

---

## 8. Step 5: Super-Admin Initialization

PENZO provides **automatic idempotent provisioning** of the Super-Administrator account:

1. When the server boots on Render with `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` configured:
   - The application checks whether an admin account with that email already exists.
   - If not found, it automatically provisions the Super-Admin account with bcrypt password hashing.
   - If it already exists, it verifies the account and outputs `[BOOTSTRAP] Super-Admin verified.`
2. **Redeployment Safety**:
   - Redeploying or restarting the application will **never** overwrite, reset, or duplicate existing administrator credentials.
3. **Accessing the Portal**:
   - Access the Super-Admin portal at:
     ```
     https://<your-service-name>.onrender.com/admin/login.html
     ```
   - Enter the `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD`.

---

## 9. Step 6: Post-Deployment Verification Checklist

Once the deployment shows **Live** with a green badge in Render, perform this verification:

- [ ] **Health-Check**: Open `https://<your-app>.onrender.com/health` in your browser. Expected response:
  ```json
  {
    "status": "ok",
    "database": "connected",
    "timestamp": "2026-11-27T...",
    "uptime": 12
  }
  ```
- [ ] **Candidate Portal**: Visit `https://<your-app>.onrender.com/login.html` and sign in or register as a candidate.
- [ ] **Volunteer Portal**: Sign in or register as a volunteer.
- [ ] **Super-Admin Portal**: Visit `https://<your-app>.onrender.com/admin/login.html` and log in with your bootstrap admin credentials.
- [ ] **Examine Matching Flow**:
  1. Submit a candidate scribe request.
  2. Propose a match from Super-Admin portal (mandatory reporting time & meeting point).
  3. Volunteer confirms invitation.
  4. Confirm that Allocation ID (e.g. `PNZ20260001`) appears identically on both Candidate and Volunteer dashboards.
  5. Confirm that candidate and volunteer contact details remain strictly private.
  6. Volunteer withdraws -> Candidate receives apology notification -> Request returns to replacement queue.

---

## 10. Troubleshooting Common Deployment Issues

### Issue 1: `[DB CONNECTION FAILED] Unable to establish connection to MongoDB within 15000ms`
- **Cause 1**: `MONGODB_URI` environment variable is missing or empty in Render dashboard.
  - *Fix*: Go to Render > Web Service > Environment, verify `MONGODB_URI` is present and starts with `mongodb+srv://`.
- **Cause 2**: MongoDB Atlas IP Whitelist blocks the connection.
  - *Fix*: In MongoDB Atlas > Network Access, ensure `0.0.0.0/0` is added and Active.
- **Cause 3**: Incorrect password in connection string or unescaped special characters.
  - *Fix*: If your password contains `@`, `#`, or `/`, percent-encode them (e.g., `@` becomes `%40`) or use an alphanumeric password.

### Issue 2: `[FATAL CONFIG ERROR] SESSION_SECRET environment variable is required in production`
- **Cause**: In production mode (`NODE_ENV=production`), `SESSION_SECRET` must be explicitly provided.
- **Fix**: In Render > Environment, add `SESSION_SECRET` with any random string of 32 or more characters.

### Issue 3: Cold Start Delay / Initial Request Takes 40 Seconds
- **Cause**: Normal Render free-tier behavior after 15 minutes of inactivity.
- **Fix**: Wait for the first page load to finish; all subsequent requests will be fast. For production scenarios where instant loading is needed, upgrade the Render instance to Starter ($7/month).

### Issue 4: Cookies Not Persisting / Login Redirects to Login Page
- **Cause**: Reverse proxy trust is not enabled.
- **Fix**: Verify `TRUST_PROXY=1` is set in Render Environment variables.

---

## 11. Database Backup & Recovery Procedures

### Automated Backups
MongoDB Atlas provides built-in automated snapshot backups on paid tiers. On the free M0 tier, use the following manual backup options:

### Manual Backup Using `mongodump`
To back up your production data locally:
```bash
mongodump --uri="mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/penzo" --out="./backup_$(date +%Y%m%d)"
```

### Restoring from Backup Using `mongorestore`
To restore data if needed:
```bash
mongorestore --uri="mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/penzo" --drop "./backup_20261127/penzo"
```

---

## 12. Redeployment, Updates & Rollbacks

1. **Automatic Redeployment**:
   - Whenever you push new commits to the `depUpdate` branch on GitHub:
     ```bash
     git push origin depUpdate
     ```
   - Render automatically detects the push, runs `npm install`, and deploys the new release with zero manual intervention.
2. **Instant Rollback**:
   - In the Render Dashboard, go to **Deploys**.
   - Find any previous successful deployment.
   - Click the three dots `...` next to that commit and select **Rollback to this deploy**.
