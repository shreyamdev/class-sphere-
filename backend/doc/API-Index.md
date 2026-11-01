# Complete API Endpoint Index

Base URL: `http://localhost:5000`. Use `Authorization: Bearer <ACCESS_TOKEN>` for protected endpoints. Roles: `student`, `teacher`.

| Method | Endpoint | Access | Purpose / body |
|---|---|---|---|
| GET | `/api/health` | Public | Health check; no body |
| POST | `/api/auth/register` | Public | `{name,email,password,role?}` |
| POST | `/api/auth/verify-otp` | Public | `{email,otp}` |
| POST | `/api/auth/resend-otp` | Public | `{email}` |
| POST | `/api/auth/login` | Public | `{email,password,role}`; role must match the stored account role |
| POST | `/api/auth/google` | Public | `{idToken,role}`; role must match an existing account |
| POST | `/api/auth/refresh` | Public route; refresh token required in body | `{refreshToken}` |
| POST | `/api/auth/logout` | Public route; refresh token optional in body | `{refreshToken}` |
| GET | `/api/auth/me` | Authenticated user | No body |
| POST | `/api/classrooms` | Teacher | `{name,description?,subject?,semesterSection?,courseStartDate?}`; courseStartDate defaults to now |
| GET | `/api/classrooms` | Teacher or student | No body; own classrooms / enrolled classrooms |
| POST | `/api/classrooms/join` | Student | `{classCode}` |
| GET | `/api/classrooms/:id` | Teacher or student; must own/be enrolled | No body |
| PATCH | `/api/classrooms/:id` | Owning teacher | Any of `{name,description,subject,semesterSection,courseStartDate}` |
| DELETE | `/api/classrooms/:id/students/:studentId` | Owning teacher | No body; remove student |
| POST | `/api/classrooms/:id/leave` | Student | No body |
| DELETE | `/api/classrooms/:id` | Owning teacher | No body; destructive cleanup |
| POST | `/api/classrooms/:id/assignments` | Owning teacher | Multipart form-data: `title`, `description?`, `dueDate`, `maxMarks`, `weight?`, optional PDF `file`; weight defaults to 100 |
| GET | `/api/classrooms/:id/assignments` | Owner or enrolled student | No body |
| POST | `/api/assignments/:id/submit` | Enrolled student | `{answerText?,submissionUrl?}`; at least one required |
| GET | `/api/assignments/:id/submissions` | Assignment teacher | No body |
| PATCH | `/api/assignments/:assignmentId/submissions/:submissionId/grade` | Assignment teacher | `{marksObtained,feedback?}` |
| GET | `/api/assignments/:id/my-submission` | Enrolled student | No body |
| GET | `/api/assignments/:id/attachment` | Classroom member | No body; returns authenticated PDF |
| GET | `/api/assignments/:assignmentId/submissions/:submissionId/attachment` | Owning teacher | No body; returns student PDF |
| POST | `/api/classrooms/:id/materials` | Owning teacher | `multipart/form-data`: `file`, `title`, `description?` |
| GET | `/api/classrooms/:id/materials` | Owner or enrolled student | No body |
| GET | `/api/materials/:id/download` | Owner or enrolled student | No body; returns PDF binary |
| PATCH | `/api/materials/:id` | Owning teacher | `{title?,description?}` |
| DELETE | `/api/materials/:id` | Owning teacher | No body |
| POST | `/api/classrooms/:id/announcements` | Owning teacher | `{title,content}` |
| GET | `/api/classrooms/:id/announcements` | Owner or enrolled student | No body |
| PATCH | `/api/announcements/:id` | Announcement creator teacher | `{title?,content?}` |
| DELETE | `/api/announcements/:id` | Announcement creator teacher | No body; deletes its notifications |
| GET | `/api/notifications` | Authenticated user | No body; own notifications |
| PATCH | `/api/notifications/:id/read` | Authenticated recipient | No body |
| GET | `/api/analytics/student/overview` | Student | No body |
| GET | `/api/analytics/student/classrooms/:id` | Enrolled student | No body |
| GET | `/api/analytics/teacher/classrooms/:id` | Owning teacher | No body |
| GET | `/api/analytics/teacher/classrooms/:id/students` | Owning teacher | No body |
| GET | `/api/analytics/teacher/classrooms/:id/risk-predictions` | Owning teacher | No body; computes six features from classroom activity and calls the deployed ML service |
| POST | `/api/ai/summarize` | Student or teacher | `multipart/form-data` PDF field `file`; returns summary and flashcards |
| POST | `/api/ai/quizzes/generate` | Teacher | `{topic?,study_material?,num_questions?,difficulty?}`; returns MCQs including answer keys |
| POST | `/api/ai/quizzes/generate-from-pdf` | Teacher | `multipart/form-data`: PDF `file`, optional `num_questions`, `difficulty`; returns MCQs including answer keys |
| POST | `/api/quizzes` | Teacher | Save a quiz draft/published quiz with questions and answer keys |
| GET | `/api/quizzes/classrooms/:classroomId` | Owning teacher | List classroom quizzes; question keys are omitted |
| PATCH | `/api/quizzes/:quizId/publish` | Owning teacher | Publish a quiz |
| PATCH | `/api/quizzes/:quizId/unpublish` | Owning teacher | Unpublish only when no attempts exist |
| GET | `/api/quizzes/:quizId/results` | Owning teacher | View student attempts/results |
| GET | `/api/quizzes/student/classrooms/:classroomId` | Enrolled student | List published quizzes; answer keys are hidden |
| POST | `/api/quizzes/:quizId/submit` | Enrolled student | `{answers:[{questionIndex,selectedAnswer}]}`; returns score and marked-answer review after submission |
| GET | `/api/quizzes/student/attempts` | Student | Own attempt history with per-question review |
| GET | `/api/quizzes/student/attempts/:attemptId/review` | Attempt owner student | Own selected answers, correct answers, and correctness |
| GET | `/api/discussions/classrooms/:classroomId/doubts` | Classroom member | Paginated classroom doubts |
| POST | `/api/discussions/classrooms/:classroomId/doubts` | Enrolled student | `{title,description}` |
| POST | `/api/discussions/doubts/:doubtId/replies` | Classroom member | `{message}` |

## Notes

- `:id` means a path parameter, not a literal string. Replace it with the actual MongoDB ObjectId.
- Notification paths require `notificationRoutes` to be mounted at `/api/notifications` in `src/app.js`.
- ML prediction routes require both `MODEL_API_URL` and `MODEL_API_KEY`. Node sends `X-Model-API-Key`; the separate FastAPI service must validate it too. See `ML-Performance-Insights.md` and `ML-Service-Security-Contract.md`.
- Run `npm run migrate:ml-fields` once before deploying the new course-start and assignment-weight fields.
- Quiz review is only available after submission and only to the attempt owner; see `Quiz-Attempt-Review.md`.
- AI summarizer and quiz routes proxy to separately deployed services; configure `AI_SERVICE_URL` and `QUIZ_SERVICE_URL` before calling them. See `AI-Features.md`.
