# Backend Handoff — Current Implementation

## Current ML architecture

The current at-risk model requires six numeric features only: `num_assessments_done`, `avg_score`, `min_score`, `weighted_score`, `late_submissions`, and `active_days`. The former demographic/course-category risk profile workflow has been removed from the backend.

`Classroom.courseStartDate` defines day 0. Run `npm run migrate:ml-fields` once to backfill existing classrooms from `createdAt` and old assignments with `weight: 100`. The first 90 days are treated as day 0 through day 90 inclusive. Prediction is permitted from day 90 onward.

Activity days are sourced from `ActivityEvent`, which is written for assignment list/submission, quiz list/attempt, resource list/download, and doubt creation/reply. Assignment submission timestamps are also counted as activity for legacy records. Historical non-assignment interactions from before event tracking cannot be reconstructed.

`Assignment.weight` is currently a 0–100 percentage and `weighted_score` is the sum of `score * weight / 100`. Confirm that scale and meaning against the model notebook before production use.

## Quiz attempt review

A submitted quiz response and the student's attempt history contain question-level review: selected answer, correct answer, correctness, and unanswered status. `GET /api/quizzes/student/attempts/:attemptId/review` is restricted to the owner of the attempt. Quiz-taking responses continue to hide answer keys.

## Operational scripts

- `npm run migrate:ml-fields` — backfill fields; safe to run repeatedly.
- `npm run seed:demo` — destructive demo reset; requires `ALLOW_DATABASE_RESET=true` and an exact `RESET_DB_NAME` match.
- `npm run audit:orphans` — read-only orphan report by default.
- `npm run audit:orphans -- --apply` — destructive cleanup; requires `ALLOW_ORPHAN_CLEANUP=true` and exact `ORPHAN_CLEANUP_DB_NAME` match. Back up the database first.

## Separate Python service security

Node sends `X-Model-API-Key` and requires `MODEL_API_KEY`. The FastAPI service must independently validate the same secret on `/predict` and `/predict-batch`. Follow `ML-Service-Security-Contract.md`; this is a separate Python deployment change.

## Final checks before deployment

1. Confirm `Assignment.weight` matches the ML training notebook's scale and semantics.
2. Apply `MODEL_API_KEY` validation in the Python service and set the same secret on both deployments.
3. Run `npm ci` and `npm test`.
4. Verify Express startup with valid MongoDB and required environment variables.
5. Verify the day-90 endpoint against a classroom with realistic activity events.
6. Verify student quiz review and attempt ownership using two different student accounts.
7. Back up MongoDB before destructive cleanup or demo seeding.
