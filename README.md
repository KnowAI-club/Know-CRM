# Know CRM

An open-source, self-hosted CRM for studios, agencies and service businesses. It covers the full journey from first enquiry to paid invoice: leads, sales pipeline, nurture sequences, follow-ups and meetings, deal closing, project delivery with a client portal, GST-ready invoicing, reports, team collaboration and access control.

Everything runs on your own machine or server. There are no third-party SaaS integrations: files are stored on local disk, email goes through any SMTP server (a local Mailpit catcher is bundled for development), and booking pages, lead forms and the client portal are served by the app itself.

## Features

| Module                    | What it does                                                                                                                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lead management**       | Capture leads manually, through hosted lead forms, booking pages or CSV import. Sources, industries, owners, temperature, attachments, notes, comments with @mentions and a full change history.                                                   |
| **Sales pipeline**        | Configurable stages with a kanban board and list view, stage timing, optimistic locking so two people can't overwrite each other, and CSV export.                                                                                                  |
| **Nurtures**              | Park leads that aren't ready (exit status, reason, tags, resume date), run email sequences with day/time schedules and merge fields, track sent/replied, pause, discard and restore.                                                               |
| **Follow-ups & meetings** | Meetings for leads and projects (video, phone, in person), guest suggestions, notifications, outcome recording with next steps, reminders, and self-hosted booking pages with availability, notice periods and guest reschedule/cancel links.      |
| **Deal closing**          | Close a lead as won with value and due date; the CRM creates the client, the delivery project and its milestones in one step. Proposal documents with priced services, questions, client decisions and typed signatures.                           |
| **Project delivery**      | Project stages and board, milestones, tasks, internal and client-visible notes, file versions, meetings, documents, messages, time tracking and an activity log.                                                                                   |
| **Client portal**         | Clients sign in to follow progress, read updates, download files, review and sign documents, message the team and view invoices.                                                                                                                   |
| **Invoicing & payments**  | Line items from a service catalog, GST components (CGST/SGST/IGST), instalments, part payments with idempotent recording and reversal, recurring invoices, overdue tracking, printable invoices and CSV exports. Expenses by category and project. |
| **Reports & dashboard**   | Home metrics, my-day view, call stats, lead funnel and source reports, time-in-stage, and project delivery reports with CSV export.                                                                                                                |
| **Team collaboration**    | Tasks, @mentions, in-app notifications with per-type preferences, email and reminder templates, global search across the workspace.                                                                                                                |
| **Security & access**     | Roles (admin, sales, designer, developer, client), session cookies with CSRF origin checks, scrypt password hashing, rate-limited sign-in, per-project client access and an audit log.                                                             |

## Tech stack

- **Web:** Next.js (App Router), React, TypeScript, Tailwind CSS
- **API:** Node.js, Express, TypeScript, Zod validation
- **Database:** PostgreSQL with plain SQL migrations
- **Background worker:** in-process job runner with a PostgreSQL advisory lock (email outbox, reminders, nurture sends, recurring invoices)
- **Monorepo:** npm workspaces — `apps/web`, `apps/api`, `packages/shared` (money and tax maths, domain constants shared by both apps)

## Quick start

Requirements: Node.js 22.13+ and Docker (for PostgreSQL and Mailpit). You can also point the app at your own PostgreSQL and SMTP server instead.

```bash
git clone https://github.com/KnowAI-club/Know-CRM.git
cd Know-CRM
cp .env.example .env          # change POSTGRES_PASSWORD for anything beyond local use
npm install
npm run db:up                 # PostgreSQL on :5440, Mailpit on :1030 (UI on :8030)
npm run db:seed               # optional: runs migrations and loads a demo workspace
npm run dev                   # API on :4010, web on :3010
```

Open http://127.0.0.1:3010.

- **With demo data:** sign in as `admin@example.com` / `demo-password-123`. The seed also creates `sam@example.com` (sales), `jamie@example.com` (designer) and `client@example.com` (client portal), all with the same password.
- **Without demo data:** the first visit shows a setup screen where you create the admin account and the workspace.

Every email the app sends in development is caught by Mailpit at http://127.0.0.1:8030.

## Scripts

Run from the repository root.

| Command                     | Description                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run dev`               | Start shared package watcher, API and web in watch mode                                     |
| `npm run build`             | Build all packages for production                                                           |
| `npm start`                 | Start the built API and web servers                                                         |
| `npm run db:up` / `db:down` | Start or stop the local PostgreSQL and Mailpit containers                                   |
| `npm run db:migrate`        | Apply pending database migrations (the API also migrates on start)                          |
| `npm run db:seed`           | Migrate and load the demo workspace (skipped if users already exist; refused in production) |
| `npm run typecheck`         | Type-check every workspace                                                                  |
| `npm run lint`              | Lint every workspace                                                                        |
| `npm test`                  | Run the API integration tests against an isolated `knowcrm_test` schema                     |
| `npm run format`            | Format the codebase with Prettier                                                           |

## Configuration

All settings live in `.env` at the repository root; `.env.example` documents every variable.

| Variable                                    | Purpose                                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `APP_ORIGIN`                                | Public URL of the web app. Used for origin checks and for links in emails, booking pages and lead forms. |
| `DATABASE_URL`                              | PostgreSQL connection string. `DATABASE_SCHEMA` optionally selects a schema (default `public`).          |
| `STORAGE_DIR`, `MAX_UPLOAD_MB`              | Where uploaded files are written on local disk and the upload size limit.                                |
| `MAIL_ENABLED`, `SMTP_*`, `MAIL_FROM`       | Outgoing email. With `MAIL_ENABLED=false` messages are only recorded in the outbox table.                |
| `WORKER_ENABLED`, `WORKER_INTERVAL_SECONDS` | Background jobs. Disable on extra API replicas if you run more than one.                                 |
| `COOKIE_SECURE`, `SESSION_DAYS`             | Session cookie settings. Set `COOKIE_SECURE=true` behind HTTPS.                                          |
| `API_INTERNAL_URL`, `WEB_PORT`              | Where the web server proxies `/api` requests, and its port.                                              |

## Project structure

```
apps/
  api/                 Express API
    src/modules/       One folder per module (routes, validation, business rules)
    src/db/            Connection pool, migrations, demo seed
    src/jobs/          Background jobs (mail outbox, reminders, recurring invoices…)
    test/              Integration tests
  web/                 Next.js app
    src/app/(app)/     Team workspace pages
    src/app/portal/    Client portal
    src/app/book/      Public booking pages
    src/components/    UI kit, shell and module components
packages/
  shared/              Invoice maths, mentions, merge fields and domain constants
```

The browser only ever talks to the web origin; Next.js proxies `/api/*` to the Express server, so cookies stay first-party and no CORS setup is needed.

## Production deployment

1. Provision PostgreSQL and an SMTP server, then set `DATABASE_URL`, `SMTP_*`, `MAIL_FROM`, a real `APP_ORIGIN` and `COOKIE_SECURE=true` in `.env`.
2. `npm ci && npm run build`
3. `npm start` (migrations run automatically when the API starts).
4. Put a reverse proxy with HTTPS (for example Caddy or nginx) in front of the web port.
5. Back up the PostgreSQL database and the `STORAGE_DIR` directory together.

## Contributing

Issues and pull requests are welcome. Please use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages, and run `npm run typecheck`, `npm run lint` and `npm test` before opening a pull request. Notable changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## License

Know CRM is licensed under the [GNU Affero General Public License v3.0](LICENSE).
