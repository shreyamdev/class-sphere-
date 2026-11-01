# Changelog and Testing

## Current backend updates

- Replaced the old risk-profile prediction input with the six-field XGBoost contract.
- Added `Classroom.courseStartDate` and a repeatable migration from legacy `createdAt` values.
- Added `ActivityEvent` tracking for meaningful student learning actions.
- Calculates activity days from course day 0 through day 90 inclusive.
- Adds `Assignment.weight` and retains late submission timestamps for the model's late-submission feature.
- Adds API-key header support for the separate FastAPI ML service.
- Removes all `StudentRiskProfile` model workflow references.
- Adds Cloudinary cleanup for assignment PDFs, student submission PDFs, and study-material PDFs when deleting a classroom.
- Adds a dry-run-by-default orphan audit script.
- Adds student quiz attempt review with their selected answer, correct answer, and correctness for each question.

## Automated tests

Run:

```bash
npm test
```

Current targeted tests include:

- AI service client URL, payload, response, and error handling.
- Authentication role enforcement.
- ML service input contract, key header, response shape, threshold consistency, and batch result count.
- ML metric calculations for score aggregation, late submissions, no-score defaults, and day-0/day-90 boundaries.
- Quiz review construction for correct, incorrect, and unanswered questions.

## Manual integration tests

1. Start Express with a reachable MongoDB and complete `.env`.
2. Create a classroom with an explicit `courseStartDate`.
3. Record student assignment, quiz, resource, and doubt activities.
4. Verify a prediction before day 90 returns `409 MODEL_WINDOW_NOT_REACHED`.
5. Verify a prediction on/after day 90 calls the protected FastAPI endpoint and returns the six input features.
6. Submit a quiz and verify the immediate `review` response shows selected and correct answers.
7. Fetch `/api/quizzes/student/attempts/:attemptId/review` as the owner and as another student; only the owner should succeed.
8. Delete a test classroom and verify its Cloudinary PDFs and MongoDB dependent records are removed.
9. Run the orphan audit without `--apply`; verify no changes are made.

## Limitations to verify with the ML owner

The model guide provides the weighted-score formula but does not define the exact ClassSphere assignment-weight scale. The backend currently treats weight as a percentage from 0 to 100. Confirm this against the notebook before using predictions for real student-support decisions.
