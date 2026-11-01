
const Classroom = require("../models/Classroom");
const Assignment = require("../models/Assignment");
const Submission = require("../models/Submission");

const {
  predictBatch,
  ModelServiceError,
} = require("../services/mlPredictionService");

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MODEL_WINDOW_DAYS = 90;

// Calculate the six features required by the new XGBoost model.
const calculateStudentMetrics = (
  assignments,
  studentSubmissions,
  courseStartDate
) => {
  const courseStart = new Date(courseStartDate);
  const day90End = new Date(
    courseStart.getTime() + MODEL_WINDOW_DAYS * DAY_IN_MS
  );

  const assignmentMap = new Map(
    assignments.map((assignment) => [
      assignment._id.toString(),
      assignment,
    ])
  );

  const activeDays = new Set();
  const scoredPercentages = [];

  let lateSubmissions = 0;
  let weightedScore = 0;

  for (const submission of studentSubmissions) {
    const submittedAt = new Date(submission.submittedAt);

    // Only consider activity within the first 90 days.
    if (
      Number.isNaN(submittedAt.getTime()) ||
      submittedAt < courseStart ||
      submittedAt > day90End
    ) {
      continue;
    }

    // Record the calendar day on which the student was active.
    activeDays.add(
      submittedAt.toISOString().slice(0, 10)
    );

    const assignmentId = submission.assignment.toString();
    const assignment = assignmentMap.get(assignmentId);

    if (!assignment) continue;

    // Only assessments with a score contribute to score metrics.
    if (
      submission.status !== "graded" ||
      submission.marksObtained === null ||
      submission.marksObtained === undefined
    ) {
      continue;
    }

    const marks = Number(submission.marksObtained);
    const maxMarks = Number(assignment.maxMarks);
    const weight = Number(assignment.weight ?? 100);

    if (
      !Number.isFinite(marks) ||
      !Number.isFinite(maxMarks) ||
      maxMarks <= 0 ||
      marks < 0 ||
      marks > maxMarks ||
      !Number.isFinite(weight) ||
      weight < 0
    ) {
      continue;
    }

    // Convert marks into percentage.
    const score = (marks / maxMarks) * 100;

    scoredPercentages.push(score);

    // Required formula:
    // weighted_score = sum(score * assessment weight / 100)
    weightedScore += (score * weight) / 100;

    // Count only scored assessments submitted after their due date.
    if (
      assignment.dueDate &&
      submittedAt > new Date(assignment.dueDate)
    ) {
      lateSubmissions++;
    }
  }

  const numAssessmentsDone = scoredPercentages.length;

  // No scored assessments: all five assessment metrics are zero.
  if (numAssessmentsDone === 0) {
    return {
      num_assessments_done: 0,
      avg_score: 0,
      min_score: 0,
      weighted_score: 0,
      late_submissions: 0,
      active_days: activeDays.size,
    };
  }

  const avgScore =
    scoredPercentages.reduce((sum, score) => sum + score, 0) /
    numAssessmentsDone;

  const minScore = Math.min(...scoredPercentages);

  // Exactly six numeric fields expected by the Python API.
  return {
    num_assessments_done: numAssessmentsDone,
    avg_score: Number(avgScore.toFixed(2)),
    min_score: Number(minScore.toFixed(2)),
    weighted_score: Number(weightedScore.toFixed(2)),
    late_submissions: lateSubmissions,
    active_days: activeDays.size,
  };
};

// GET /api/analytics/teacher/classrooms/:id/risk-predictions
const getClassroomRiskPredictions = async (req, res) => {
  try {
    const { id: classroomId } = req.params;

    // Check classroom ID.
    if (!require("mongoose").isValidObjectId(classroomId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid classroom ID.",
      });
    }

    // Verify that the logged-in teacher owns this classroom.
    const classroom = await Classroom.findOne({
      _id: classroomId,
      teacher: req.user._id,
    }).populate("students", "name email");

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: "Classroom not found or you are not its teacher.",
      });
    }

    const courseStartDate = new Date(classroom.createdAt);

    const predictionEligibleFrom = new Date(
      courseStartDate.getTime() + MODEL_WINDOW_DAYS * DAY_IN_MS
    );

    // The model must not be used before day 90.
    if (new Date() < predictionEligibleFrom) {
      return res.status(409).json({
        success: false,
        code: "MODEL_WINDOW_NOT_REACHED",
        message:
          "Risk predictions are available only from day 90 of the course.",
        data: {
          courseStartDate,
          predictionEligibleFrom,
        },
      });
    }

    if (classroom.students.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          classroom: {
            id: classroom._id,
            name: classroom.name,
          },
          totalStudents: 0,
          predictedStudents: 0,
          students: [],
        },
      });
    }

    // Fetch classroom assessments.
    const assignments = await Assignment.find({
      classroom: classroomId,
    }).select("_id maxMarks weight dueDate");

    const assignmentIds = assignments.map(
      (assignment) => assignment._id
    );

    const studentIds = classroom.students.map(
      (student) => student._id
    );

    // Fetch submissions of all enrolled students.
    const submissions = assignmentIds.length
      ? await Submission.find({
          assignment: { $in: assignmentIds },
          student: { $in: studentIds },
        }).select(
          "student assignment status marksObtained submittedAt"
        )
      : [];

    // Group submissions by student.
    const submissionsByStudent = new Map(
      studentIds.map((id) => [id.toString(), []])
    );

    for (const submission of submissions) {
      const studentSubmissions = submissionsByStudent.get(
        submission.student.toString()
      );

      if (studentSubmissions) {
        studentSubmissions.push(submission);
      }
    }

    // Prepare exactly six model inputs for every student.
    const studentsWithMetrics = classroom.students.map((student) => {
      const metrics = calculateStudentMetrics(
        assignments,
        submissionsByStudent.get(student._id.toString()) || [],
        courseStartDate
      );

      return {
        student,
        metrics,
      };
    });

    let predictions = [];

    try {
      predictions = await predictBatch(
        studentsWithMetrics.map((item) => item.metrics)
      );
    } catch (error) {
      if (error instanceof ModelServiceError) {
        return res.status(error.statusCode).json({
          success: false,
          code: error.code,
          message: error.message,
        });
      }

      throw error;
    }

    // Match each prediction with the correct student.
    const students = studentsWithMetrics.map((item, index) => ({
      student: {
        id: item.student._id,
        name: item.student.name,
        email: item.student.email,
      },

      status: "predicted",

      inputFeatures: item.metrics,

      prediction: predictions[index],
    }));

    const highRiskStudents = students.filter(
      (item) => item.prediction.risk_level === "High"
    ).length;

    const atRiskStudents = students.filter(
      (item) => item.prediction.at_risk
    ).length;

    return res.status(200).json({
      success: true,

      data: {
        classroom: {
          id: classroom._id,
          name: classroom.name,
        },

        model: {
          name: "XGBoost",
          target: "Fail or Withdrawn",
          observationWindowDays: 90,
          threshold: 0.35,
        },

        courseStartDate,
        predictionEligibleFrom,

        totalStudents: students.length,
        predictedStudents: predictions.length,
        atRiskStudents,
        highRiskStudents,

        students,

        disclaimer:
          "Risk scores are model estimates for decision support only, not a diagnosis or guarantee. Do not use them as the sole basis for decisions affecting a student.",

        activityDataNote:
          "active_days is calculated from distinct assignment submission dates. Other platform activities are not included because ClassSphere currently has no general activity log.",
      },
    });
  } catch (error) {
    console.error(
      "Classroom risk prediction error:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};

module.exports = {
  calculateStudentMetrics,
  getClassroomRiskPredictions,
};
