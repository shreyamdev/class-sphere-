
const express = require("express");

const {
  protect,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const {
  saveQuiz,
  getTeacherQuizzes,
  publishQuiz,
  unpublishQuiz,
  getStudentQuizzes,
  submitQuiz,
  getMyQuizAttempts,
  getQuizAttemptReview,
  getQuizResults,
} = require("../controllers/quizController");

const router = express.Router();

// Teacher: save a quiz.
router.post("/",protect,authorizeRoles("teacher"),saveQuiz);

// Teacher list quizzes in a classroom.
router.get("/classrooms/:classroomId",protect,authorizeRoles("teacher"),getTeacherQuizzes);

// Teacher publish or unpublish a quiz.
router.patch("/:quizId/publish",protect,authorizeRoles("teacher"),publishQuiz);

router.patch("/:quizId/unpublish",protect,authorizeRoles("teacher"),unpublishQuiz);

// Teacher view submitted results.
router.get("/:quizId/results",protect,authorizeRoles("teacher"),getQuizResults);

// Student list published quizzes in an enrolled classroom.
router.get("/student/classrooms/:classroomId",protect,authorizeRoles("student"),getStudentQuizzes);

// Student: submit quiz answers.
router.post("/:quizId/submit",protect,authorizeRoles("student"),submitQuiz);

// Student: view their own attempt history.
router.get("/student/attempts",protect,authorizeRoles("student"),getMyQuizAttempts);

// Student: view their own marked answers and correct answers after submission.
router.get(
  "/student/attempts/:attemptId/review",
  protect,
  authorizeRoles("student"),
  getQuizAttemptReview
);

module.exports = router;
