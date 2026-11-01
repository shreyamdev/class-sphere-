
const mongoose = require("mongoose");
const Doubt = require("../models/Doubt");
const Classroom = require("../models/Classroom");
const { recordStudentActivity } = require("../services/activityTrackingService");

const isValidId = (id) => mongoose.isValidObjectId(id);

async function getClassroomAccess(classroomId, user) {
  const classroom = await Classroom.findById(classroomId).select(
    "teacher students"
  );

  if (!classroom) {
    return { error: "Classroom not found", status: 404 };
  }

  const userId = String(user._id);
  const isTeacher = String(classroom.teacher) === userId;
  const isStudent = (classroom.students || []).some(
    (id) => String(id) === userId
  );

  if (!isTeacher && !isStudent) {
    return { error: "You are not a member of this classroom", status: 403 };
  }

  return { classroom, isTeacher, isStudent };
}

// POST /classrooms/:classroomId/doubts
exports.createDoubt = async (req, res) => {
  try {
    const { classroomId } = req.params;
    const { title, description } = req.body;

    if (!isValidId(classroomId)) {
      return res.status(400).json({ success: false, message: "Invalid classroom ID" });
    }

    if (
      typeof title !== "string" ||
      !title.trim() ||
      title.trim().length > 150 ||
      typeof description !== "string" ||
      !description.trim() ||
      description.trim().length > 5000
    ) {
      return res.status(400).json({
        success: false,
        message: "Title (max 150 chars) and description (max 5000 chars) are required",
      });
    }

    const access = await getClassroomAccess(classroomId, req.user);

    if (access.error) {
      return res.status(access.status).json({
        success: false,
        message: access.error,
      });
    }

    if (!access.isStudent) {
      return res.status(403).json({
        success: false,
        message: "Only students can create doubts",
      });
    }

    const doubt = await Doubt.create({
      classroom: classroomId,
      student: req.user._id,
      title: title.trim(),
      description: description.trim(),
    });

    await recordStudentActivity({
      user: req.user,
      classroomId,
      eventType: "doubt_created",
      sourceId: doubt._id,
      occurredAt: doubt.createdAt,
    });

    return res.status(201).json({ success: true, data: doubt });
  } catch (error) {
    console.error("createDoubt:", error);
    return res.status(500).json({ success: false, message: "Failed to create doubt" });
  }
};

// GET /classrooms/:classroomId/doubts
exports.getClassroomDoubts = async (req, res) => {
  try {
    const { classroomId } = req.params;

    if (!isValidId(classroomId)) {
      return res.status(400).json({ success: false, message: "Invalid classroom ID" });
    }

    const access = await getClassroomAccess(classroomId, req.user);

    if (access.error) {
      return res.status(access.status).json({
        success: false,
        message: access.error,
      });
    }

    await recordStudentActivity({
      user: req.user,
      classroomId,
      eventType: "doubt_list_view",
    });

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));

    const filter = { classroom: classroomId };

    if (["open", "resolved"].includes(req.query.status)) {
      filter.status = req.query.status;
    }

    const [doubts, total] = await Promise.all([
      Doubt.find(filter)
        .populate("student", "name email")
        .populate("replies.author", "name role")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Doubt.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: doubts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("getClassroomDoubts:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch doubts" });
  }
};

// POST /doubts/:doubtId/replies
exports.addReply = async (req, res) => {
  try {
    const { doubtId } = req.params;
    const { message } = req.body;

    if (!isValidId(doubtId)) {
      return res.status(400).json({ success: false, message: "Invalid doubt ID" });
    }

    if (typeof message !== "string" || !message.trim() || message.trim().length > 3000) {
      return res.status(400).json({
        success: false,
        message: "Reply message is required (max 3000 characters)",
      });
    }

    const doubt = await Doubt.findById(doubtId);

    if (!doubt) {
      return res.status(404).json({ success: false, message: "Doubt not found" });
    }

    const access = await getClassroomAccess(doubt.classroom, req.user);

    if (access.error) {
      return res.status(access.status).json({
        success: false,
        message: access.error,
      });
    }

    if (doubt.status === "resolved") {
      return res.status(400).json({
        success: false,
        message: "This doubt is already resolved",
      });
    }

    doubt.replies.push({
      author: req.user._id,
      message: message.trim(),
    });

    await doubt.save();

    await recordStudentActivity({
      user: req.user,
      classroomId: doubt.classroom,
      eventType: "doubt_reply",
      sourceId: doubt._id,
      occurredAt: doubt.replies[doubt.replies.length - 1].createdAt || new Date(),
    });

    return res.status(201).json({
      success: true,
      data: doubt,
    });
  } catch (error) {
    console.error("addReply:", error);
    return res.status(500).json({ success: false, message: "Failed to add reply" });
  }
};

// PATCH /doubts/:doubtId/status
exports.updateDoubtStatus = async (req, res) => {
  try {
    const { doubtId } = req.params;
    const { status } = req.body;

    if (!isValidId(doubtId)) {
      return res.status(400).json({ success: false, message: "Invalid doubt ID" });
    }

    if (!["open", "resolved"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be open or resolved",
      });
    }

    const doubt = await Doubt.findById(doubtId);

    if (!doubt) {
      return res.status(404).json({ success: false, message: "Doubt not found" });
    }

    const access = await getClassroomAccess(doubt.classroom, req.user);

    if (access.error) {
      return res.status(access.status).json({
        success: false,
        message: access.error,
      });
    }

    // Teachers can resolve/reopen any classroom doubt.
    // Students can change status only on their own doubt.
    if (!access.isTeacher && String(doubt.student) !== String(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "You can only update your own doubt",
      });
    }

    doubt.status = status;
    await doubt.save();

    return res.json({ success: true, data: doubt });
  } catch (error) {
    console.error("updateDoubtStatus:", error);
    return res.status(500).json({ success: false, message: "Failed to update doubt" });
  }
};
