const ActivityEvent = require("../models/ActivityEvent");

/**
 * Record a meaningful student action for the ML active_days feature.
 * Tracking is best-effort: a logging failure must not discard a successful
 * classroom action, but it is reported for operational monitoring.
 */
const recordStudentActivity = async ({
  user,
  classroomId,
  eventType,
  sourceId = null,
  occurredAt = new Date(),
}) => {
  if (!user || user.role !== "student" || !user._id || !classroomId) {
    return null;
  }

  try {
    return await ActivityEvent.create({
      student: user._id,
      classroom: classroomId,
      eventType,
      sourceId,
      occurredAt,
    });
  } catch (error) {
    console.error("Student activity tracking failed:", {
      eventType,
      studentId: String(user._id),
      classroomId: String(classroomId),
      message: error.message,
    });
    return null;
  }
};

module.exports = { recordStudentActivity };
