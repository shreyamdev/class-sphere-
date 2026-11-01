
const mongoose = require("mongoose");
const Quiz = require("../models/Quiz");
const QuizAttempt = require("../models/QuizAttempt");
const Classroom = require("../models/Classroom");
const { recordStudentActivity } = require("../services/activityTrackingService");

const getCorrectAnswer = (question) =>
  question.correctAnswer ??
  question.correct_answer ??
  question.answer ??
  question.correctOption ??
  question.correct_option;

const isValidId = (id) => mongoose.isValidObjectId(id);

const isTeacherOfClassroom = async (classroomId, teacherId) =>
  Classroom.findOne({
    _id: classroomId,
    teacher: teacherId,
  }).select("_id");

const isStudentOfClassroom = async (classroomId, studentId) =>
  Classroom.findOne({
    _id: classroomId,
    students: studentId,
  }).select("_id");

// Remove answer keys before sending questions to students.
const hideCorrectAnswers = (question) => {
  const safeQuestion = { ...question };

  delete safeQuestion.correctAnswer;
  delete safeQuestion.correct_answer;
  delete safeQuestion.answer;
  delete safeQuestion.correctOption;
  delete safeQuestion.correct_option;

  return safeQuestion;
};

const normalizeAnswer = (value) =>
  String(value ?? "").trim().toLocaleLowerCase();

// Build a review for a submitted attempt. This helper is only used after the
// attempt is saved and only in student-owned attempt responses or teacher results.
const buildAttemptReview = (quiz, attempt) => {
  const answerMap = new Map(
    (attempt.answers || []).map((answer) => [
      answer.questionIndex,
      answer.selectedAnswer,
    ])
  );

  return quiz.questions.map((question, questionIndex) => {
    const correctAnswer = getCorrectAnswer(question);
    const selectedAnswer = answerMap.has(questionIndex)
      ? answerMap.get(questionIndex)
      : null;
    const isCorrect =
      selectedAnswer !== null &&
      normalizeAnswer(selectedAnswer) === normalizeAnswer(correctAnswer);

    return {
      questionIndex,
      question: hideCorrectAnswers(question),
      selectedAnswer,
      correctAnswer: String(correctAnswer ?? ""),
      isCorrect,
      status: selectedAnswer === null ? "unanswered" : isCorrect ? "correct" : "incorrect",
    };
  });
};

// TEACHER: Save a quiz as draft or published.
const saveQuiz = async (req, res) => {
  try {
    const {
      title,
      classroomId,
      topic = "",
      questions,
      difficulty = "mixed",
      source = "topic",
      status = "draft",
      totalMarks,
    } = req.body;

    if (typeof title !== "string" || title.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: "Title must contain at least 3 characters.",
      });
    }

    if (!isValidId(classroomId)) {
      return res.status(400).json({
        success: false,
        message: "A valid classroomId is required.",
      });
    }

    if (
      !Array.isArray(questions) ||
      questions.length < 1 ||
      questions.length > 20
    ) {
      return res.status(400).json({
        success: false,
        message: "Questions must contain between 1 and 20 items.",
      });
    }

    if (!["easy", "medium", "hard", "mixed"].includes(difficulty)) {
      return res.status(400).json({
        success: false,
        message: "Invalid difficulty.",
      });
    }

    if (!["topic", "study_material", "pdf", "mixed"].includes(source)) {
      return res.status(400).json({
        success: false,
        message: "Invalid source.",
      });
    }

    if (!["draft", "published"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be draft or published.",
      });
    }

    const classroom = await isTeacherOfClassroom(
      classroomId,
      req.user._id
    );

    if (!classroom) {
      return res.status(403).json({
        success: false,
        message: "You can manage quizzes only in your own classroom.",
      });
    }

    const marks =
      totalMarks === undefined ? questions.length : Number(totalMarks);

    if (!Number.isFinite(marks) || marks <= 0) {
      return res.status(400).json({
        success: false,
        message: "totalMarks must be greater than 0.",
      });
    }

    // A quiz can only be published if every question has an answer key.
    if (
      status === "published" &&
      questions.some(
        (question) =>
          !question ||
          typeof question !== "object" ||
          getCorrectAnswer(question) === undefined ||
          getCorrectAnswer(question) === null
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Every question must have a correct answer before publishing.",
      });
    }

    const quiz = await Quiz.create({
      title: title.trim(),
      topic: typeof topic === "string" ? topic.trim() : "",
      classroom: classroom._id,
      teacher: req.user._id,
      questions,
      difficulty,
      source,
      status,
      totalMarks: marks,
    });

    return res.status(201).json({
      success: true,
      message: `Quiz saved as ${status}.`,
      data: quiz,
    });
  } catch (error) {
    console.error("Save quiz error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to save quiz.",
    });
  }
};

// TEACHER: List all quizzes in their classroom.
const getTeacherQuizzes = async (req, res) => {
  try {
    const { classroomId } = req.params;

    if (!isValidId(classroomId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid classroom ID.",
      });
    }

    const classroom = await isTeacherOfClassroom(
      classroomId,
      req.user._id
    );

    if (!classroom) {
      return res.status(403).json({
        success: false,
        message: "You can view quizzes only in your own classroom.",
      });
    }

    const quizzes = await Quiz.find({
      classroom: classroom._id,
      teacher: req.user._id,
    })
      .select("-questions")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: quizzes.length,
      data: quizzes,
    });
  } catch (error) {
    console.error("Get teacher quizzes error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch quizzes.",
    });
  }
};

// TEACHER: Publish a saved draft.
const publishQuiz = async (req, res) => {
  try {
    const { quizId } = req.params;

    if (!isValidId(quizId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid quiz ID.",
      });
    }

    const quiz = await Quiz.findOne({
      _id: quizId,
      teacher: req.user._id,
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found.",
      });
    }

    const classroom = await isTeacherOfClassroom(
      quiz.classroom,
      req.user._id
    );

    if (!classroom) {
      return res.status(403).json({
        success: false,
        message: "You cannot publish quizzes in this classroom.",
      });
    }

    if (
      !quiz.questions.length ||
      quiz.questions.some((question) => {
        const answer = getCorrectAnswer(question);
        return answer === undefined || answer === null;
      })
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Every question must have a correct answer before publishing.",
      });
    }

    quiz.status = "published";
    await quiz.save();

    return res.status(200).json({
      success: true,
      message: "Quiz published successfully.",
      data: {
        _id: quiz._id,
        title: quiz.title,
        status: quiz.status,
        classroom: quiz.classroom,
      },
    });
  } catch (error) {
    console.error("Publish quiz error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to publish quiz.",
    });
  }
};

// TEACHER: Unpublish a quiz.
// A quiz with existing attempts cannot be unpublished.
const unpublishQuiz = async (req, res) => {
  try {
    const { quizId } = req.params;

    if (!isValidId(quizId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid quiz ID.",
      });
    }

    const quiz = await Quiz.findOne({
      _id: quizId,
      teacher: req.user._id,
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found.",
      });
    }

    const hasAttempts = await QuizAttempt.exists({ quiz: quiz._id });

    if (hasAttempts) {
      return res.status(409).json({
        success: false,
        message:
          "This quiz already has student attempts and cannot be unpublished.",
      });
    }

    quiz.status = "draft";
    await quiz.save();

    return res.status(200).json({
      success: true,
      message: "Quiz moved back to draft.",
      data: {
        _id: quiz._id,
        status: quiz.status,
      },
    });
  } catch (error) {
    console.error("Unpublish quiz error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to unpublish quiz.",
    });
  }
};

// STUDENT: List published quizzes for a classroom.
const getStudentQuizzes = async (req, res) => {
  try {
    const { classroomId } = req.params;

    if (!isValidId(classroomId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid classroom ID.",
      });
    }

    const classroom = await isStudentOfClassroom(
      classroomId,
      req.user._id
    );

    if (!classroom) {
      return res.status(403).json({
        success: false,
        message: "You are not enrolled in this classroom.",
      });
    }

    const quizzes = await Quiz.find({
      classroom: classroom._id,
      status: "published",
    }).sort({ createdAt: -1 });

    const attempts = await QuizAttempt.find({
      student: req.user._id,
      quiz: { $in: quizzes.map((quiz) => quiz._id) },
    }).select("quiz score totalMarks submittedAt");

    await recordStudentActivity({
      user: req.user,
      classroomId,
      eventType: "quiz_list_view",
    });

    const attemptMap = new Map(
      attempts.map((attempt) => [
        String(attempt.quiz),
        {
          attempted: true,
          score: attempt.score,
          totalMarks: attempt.totalMarks,
          submittedAt: attempt.submittedAt,
        },
      ])
    );

    const safeQuizzes = quizzes.map((quiz) => ({
      _id: quiz._id,
      title: quiz.title,
      topic: quiz.topic,
      classroom: quiz.classroom,
      teacher: quiz.teacher,
      difficulty: quiz.difficulty,
      totalMarks: quiz.totalMarks,
      questions: quiz.questions.map(hideCorrectAnswers),
      createdAt: quiz.createdAt,
      attempted: attemptMap.has(String(quiz._id)),
      attempt: attemptMap.get(String(quiz._id)) || null,
    }));

    return res.status(200).json({
      success: true,
      count: safeQuizzes.length,
      data: safeQuizzes,
    });
  } catch (error) {
    console.error("Get student quizzes error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch quizzes.",
    });
  }
};

// STUDENT: Submit answers and calculate the score on the server.
const submitQuiz = async (req, res) => {
  try {
    const { quizId } = req.params;
    const { answers } = req.body;

    if (!isValidId(quizId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid quiz ID.",
      });
    }

    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Submit at least one answer.",
      });
    }

    const quiz = await Quiz.findOne({
      _id: quizId,
      status: "published",
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Published quiz not found.",
      });
    }

    const classroom = await isStudentOfClassroom(
      quiz.classroom,
      req.user._id
    );

    if (!classroom) {
      return res.status(403).json({
        success: false,
        message: "You are not enrolled in this classroom.",
      });
    }

    const existingAttempt = await QuizAttempt.findOne({
      quiz: quiz._id,
      student: req.user._id,
    });

    if (existingAttempt) {
      return res.status(409).json({
        success: false,
        message: "You have already submitted this quiz.",
      });
    }

    if (answers.length > quiz.questions.length) {
      return res.status(400).json({
        success: false,
        message: "Too many answers were submitted.",
      });
    }

    const seen = new Set();

    for (const answer of answers) {
      if (
        !Number.isInteger(answer.questionIndex) ||
        answer.questionIndex < 0 ||
        answer.questionIndex >= quiz.questions.length ||
        typeof answer.selectedAnswer !== "string" ||
        !answer.selectedAnswer.trim() ||
        seen.has(answer.questionIndex)
      ) {
        return res.status(400).json({
          success: false,
          message: "An answer has an invalid or duplicate question index.",
        });
      }

      seen.add(answer.questionIndex);
    }

    let correctCount = 0;

    for (const answer of answers) {
      const question = quiz.questions[answer.questionIndex];
      const correctAnswer = getCorrectAnswer(question);

      if (correctAnswer === undefined || correctAnswer === null) {
        return res.status(422).json({
          success: false,
          message: "A question is missing its answer key.",
          questionIndex: answer.questionIndex,
        });
      }

      const selected = answer.selectedAnswer.trim().toLowerCase();
      const correct = String(correctAnswer).trim().toLowerCase();

      if (selected === correct) {
        correctCount++;
      }
    }

    const totalQuestions = quiz.questions.length;
    const score = Number(
      ((correctCount / totalQuestions) * quiz.totalMarks).toFixed(2)
    );

    const attempt = await QuizAttempt.create({
      quiz: quiz._id,
      student: req.user._id,
      answers,
      score,
      totalMarks: quiz.totalMarks,
      correctAnswers: correctCount,
      totalQuestions,
    });

    await recordStudentActivity({
      user: req.user,
      classroomId: quiz.classroom,
      eventType: "quiz_attempt",
      sourceId: quiz._id,
      occurredAt: attempt.submittedAt,
    });

    const review = buildAttemptReview(quiz, attempt);

    return res.status(201).json({
      success: true,
      message: "Quiz submitted and graded successfully.",
      data: {
        attemptId: attempt._id,
        quizId: quiz._id,
        score,
        totalMarks: quiz.totalMarks,
        correctAnswers: correctCount,
        totalQuestions,
        submittedAt: attempt.submittedAt,
        review,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "You have already submitted this quiz.",
      });
    }

    console.error("Submit quiz error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to submit quiz.",
    });
  }
};

// STUDENT: See their own quiz history, including a marked-answer review.
const getMyQuizAttempts = async (req, res) => {
  try {
    const attempts = await QuizAttempt.find({
      student: req.user._id,
    })
      .sort({ submittedAt: -1 })
      .lean();

    const quizIds = [...new Set(attempts.map((attempt) => String(attempt.quiz)))];
    const quizzes = quizIds.length
      ? await Quiz.find({ _id: { $in: quizIds } })
          .select("title topic classroom totalMarks questions")
          .lean()
      : [];
    const quizMap = new Map(quizzes.map((quiz) => [String(quiz._id), quiz]));

    const reviewedAttempts = attempts.map((attempt) => {
      const quiz = quizMap.get(String(attempt.quiz));
      if (!quiz) {
        return {
          ...attempt,
          quiz: null,
          review: [],
          reviewAvailable: false,
        };
      }

      return {
        ...attempt,
        quiz: {
          _id: quiz._id,
          title: quiz.title,
          topic: quiz.topic,
          classroom: quiz.classroom,
          totalMarks: quiz.totalMarks,
        },
        review: buildAttemptReview(quiz, attempt),
        reviewAvailable: true,
      };
    });

    return res.status(200).json({
      success: true,
      count: reviewedAttempts.length,
      data: reviewedAttempts,
    });
  } catch (error) {
    console.error("Get quiz history error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch quiz history.",
    });
  }
};

// STUDENT: View the marked answers and correct answers for one own attempt.
const getQuizAttemptReview = async (req, res) => {
  try {
    const { attemptId } = req.params;

    if (!isValidId(attemptId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid quiz attempt ID.",
      });
    }

    const attempt = await QuizAttempt.findOne({
      _id: attemptId,
      student: req.user._id,
    }).lean();

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: "Quiz attempt not found.",
      });
    }

    const quiz = await Quiz.findById(attempt.quiz)
      .select("title topic classroom totalMarks questions")
      .lean();

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "The quiz associated with this attempt no longer exists.",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        attemptId: attempt._id,
        quiz: {
          _id: quiz._id,
          title: quiz.title,
          topic: quiz.topic,
          totalMarks: quiz.totalMarks,
        },
        score: attempt.score,
        totalMarks: attempt.totalMarks,
        correctAnswers: attempt.correctAnswers,
        totalQuestions: attempt.totalQuestions,
        submittedAt: attempt.submittedAt,
        review: buildAttemptReview(quiz, attempt),
      },
    });
  } catch (error) {
    console.error("Get quiz attempt review error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch quiz attempt review.",
    });
  }
};

// TEACHER: View results for a classroom quiz.
const getQuizResults = async (req, res) => {
  try {
    const { quizId } = req.params;

    if (!isValidId(quizId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid quiz ID.",
      });
    }

    const quiz = await Quiz.findOne({
      _id: quizId,
      teacher: req.user._id,
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found.",
      });
    }

    const classroom = await isTeacherOfClassroom(
      quiz.classroom,
      req.user._id
    );

    if (!classroom) {
      return res.status(403).json({
        success: false,
        message: "You cannot view results for this classroom.",
      });
    }

    const attempts = await QuizAttempt.find({ quiz: quiz._id })
      .populate("student", "name email")
      .sort({ submittedAt: -1 });

    return res.status(200).json({
      success: true,
      quiz: {
        _id: quiz._id,
        title: quiz.title,
        totalMarks: quiz.totalMarks,
        status: quiz.status,
      },
      count: attempts.length,
      data: attempts,
    });
  } catch (error) {
    console.error("Get quiz results error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch quiz results.",
    });
  }
};

module.exports = {
  saveQuiz,
  getTeacherQuizzes,
  publishQuiz,
  unpublishQuiz,
  getStudentQuizzes,
  submitQuiz,
  getMyQuizAttempts,
  getQuizAttemptReview,
  getQuizResults,
  buildAttemptReview,
};
