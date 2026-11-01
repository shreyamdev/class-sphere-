# ClassSphere Backend Documentation

This folder documents the current Express/MongoDB backend and its separately deployed AI/ML integrations.

## Feature guides

- `Authentication.md` — registration, OTP, login, token lifecycle, and roles.
- `Classroom-Management.md` — classroom creation, joining, editing, and deletion.
- `Assignments-and-Grading.md` — assignments, authenticated PDFs, submissions, grading, and assessment weights.
- `Study-Materials.md` — PDF uploads and downloads.
- `AI-Features.md` — summarization, flashcards, and quiz generation integrations.
- `ML-Performance-Insights.md` — six-feature day-90 XGBoost predictions and activity tracking.
- `ML-Service-Security-Contract.md` — required API-key validation in the separate Python service.
- `Quiz-Attempt-Review.md` — student review of selected answers against correct answers.
- `Analytics.md` — student and teacher analytics.
- `Announcements-and-Notifications.md` — classroom announcements and notifications.
- `Doubt-Forum.md` — student questions and replies.
- `Data-Schemas.md` — MongoDB model overview.
- `API-Index.md` — API routes and roles.
- `CHANGELOG-and-Testing.md` — current test and deployment checklist.
- `Backend-Fix-Handoff.md` — migration and operational handoff.

## Setup

1. Install Node.js 18 or newer.
2. Copy `.env.example` to `.env` and fill in real values.
3. Run `npm ci`.
4. Run `npm run migrate:ml-fields` once against the intended database to backfill `courseStartDate` and legacy assignment `weight` fields.
5. Run `npm test`.
6. Start locally with `npm run dev`.

Never commit `.env`, service API keys, JWT secrets, or Cloudinary credentials.
