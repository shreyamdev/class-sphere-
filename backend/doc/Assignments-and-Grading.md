# Assignments and Grading

Assignments belong to a classroom and teacher. Students enrolled in the classroom can submit text, a URL, and/or a PDF. PDF attachments are stored as authenticated raw files in Cloudinary.

## Assessment weight

Each assignment has `maxMarks` and `weight`. The current ML integration interprets `weight` as a 0–100 percentage and computes `weighted_score` as the sum of `(percentage score * weight / 100)`. The backend defaults a missing weight to 100 for backwards compatibility. Confirm this contract against the ML training notebook before production predictions.

## Late submissions

The submission endpoint accepts late work. It records `submittedAt`; the ML feature calculation compares this timestamp with the assignment `dueDate`. Late submissions are not blocked at the API layer. A graded submission contributes to the model's late-submission metric when its timestamp is after the due date.

## Routes

- `POST /api/classrooms/:id/assignments` — teacher creates assignment; multipart form-data is supported for an optional PDF.
- `GET /api/classrooms/:id/assignments` — classroom member lists assignments.
- `GET /api/assignments/:id/attachment` — classroom member retrieves assignment PDF.
- `POST /api/assignments/:id/submit` — enrolled student submits work; late submissions are accepted.
- `GET /api/assignments/:id/submissions` — owning teacher views submissions.
- `GET /api/assignments/:assignmentId/submissions/:submissionId/attachment` — owning teacher retrieves a student's PDF.
- `PATCH /api/assignments/:assignmentId/submissions/:submissionId/grade` — owning teacher grades work.
- `GET /api/assignments/:id/my-submission` — enrolled student views their submission and grade.
