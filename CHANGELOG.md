# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- Bundled Mailpit container. Email is now off by default (`MAIL_ENABLED=false`) until an SMTP server is configured.
- Nurtures module: sequences, tracking, discard and import, the Nurtures page, and the parked "nurture" lead state. Exited leads are now archived; existing parked leads are archived by migration 009.

### Added

- Docker images for the API and web app, and a Docker Compose stack that starts PostgreSQL, Mailpit, the API and the web app with a single `docker compose up -d`.
- `DEMO_SEED` setting to load the demo workspace when the API starts with an empty database.

### Changed

- The product is now called KnowBook CRM on the sign-in page, in the sidebar, in page titles, on public pages and in the default email sender.
- The API origin check also accepts the browser-facing host forwarded by the web proxy, so the app works whether it is opened via `localhost` or `127.0.0.1`.

## [0.1.0] - 2026-11-13

First public release.

### Added

- Monorepo with npm workspaces: Next.js web app, Express API and a shared package for invoice maths, mentions, merge fields and domain constants.
- Local infrastructure via Docker Compose: PostgreSQL and a Mailpit mail catcher. Uploads are stored on local disk.
- SQL migrations applied automatically on API start, and a demo workspace seed driven through the API.
- First-run setup, email and password sign-in, session cookies, origin checks, rate-limited auth and public endpoints, roles (admin, sales, designer, developer, client) and an audit log.
- Workspace settings, team management, billing details, file and reminder types, in-app notifications with per-type preferences and a background job runner.
- Lead management: configurable stages, sources and industries, owners, attachments, notes, comments with @mentions, tasks, change history, CSV export and optimistic locking.
- Sales pipeline board and list, stage timing, exit and nurture actions, and close-won that creates the client and delivery project.
- Nurtures: parked leads with exit status, tags and resume dates, email sequences with schedules and merge fields, tracking, discard and restore, lead import and test sends.
- Meetings for leads and projects with participants, notifications, outcomes, next steps, files and uploads of past meetings; reminders.
- Self-hosted booking pages with weekly availability, notice periods and guest reschedule or cancel links.
- Hosted lead forms that create a client, lead and intake project from each submission.
- Projects with stages, milestones, tasks, notes, file versions, messages, time tracking, activity log and CSV time export.
- Client portal with project progress, files, messages, documents and invoices.
- Proposal and contract documents built from blocks (headings, text, priced services, questions, signature), publishing, client responses, decisions and typed signatures; document templates.
- Invoices with service catalog lines, GST components, instalments, part payments with idempotency keys and reversal, recurring invoices, overdue tracking, printable layout and CSV exports.
- Expenses by category and project, and a service catalog.
- Email templates, global scored search, home dashboard, my-day view, call stats, lead and project delivery reports.
- Web app: responsive team workspace with sidebar navigation, light and dark themes, command-palette search (Ctrl/Cmd + K) and notifications.

[Unreleased]: https://github.com/KnowAI-club/Know-CRM/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/KnowAI-club/Know-CRM/releases/tag/v0.1.0
