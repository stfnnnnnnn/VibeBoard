# VibeBoard

**An all-in-one student life dashboard: grades, deadlines, money and habits in one place.**

VibeBoard brings together the four things a college student juggles every week. It tracks how you're doing in each subject and what you need to hit your target grade. It plans your week around classes and deadlines, and it keeps you on budget between allowances. It also helps you build habits that stick. Everything runs in one signed-in web app with a soft pink-and-blue glass design.

Built with Next.js 15 (App Router), React 19, TypeScript and MySQL. Deployable to Vercel.

---

## Features

### StudyPulse: grades and subjects
- **Subjects:** add subjects with course code, block section, units, year level and trimester. Each subject card shows your current grade as a ring.
- **Custom grading systems:** define grading periods (e.g. Midterm and Finals) with weighted categories (quizzes, tasks, exams). Single-score categories can be linked across periods. The final grade can be the average of the periods or a pooled "collective" grade. Presets are reusable.
- **Honest running grade:** the current grade counts only graded work, and shows what share of the grade is already in.
- **Grade scales:** 4.0-highest (A–F) and 1.0-highest (1.00–5.00) point scales, plus an optional transmutation table for raw-to-transmuted scores.
- **Target planner:** a deterministic projection, no AI guesswork. Pick a target and it tells you the average you need on your remaining items. Remaining items are your ungraded entries plus any extra items you plan for. It also includes:
  - a sandbox with one slider per remaining item, so you can try different scores;
  - "if you average X%" scenarios with letter outcomes;
  - a "closest reachable" grade when the target is out of reach;
  - a single-category what-if.
- **GWA calculator:** compute your general weighted average. Scan a grade report with on-device OCR (Tesseract.js) and export the result as an image or PDF.
- **Schedule maker:** build your weekly class schedule. It is shared with Workboard's timeline, including one-day reschedules and room changes.

### Canvas LMS integration
- **Connect Canvas in one click** with a bookmarklet that creates a scoped API token and pairs it with your account. Tokens are encrypted at rest (AES-256-GCM).
- **Course mapping:** map Canvas courses to your subjects. New assignments land in an **Activity Bank** for review instead of appearing in your grades unannounced.
- **Announcement routing:** turn announcements into tasks, events, reminders or schedule changes.
- **Automatic sync:** a Vercel Cron job runs every 30 minutes, and you can also sync manually.

### Workboard: plan the week
- **One view of all your work:** school items come straight from StudyPulse, with edits written back. Personal, project and organization work lives alongside them.
- **Views:**
  - **Focus**: what's up next, plus a week picker;
  - **Table**: inline editing of status, priority, deadline and links;
  - **Board**: a kanban;
  - **Timeline**: a weekly view that shows your classes and can zoom into a single day;
  - **Calendar**.
- Projects, organizations, subtasks, multiple links per item, filters, bulk actions and a command palette.

### Finance Tracker: allowance and budgets
- **Pace view:** see at a glance whether today's spending is on track for this allowance cycle.
- **Quick log:** a command bar (Ctrl+K) for logging expenses, income and savings in seconds.
- **Plan:**
  - allocation templates that split each allowance into budget envelopes;
  - recurring rules;
  - "safe to spend" amounts.
- **Goals:** savings goals on a timeline, plus a wishlist that answers "Can I afford it?" and a what-if simulator.

### Habit Tracker
- **Flexible habits:** fixed-schedule or flexible habits, yes/no or numeric tracking (e.g. "8 glasses").
- **Progress:** streaks based on consecutive scheduled days, check-in history and analytics.
- **Pause** a habit without breaking its streak.

### Dashboard and accounts
- A home dashboard with live weather and a daily quote.
- Email/password sign-in (bcrypt-hashed) and Google sign-in through Auth.js.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | [Next.js 15](https://nextjs.org) (App Router, Turbopack in dev), React 19, TypeScript |
| Styling | Tailwind CSS plus per-module CSS design tokens (light glassmorphism), self-hosted Inter and DM Sans |
| Auth | [Auth.js / NextAuth v5](https://authjs.dev) with credentials and Google providers |
| Database | MySQL / MariaDB through `mysql2` (raw SQL, no ORM) |
| UI libraries | lucide-react icons, Recharts, Sonner toasts |
| Client tools | Tesseract.js (OCR), jsPDF and html2canvas (exports) |
| Hosting | Vercel, with Vercel Cron for Canvas sync |

---

## Getting started

### Prerequisites
- Node.js 20 or newer
- A MySQL 8 or MariaDB 10.4+ database. XAMPP works fine for local development.

### 1. Install
```bash
git clone https://github.com/stfnnnnnnn/VibeBoard.git
cd VibeBoard
npm install
```

### 2. Create the database
```bash
mysql -u root -p -e "CREATE DATABASE vibeboard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
mysql -u root -p vibeboard < database/schema.sql
```
`database/schema.sql` contains the full table structure with no data. A few newer tables are also created or upgraded automatically at runtime by `src/lib/migrate.ts`.

### 3. Configure the environment
```bash
cp .env.example .env.local
```
Fill in the database credentials and an `AUTH_SECRET` (`npx auth secret` generates one). The remaining keys enable optional features:

| Key | Needed for |
|---|---|
| `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME` | Everything |
| `AUTH_SECRET`, `AUTH_URL` | Sign-in sessions |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | "Sign in with Google" |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google One Tap and the personalized Google button (same value as `GOOGLE_CLIENT_ID`). `NEXT_PUBLIC_*` values are inlined at build time, so set it before `npm run build` |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Sending password-reset and email-confirmation mail (a Gmail App Password, not the account password). Unset in dev: mail is printed to the server console |
| `EMAIL_FROM_NAME` | Optional sender display name (default `VibeBoard`) |
| `WEATHER_API_KEY`, `QUOTES_API_KEY` | Dashboard weather and quote widgets |
| `CANVAS_TOKEN_ENC_KEY` | Canvas integration (encrypting stored tokens) |
| `CRON_SECRET` | Scheduled Canvas sync |

### 4. Run
```bash
npm run dev
```
Open http://localhost:3000, create an account, and you're in.

## Google sign-in and email setup

1. **Google OAuth client** ([console](https://console.cloud.google.com/apis/credentials)):
   - Authorized JavaScript origins: `http://localhost:3000` (and your production URL later).
   - Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google`.
   - Put the client ID in both `GOOGLE_CLIENT_ID` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
   - The OAuth consent screen needs a privacy policy URL (`/privacy`) before publishing beyond "Testing".
2. **Email** (password reset and verification) is sent from a Gmail account with an App Password:
   - Turn on 2-Step Verification for that account.
   - Create an App Password at https://myaccount.google.com/apppasswords.
   - Set `GMAIL_USER` and `GMAIL_APP_PASSWORD`.
   - With these unset in development, emails (including reset links) are printed to the dev-server console.
3. The `/privacy` and `/terms` pages are drafts. Review them before deploying.

---

## Deploying to Vercel

1. Import the repository in Vercel. The framework preset is detected as Next.js.
2. Add the environment variables from `.env.example`, pointing `DB_*` at a database that Vercel can reach (a hosted MySQL instance, not `localhost`). Use a freshly generated `AUTH_SECRET` and set `AUTH_URL` to your production URL.
3. Deploy. `vercel.json` registers the Canvas sync cron (`/api/canvas/sync/cron`, every 30 minutes). Vercel sends `CRON_SECRET` with each call automatically.

---

## Project structure

```
src/
  app/            Pages and API routes (App Router)
    api/          REST endpoints per module: studypulse, canvas, workboard, finance, habits, auth, ...
    studypulse/   Subjects, subject view, GWA calculator, schedule, Canvas
    workboard/    Weekly planner
    finance/      Finance tracker
    habits/       Habit tracker
  components/     UI, grouped by module
  lib/            Server and shared logic (DB pool, migrations, Canvas client, pure domain logic)
database/
  schema.sql      Full schema (structure only)
  migrations/     Historical migration scripts
docs/             Design specs, implementation plans and development logs
scripts/          Test runners and the style-gate check
public/           Static assets, self-hosted fonts, transmutation table
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server (Turbopack) |
| `npm run build` / `npm start` | Production build and serve |
| `npm run lint` | ESLint |
| `node scripts/sp-test.mjs` | StudyPulse unit tests (grade projection, period model, formatting) |
| `node scripts/wb-test.mjs` | Workboard unit tests |
| `node scripts/fin-test.mjs` | Finance unit tests |
| `node scripts/wb-style-gate.mjs <files>` | Design-token style check (hex colours, type sizes, motion rules) |

Type-check with `npx tsc --noEmit`.

---

## Background

VibeBoard began as a PHP and MySQL project and was rebuilt module by module in Next.js and TypeScript. The legacy PHP pages have been retired. Design specs and implementation plans for each rebuild are in [`docs/superpowers`](docs/superpowers), and development logs are in [`docs/devlog`](docs/devlog).
