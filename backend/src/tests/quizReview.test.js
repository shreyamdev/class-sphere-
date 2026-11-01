const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAttemptReview } = require("../controllers/quizController");

test("buildAttemptReview shows selected answers, correct answers, and correctness", () => {
  const quiz = {
    questions: [
      {
        question: "2 + 2?",
        options: ["3", "4", "5"],
        correctAnswer: "4",
      },
      {
        question: "Capital of France?",
        options: ["Rome", "Paris", "Berlin"],
        correct_answer: "Paris",
      },
      {
        question: "Largest planet?",
        options: ["Earth", "Mars", "Jupiter"],
        answer: "Jupiter",
      },
    ],
  };
  const attempt = {
    answers: [
      { questionIndex: 0, selectedAnswer: "3" },
      { questionIndex: 1, selectedAnswer: "Paris" },
    ],
  };

  const review = buildAttemptReview(quiz, attempt);

  assert.equal(review.length, 3);
  assert.deepEqual(
    review.map((item) => ({
      selectedAnswer: item.selectedAnswer,
      correctAnswer: item.correctAnswer,
      isCorrect: item.isCorrect,
      status: item.status,
    })),
    [
      {
        selectedAnswer: "3",
        correctAnswer: "4",
        isCorrect: false,
        status: "incorrect",
      },
      {
        selectedAnswer: "Paris",
        correctAnswer: "Paris",
        isCorrect: true,
        status: "correct",
      },
      {
        selectedAnswer: null,
        correctAnswer: "Jupiter",
        isCorrect: false,
        status: "unanswered",
      },
    ]
  );

  assert.equal(review[0].question.correctAnswer, undefined);
  assert.equal(review[1].question.correct_answer, undefined);
});

const Quiz = require("../models/Quiz");
const QuizAttempt = require("../models/QuizAttempt");
const { getQuizAttemptReview } = require("../controllers/quizController");

const originalAttemptFindOne = QuizAttempt.findOne;
const originalQuizFindById = Quiz.findById;

test.after(() => {
  QuizAttempt.findOne = originalAttemptFindOne;
  Quiz.findById = originalQuizFindById;
});

const invokeReview = async (studentId, attemptId = "507f1f77bcf86cd799439011") => {
  const result = { statusCode: 200, body: null };
  const res = {
    status(code) { result.statusCode = code; return this; },
    json(body) { result.body = body; return this; },
  };
  await getQuizAttemptReview({
    params: { attemptId },
    user: { _id: studentId, role: "student" },
  }, res);
  return result;
};

test("getQuizAttemptReview returns question-level feedback to the attempt owner", async () => {
  const attempt = {
    _id: "507f1f77bcf86cd799439011",
    quiz: "507f1f77bcf86cd799439012",
    student: "student-1",
    answers: [{ questionIndex: 0, selectedAnswer: "A" }],
    score: 0,
    totalMarks: 1,
    correctAnswers: 0,
    totalQuestions: 1,
    submittedAt: new Date("2026-10-30T10:00:00.000Z"),
  };
  const quiz = {
    _id: attempt.quiz,
    title: "Sample quiz",
    topic: "Basics",
    totalMarks: 1,
    questions: [{ question: "Pick B", options: ["A", "B"], correctAnswer: "B" }],
  };

  let attemptFilter;
  QuizAttempt.findOne = (filter) => {
    attemptFilter = filter;
    return { lean: async () => attempt };
  };
  Quiz.findById = () => ({
    select() { return this; },
    lean: async () => quiz,
  });

  const response = await invokeReview("student-1");

  assert.deepEqual(attemptFilter, {
    _id: "507f1f77bcf86cd799439011",
    student: "student-1",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.review[0].selectedAnswer, "A");
  assert.equal(response.body.data.review[0].correctAnswer, "B");
  assert.equal(response.body.data.review[0].isCorrect, false);
});

test("getQuizAttemptReview does not return another student's attempt", async () => {
  let quizLookupCalled = false;
  QuizAttempt.findOne = (filter) => {
    assert.equal(filter.student, "student-2");
    return { lean: async () => null };
  };
  Quiz.findById = () => {
    quizLookupCalled = true;
    throw new Error("Quiz should not be queried for another student's attempt");
  };

  const response = await invokeReview("student-2");
  assert.equal(response.statusCode, 404);
  assert.equal(quizLookupCalled, false);
});
