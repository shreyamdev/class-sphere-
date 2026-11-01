# Quiz Attempt Review

After a student submits a quiz, the backend grades the submitted answers and returns a `review` array. Each item includes the question, the student's selected answer, the correct answer, `isCorrect`, and a status (`correct`, `incorrect`, or `unanswered`).

The correct answer is never included in the quiz-taking response before submission. The review is returned only from the successful submit response or an endpoint scoped to the authenticated student who owns the attempt.

## Endpoints

- `POST /api/quizzes/:quizId/submit` — returns the score and immediate answer review.
- `GET /api/quizzes/student/attempts` — returns the student's own history, including per-question review.
- `GET /api/quizzes/student/attempts/:attemptId/review` — returns the detailed review for one of the authenticated student's own attempts.

Example review item:

```json
{
  "questionIndex": 0,
  "question": {
    "question": "2 + 2?",
    "options": ["3", "4", "5"]
  },
  "selectedAnswer": "3",
  "correctAnswer": "4",
  "isCorrect": false,
  "status": "incorrect"
}
```

A missing answer is shown with `selectedAnswer: null` and `status: "unanswered"`. The endpoint checks ownership using both the attempt ID and authenticated student ID; students cannot retrieve another student's review.
