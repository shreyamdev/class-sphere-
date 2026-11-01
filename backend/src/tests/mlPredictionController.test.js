const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateStudentMetrics } = require("../controllers/mlPredictionController");

const DAY = 24 * 60 * 60 * 1000;
const start = new Date("2026-01-01T00:00:00.000Z");
const atDay = (day) => new Date(start.getTime() + day * DAY);

const assignments = [
  {
    _id: "assignment-1",
    maxMarks: 100,
    weight: 20,
    dueDate: atDay(10),
  },
  {
    _id: "assignment-2",
    maxMarks: 50,
    weight: 30,
    dueDate: atDay(50),
  },
  {
    _id: "assignment-3",
    maxMarks: 100,
    weight: 50,
    dueDate: atDay(65),
  },
];

test("calculates the six ML features and includes course day 90 only", () => {
  const submissions = [
    {
      assignment: "assignment-1",
      submittedAt: atDay(11),
      status: "graded",
      marksObtained: 80,
    },
    {
      assignment: "assignment-2",
      submittedAt: atDay(50),
      status: "graded",
      marksObtained: 25,
    },
    {
      assignment: "assignment-3",
      submittedAt: atDay(70),
      status: "submitted",
      marksObtained: null,
    },
    {
      assignment: "assignment-3",
      submittedAt: atDay(91),
      status: "graded",
      marksObtained: 100,
    },
  ];

  const events = [
    { occurredAt: atDay(0) },
    { occurredAt: new Date(atDay(0).getTime() + 60 * 1000) },
    { occurredAt: atDay(1) },
    { occurredAt: atDay(90) },
    { occurredAt: atDay(91) },
    { occurredAt: new Date(start.getTime() - 1000) },
  ];

  const result = calculateStudentMetrics(
    assignments,
    submissions,
    events,
    start
  );

  assert.deepEqual(result, {
    num_assessments_done: 2,
    avg_score: 65,
    min_score: 50,
    weighted_score: 31,
    late_submissions: 1,
    active_days: 6,
  });
});

test("returns zero for all assessment metrics when there are no scored assessments", () => {
  const result = calculateStudentMetrics(
    assignments,
    [
      {
        assignment: "assignment-1",
        submittedAt: atDay(12),
        status: "submitted",
        marksObtained: null,
      },
    ],
    [{ occurredAt: atDay(12) }, { occurredAt: atDay(13) }],
    start
  );

  assert.deepEqual(result, {
    num_assessments_done: 0,
    avg_score: 0,
    min_score: 0,
    weighted_score: 0,
    late_submissions: 0,
    active_days: 2,
  });
});

test("ignores scored submissions outside the first 90 course days", () => {
  const result = calculateStudentMetrics(
    assignments,
    [
      {
        assignment: "assignment-1",
        submittedAt: atDay(91),
        status: "graded",
        marksObtained: 100,
      },
    ],
    [],
    start
  );

  assert.equal(result.num_assessments_done, 0);
  assert.equal(result.avg_score, 0);
  assert.equal(result.active_days, 0);
});

test("uses course-relative days rather than calendar dates for active_days", () => {
  const offsetStart = new Date("2026-01-01T15:30:00.000Z");
  const result = calculateStudentMetrics(
    [],
    [],
    [
      { occurredAt: new Date(offsetStart.getTime() + 10 * 60 * 1000) },
      { occurredAt: new Date(offsetStart.getTime() + DAY - 1) },
      { occurredAt: new Date(offsetStart.getTime() + DAY + 1) },
    ],
    offsetStart
  );

  assert.equal(result.active_days, 2);
});
