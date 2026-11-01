# Data Schemas

## Main models

- `User`: account identity, password/Google identity, role, email verification, refresh-token state.
- `Classroom`: teacher, enrolled students, class code, subject/section, and `courseStartDate` (the day-0 anchor for ML features).
- `Assignment`: classroom, teacher, due date, `maxMarks`, `weight` (currently interpreted as a percentage from 0–100), optional authenticated PDF metadata.
- `Submission`: student answer, URL/PDF metadata, `submittedAt`, grading status, marks, feedback, and graded timestamp.
- `ActivityEvent`: student, classroom, event type, optional source ID, and activity timestamp. Used to calculate distinct first-90-day active days.
- `Quiz`: classroom, teacher, questions with answer keys, difficulty, status, total marks.
- `QuizAttempt`: student, quiz, submitted answers, score, correct count, question count, and submission timestamp. The review is derived from the quiz answer key and the stored answers.
- `StudyMaterial`: classroom PDF and authenticated Cloudinary metadata.
- `Doubt`: student question and threaded replies.
- `Announcement`: classroom announcement.
- `Notification`: recipient and announcement notification state.

## ML data relationships

The ML controller reads `Classroom.courseStartDate`, classroom `Assignment` records, `Submission` records, and `ActivityEvent` records. It creates exactly six fields for each student. No demographic or manual student risk-profile model is required.

## Activity event types

`classroom_view`, `assignment_list_view`, `assignment_submission`, `quiz_list_view`, `quiz_attempt`, `announcement_list_view`, `doubt_list_view`, `resource_list_view`, `resource_download`, `doubt_created`, `doubt_reply`.
