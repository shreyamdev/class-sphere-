const mongoose = require("mongoose");
const Classroom = require("../models/Classroom");
const Assignment = require("../models/Assignment");
const Submission = require("../models/Submission");
const ActivityEvent = require("../models/ActivityEvent");
const {
  predictBatch,
  ModelServiceError,
} = require("../services/mlPredictionService");

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MODEL_WINDOW_DAYS = 90;

/**
 * Calculate the six features expected by the FastAPI/XGBoost service.
 * Day 0 is courseStartDate. The observation window includes all of day 90,
 * therefore its exclusive end is courseStartDate + 91 days.
 */
const calculateStudentMetrics = (
  assignments,
  studentSubmissions,
  activityEvents,
  courseStartDate
) => {
  const courseStart = new Date(courseStartDate);
  if (Number.isNaN(courseStart.getTime())) {
    throw new TypeError("A valid courseStartDate is required.");
  }

  const windowStart = courseStart.getTime();
  const windowEndExclusive = windowStart + (MODEL_WINDOW_DAYS + 1) * DAY_IN_MS;

  const assignmentMap = new Map(
    assignments.map((assignment) => [String(assignment._id), assignment])
  );

  const activeDayBuckets = new Set();
  const scoredPercentages = [];
  let lateSubmissions = 0;
  let weightedScore = 0;

  // Count distinct course-relative activity days, not just submission days.
  for (const event of activityEvents || []) {
    const occurredAt = new Date(event.occurredAt).getTime();
    if (
      !Number.isFinite(occurredAt) ||
      occurredAt < windowStart ||
      occurredAt >= windowEndExclusive
    ) {
      continue;
    }

    const courseDay = Math.floor((occurredAt - windowStart) / DAY_IN_MS);
    activeDayBuckets.add(courseDay);
  }

  for (const submission of studentSubmissions || []) {
    const submittedAt = new Date(submission.submittedAt).getTime();
    if (
      !Number.isFinite(submittedAt) ||
      submittedAt < windowStart ||
      submittedAt >= windowEndExclusive
    ) {
      continue;
    }

    // Legacy and newly recorded assignment submissions are also activity.
    // This keeps assignment engagement visible even for pre-event-log records.
    const courseDay = Math.floor((submittedAt - windowStart) / DAY_IN_MS);
    activeDayBuckets.add(courseDay);

    const assignment = assignmentMap.get(String(submission.assignment));
    if (!assignment) continue;

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

    const score = (marks / maxMarks) * 100;
    scoredPercentages.push(score);
    weightedScore += (score * weight) / 100;

    if (
      assignment.dueDate &&
      submittedAt > new Date(assignment.dueDate).getTime()
    ) {
      lateSubmissions += 1;
    }
  }

  const numAssessmentsDone = scoredPercentages.length;

  if (numAssessmentsDone === 0) {
    return {
      num_assessments_done: 0,
      avg_score: 0,
      min_score: 0,
      weighted_score: 0,
      late_submissions: 0,
      active_days: activeDayBuckets.size,
    };
  }

  const avgScore =
    scoredPercentages.reduce((sum, score) => sum + score, 0) /
    numAssessmentsDone;

  return {
    num_assessments_done: numAssessmentsDone,
    // Keep full calculated precision; the model guide does not specify
    // rounding these input features before inference.
    avg_score: avgScore,
    min_score: Math.min(...scoredPercentages),
    weighted_score: weightedScore,
    late_submissions: lateSubmissions,
    active_days: activeDayBuckets.size,
  };
};

const getClassroomRiskPredictions = async (req, res) => {
  try {
    const { id: classroomId } = req.params;

    if (!mongoose.isValidObjectId(classroomId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid classroom ID.",
      });
    }

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

    // Backward-compatible fallback for classrooms created before migration.
    const courseStartDate = new Date(
      classroom.courseStartDate || classroom.createdAt
    );
    if (Number.isNaN(courseStartDate.getTime())) {
      return res.status(422).json({
        success: false,
        code: "COURSE_START_DATE_INVALID",
        message: "The classroom has no valid course start date.",
      });
    }

    const predictionEligibleFrom = new Date(
      courseStartDate.getTime() + MODEL_WINDOW_DAYS * DAY_IN_MS
    );

    if (Date.now() < predictionEligibleFrom.getTime()) {
      return res.status(409).json({
        success: false,
        code: "MODEL_WINDOW_NOT_REACHED",
        message: "Risk predictions are available only from day 90 of the course.",
        data: { courseStartDate, predictionEligibleFrom },
      });
    }

    if (classroom.students.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          classroom: { id: classroom._id, name: classroom.name },
          totalStudents: 0,
          predictedStudents: 0,
          atRiskStudents: 0,
          highRiskStudents: 0,
          students: [],
        },
      });
    }

    const assignments = await Assignment.find({ classroom: classroomId })
      .select("_id maxMarks weight dueDate")
      .lean();

    const studentIds = classroom.students.map((student) => student._id);
    const assignmentIds = assignments.map((assignment) => assignment._id);
    const windowEndExclusive = new Date(
      courseStartDate.getTime() + (MODEL_WINDOW_DAYS + 1) * DAY_IN_MS
    );

    const [submissions, activityEvents] = await Promise.all([
      assignmentIds.length
        ? Submission.find({
            assignment: { $in: assignmentIds },
            student: { $in: studentIds },
            submittedAt: { $gte: courseStartDate, $lt: windowEndExclusive },
          })
            .select("student assignment status marksObtained submittedAt")
            .lean()
        : [],
      ActivityEvent.find({
        classroom: classroomId,
        student: { $in: studentIds },
        occurredAt: { $gte: courseStartDate, $lt: windowEndExclusive },
      })
        .select("student eventType occurredAt")
        .lean(),
    ]);

    const submissionsByStudent = new Map(
      studentIds.map((studentId) => [String(studentId), []])
    );
    const activityByStudent = new Map(
      studentIds.map((studentId) => [String(studentId), []])
    );

    for (const submission of submissions) {
      submissionsByStudent.get(String(submission.student))?.push(submission);
    }
    for (const event of activityEvents) {
      activityByStudent.get(String(event.student))?.push(event);
    }

    const studentsWithMetrics = classroom.students.map((student) => {
      const key = String(student._id);
      const metrics = calculateStudentMetrics(
        assignments,
        submissionsByStudent.get(key) || [],
        activityByStudent.get(key) || [],
        courseStartDate
      );
      return { student, metrics };
    });

    let predictions;
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

    const students = studentsWithMetrics.map((item, index) => ({
      student: {
        id: item.student._id,
        name: item.student.name,
        email: item.student.email,
      },
      inputFeatures: item.metrics,
      prediction: predictions[index],
    }));

    return res.status(200).json({
      success: true,
      data: {
        classroom: { id: classroom._id, name: classroom.name },
        model: {
          name: "XGBoost",
          target: "Fail or Withdrawn",
          observationWindowDays: 90,
          day90Included: true,
          threshold: 0.35,
        },
        courseStartDate,
        predictionEligibleFrom,
        totalStudents: students.length,
        predictedStudents: predictions.length,
        atRiskStudents: students.filter((item) => item.prediction.at_risk).length,
        highRiskStudents: students.filter(
          (item) => item.prediction.risk_level === "High"
        ).length,
        students,
        disclaimer:
          "Risk scores are model estimates for teacher support, not diagnoses or guarantees. Do not use them as the sole basis for decisions affecting a student.",
        activityDataNote:
          "active_days counts distinct course-relative days with recorded student activity (assignment list/submission, quiz list/attempt, study-material list/download, or doubt creation/reply). Only events from day 0 through day 90 are included.",
      },
    });
  } catch (error) {
    console.error("Classroom risk prediction error:", error);
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
