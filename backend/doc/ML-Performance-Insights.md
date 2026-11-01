# ML Performance Insights — Current Backend Contract

## Architecture

The Express backend prepares academic features from ClassSphere data and calls a separately deployed FastAPI/XGBoost service. The Python service is stateless and has no database. The backend sends one JSON object per student to `POST ${MODEL_API_URL}/predict-batch` and receives results in the same order.

The current model uses exactly six numeric inputs:

| Field | Backend source/calculation |
|---|---|
| `num_assessments_done` | Count of graded assignment submissions submitted in the first 90 course days. |
| `avg_score` | Mean percentage score across those graded submissions. |
| `min_score` | Lowest percentage score across those graded submissions. |
| `weighted_score` | Sum of `score * assessment weight / 100`. |
| `late_submissions` | Count of those graded submissions submitted after the assignment due date. |
| `active_days` | Count of distinct course-relative days with a recorded student activity between day 0 and day 90 inclusive. |

If there are no scored assessments, `num_assessments_done`, `avg_score`, `min_score`, `weighted_score`, and `late_submissions` are sent as zero. `active_days` remains based on recorded platform activity.

## Observation window and course start

`Classroom.courseStartDate` defines day 0. The backend permits predictions from day 90 onward. Features are calculated from day 0 through the end of day 90 inclusive. This can represent 91 course-relative day numbers (0–90).

For existing classrooms, run `npm run migrate:ml-fields` once before deployment. That migration backfills missing `courseStartDate` values from `createdAt` and missing assignment weights to 100.

## Activity tracking

`ActivityEvent` records meaningful student actions. Current event types are:

- `classroom_view`
- `assignment_list_view`
- `assignment_submission`
- `quiz_list_view`
- `quiz_attempt`
- `announcement_list_view`
- `doubt_list_view`
- `resource_list_view`
- `resource_download`
- `doubt_created`
- `doubt_reply`

Only student actions are recorded. The ML controller counts distinct course-relative days, not event volume. Historical actions before ActivityEvent deployment cannot be reconstructed from the old schemas; historical assignment submissions are also counted as activity days for backward compatibility.

To add another meaningful learning action, call `recordStudentActivity()` from its successful controller workflow, passing the student, classroom, event type, source ID, and event timestamp.

## Assignment weights

The `Assignment.weight` field is currently interpreted as a percentage weight from 0 through 100 and defaults to 100 for legacy assignments. The backend applies the guide's formula exactly: `sum(score * weight / 100)`.

**Training-data contract to confirm:** the model-training owner must confirm that its assessment-weight feature uses the same 0–100 scale and that the ClassSphere assignment weights represent the same concept. If the notebook uses another scale or meaning, update both the Assignment field contract and training pipeline consistently before production predictions.

## API

Teacher-only endpoint:

`GET /api/analytics/teacher/classrooms/:id/risk-predictions`

Header: `Authorization: Bearer <accessToken>`

There is no longer a risk-profile PUT endpoint. Demographic, click-count, credits, and course-category features are not sent to the current model.

## Model response

The service returns one result per input student:

```json
{
  "at_risk": true,
  "risk_probability": 0.6248,
  "risk_level": "Medium"
}
```

The documented thresholds are:

- `at_risk`: true when probability is at least 0.35.
- `Low`: below 0.35.
- `Medium`: 0.35 to below 0.65.
- `High`: 0.65 or above.

The backend validates the output count, numeric probability, boolean flag, risk label, and consistency with those thresholds.

## Security contract — required on both services

The Node backend requires `MODEL_API_KEY` and sends it as `X-Model-API-Key`. The FastAPI service must independently validate the same secret on both `/predict` and `/predict-batch`. Sending a header from Node alone does not secure a public FastAPI endpoint.

See `ML-Service-Security-Contract.md` for the exact FastAPI dependency and deployment requirements. Keep the secret in both deployment environments only; never commit it.

## Caveats

The model is a decision-support estimate, not a diagnosis or guarantee. Do not use it as the sole basis for decisions affecting a student. The model's reported test metrics are not a guarantee of ClassSphere production performance.
