const crypto = require("crypto");
const mongoose = require("mongoose");
const Classroom = require("../models/Classroom");
const Assignment = require("../models/Assignment");
const Submission = require("../models/Submission");
const Announcement = require("../models/Announcement");
const Notification = require("../models/Notification");
const StudyMaterial = require("../models/StudyMaterial");
const Quiz = require("../models/Quiz");
const QuizAttempt = require("../models/QuizAttempt");
const ActivityEvent = require("../models/ActivityEvent");
const Doubt = require("../models/Doubt");
const cloudinary = require("../config/cloudinary");
const { recordStudentActivity } = require("../services/activityTrackingService");

const deleteAuthenticatedRawAssets = async (publicIds) => {
  const uniqueIds = [...new Set(publicIds.filter(Boolean))];
  for (const publicId of uniqueIds) {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: "raw",
      type: "authenticated",
      invalidate: true,
    });
    if (result.result !== "ok" && result.result !== "not found") {
      throw new Error(`Cloudinary could not delete asset ${publicId}`);
    }
  }
};

// Generate a six-character hexadecimal join code.
const generateClassCode = () => {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
};

// Create classroom
const createClassroom = async (req, res) => {
  try {
    const {
      name,
      description = "",
      subject = "",
      semesterSection = "",
      courseStartDate,
    } = req.body;

    if (typeof name !== "string" || name.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: "Classroom name must be at least 3 characters long.",
      });
    }

    if (name.trim().length > 100) {
      return res.status(400).json({
        success: false,
        message: "Classroom name cannot exceed 100 characters.",
      });
    }

    if (
      typeof description !== "string" ||
      description.trim().length > 500
    ) {
      return res.status(400).json({
        success: false,
        message: "Description must be a string of at most 500 characters.",
      });
    }

    if (
      typeof subject !== "string" ||
      subject.trim().length > 100
    ) {
      return res.status(400).json({
        success: false,
        message: "Subject must be a string of at most 100 characters.",
      });
    }

    if (
      typeof semesterSection !== "string" ||
      semesterSection.trim().length > 50
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Semester/Section must be a string of at most 50 characters.",
      });
    }

    const parsedCourseStartDate =
      courseStartDate === undefined || courseStartDate === null || courseStartDate === ""
        ? new Date()
        : new Date(courseStartDate);

    if (Number.isNaN(parsedCourseStartDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "courseStartDate must be a valid date.",
      });
    }

    // Retry if a generated code already exists.
    let classroom = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const classCode = generateClassCode();

      try {
        classroom = await Classroom.create({
          name: name.trim(),
          description: description.trim(),
          subject: subject.trim(),
          semesterSection: semesterSection.trim(),
          courseStartDate: parsedCourseStartDate,
          classCode,
          teacher: req.user._id,
        });

        break;
      } catch (error) {
        const isClassCodeCollision =
          error.code === 11000 &&
          (error.keyPattern?.classCode ||
            String(error.message).includes("classCode"));

        if (isClassCodeCollision) {
          continue;
        }

        throw error;
      }
    }

    if (!classroom) {
      return res.status(503).json({
        success: false,
        message: "Could not generate a unique class code. Please try again.",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Classroom created successfully.",
      data: {
        classroom,
      },
    });
  } catch (error) {
    console.error("Create classroom error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};

// Get classrooms belonging to the current teacher or student.
const getMyClassrooms = async (req, res) => {
  try {
    let classrooms;

    if (req.user.role === "teacher") {
      classrooms = await Classroom.find({
        teacher: req.user._id,
      })
        .populate("teacher", "name email")
        .populate("students", "name email")
        .sort({ createdAt: -1 });
    } else {
      classrooms = await Classroom.find({
        students: req.user._id,
      })
        .populate("teacher", "name email")
        .populate("students", "name email")
        .sort({ createdAt: -1 });
    }

    return res.status(200).json({
      success: true,
      count: classrooms.length,
      data: {
        classrooms,
      },
    });
  } catch (error) {
    console.error("Get classrooms error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};

// Join classroom using its code.
const joinClassroom = async (req, res) => {
  try {
    const { classCode } = req.body;

    if (typeof classCode !== "string" || !classCode.trim()) {
      return res.status(400).json({
        success: false,
        message: "Class code is required.",
      });
    }

    const classroom = await Classroom.findOne({
      classCode: classCode.trim().toUpperCase(),
    });

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: "Classroom not found. Please check the class code.",
      });
    }

    if (classroom.teacher.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "You cannot join your own classroom as a student.",
      });
    }

    const alreadyJoined = classroom.students.some(
      (studentId) => studentId.toString() === req.user._id.toString()
    );

    if (alreadyJoined) {
      return res.status(409).json({
        success: false,
        message: "You have already joined this classroom.",
      });
    }

    classroom.students.push(req.user._id);
    await classroom.save();

    return res.status(200).json({
      success: true,
      message: "Classroom joined successfully.",
      data: {
        classroom,
      },
    });
  } catch (error) {
    console.error("Join classroom error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};

// Get classroom details by ID.
const getClassroomById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid classroom ID.",
      });
    }

    const classroom = await Classroom.findById(id)
      .populate("teacher", "name email")
      .populate("students", "name email");

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: "Classroom not found.",
      });
    }

    const isTeacher =
      classroom.teacher._id.toString() === req.user._id.toString();

    const isStudent = classroom.students.some(
      (student) => student._id.toString() === req.user._id.toString()
    );

    if (!isTeacher && !isStudent) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to view this classroom.",
      });
    }

    await recordStudentActivity({
      user: req.user,
      classroomId: classroom._id,
      eventType: "classroom_view",
    });

    return res.status(200).json({
      success: true,
      data: {
        classroom,
      },
    });
  } catch (error) {
    console.error("Get classroom details error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};

// Update classroom details.
const updateClassroom = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, subject, semesterSection, courseStartDate } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid classroom ID.",
      });
    }

    if (
      name === undefined &&
      description === undefined &&
      subject === undefined &&
      semesterSection === undefined &&
      courseStartDate === undefined
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Provide a classroom field to update.",
      });
    }

    if (
      name !== undefined &&
      (typeof name !== "string" ||
        name.trim().length < 3 ||
        name.trim().length > 100)
    ) {
      return res.status(400).json({
        success: false,
        message: "Name must be between 3 and 100 characters.",
      });
    }

    if (
      description !== undefined &&
      (typeof description !== "string" ||
        description.trim().length > 500)
    ) {
      return res.status(400).json({
        success: false,
        message: "Description must be a string of at most 500 characters.",
      });
    }

    if (
      subject !== undefined &&
      (typeof subject !== "string" || subject.trim().length > 100)
    ) {
      return res.status(400).json({
        success: false,
        message: "Subject must be a string of at most 100 characters.",
      });
    }

    if (
      semesterSection !== undefined &&
      (typeof semesterSection !== "string" ||
        semesterSection.trim().length > 50)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Semester/Section must be a string of at most 50 characters.",
      });
    }

    let parsedCourseStartDate;
    if (courseStartDate !== undefined) {
      parsedCourseStartDate = new Date(courseStartDate);
      if (Number.isNaN(parsedCourseStartDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "courseStartDate must be a valid date.",
        });
      }
    }

    const classroom = await Classroom.findById(id);

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: "Classroom not found.",
      });
    }

    if (classroom.teacher.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Only the classroom teacher can update it.",
      });
    }

    if (name !== undefined) {
      classroom.name = name.trim();
    }

    if (description !== undefined) {
      classroom.description = description.trim();
    }

    if (subject !== undefined) {
      classroom.subject = subject.trim();
    }

    if (semesterSection !== undefined) {
      classroom.semesterSection = semesterSection.trim();
    }

    if (parsedCourseStartDate !== undefined) {
      classroom.courseStartDate = parsedCourseStartDate;
    }

    await classroom.save();

    return res.status(200).json({
      success: true,
      message: "Classroom updated successfully.",
      data: {
        classroom,
      },
    });
  } catch (error) {
    console.error("Update classroom error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};

// Remove a student from a classroom.
// Their previous submissions are preserved.
const removeStudent = async (req, res) => {
  try {
    const { id, studentId } = req.params;

    if (
      !mongoose.isValidObjectId(id) ||
      !mongoose.isValidObjectId(studentId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid classroom or student ID.",
      });
    }

    const classroom = await Classroom.findById(id);

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: "Classroom not found.",
      });
    }

    if (classroom.teacher.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Only the classroom teacher can remove students.",
      });
    }

    const isMember = classroom.students.some(
      (currentStudentId) =>
        currentStudentId.toString() === studentId
    );

    if (!isMember) {
      return res.status(404).json({
        success: false,
        message: "Student is not a member of this classroom.",
      });
    }

    classroom.students = classroom.students.filter(
      (currentStudentId) =>
        currentStudentId.toString() !== studentId
    );

    await classroom.save();

    return res.status(200).json({
      success: true,
      message: "Student removed successfully.",
    });
  } catch (error) {
    console.error("Remove student error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};

// A student leaves a classroom. Previous submissions are preserved.
const leaveClassroom = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid classroom ID.",
      });
    }

    const classroom = await Classroom.findById(id);

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: "Classroom not found.",
      });
    }

    const isMember = classroom.students.some(
      (studentId) => studentId.toString() === req.user._id.toString()
    );

    if (!isMember) {
      return res.status(404).json({
        success: false,
        message: "You have not joined this classroom.",
      });
    }

    classroom.students = classroom.students.filter(
      (studentId) => studentId.toString() !== req.user._id.toString()
    );

    await classroom.save();

    return res.status(200).json({
      success: true,
      message: "You have left the classroom successfully.",
    });
  } catch (error) {
    console.error("Leave classroom error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};

// Delete classroom and related records.
// IMPORTANT: This is a permanent operation.
const deleteClassroom = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid classroom ID.",
      });
    }

    const classroom = await Classroom.findById(id);

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: "Classroom not found.",
      });
    }

    if (classroom.teacher.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Only the classroom teacher can delete it.",
      });
    }

    // Load dependent records before cleanup so every authenticated PDF can
    // be removed from Cloudinary before its MongoDB reference is deleted.
    const assignments = await Assignment.find({
      classroom: classroom._id,
    }).select("_id attachment.cloudinaryPublicId");

    const assignmentIds = assignments.map((assignment) => assignment._id);

    const [materials, submissions] = await Promise.all([
      StudyMaterial.find({ classroom: classroom._id }).select("cloudinaryPublicId"),
      Submission.find({ assignment: { $in: assignmentIds } }).select(
        "attachment.cloudinaryPublicId"
      ),
    ]);

    const cloudinaryPublicIds = [
      ...materials.map((material) => material.cloudinaryPublicId),
      ...assignments.map((assignment) => assignment.attachment?.cloudinaryPublicId),
      ...submissions.map((submission) => submission.attachment?.cloudinaryPublicId),
    ];

    await deleteAuthenticatedRawAssets(cloudinaryPublicIds);

    // Remove dependent database records. Delete quiz attempts before quizzes
    // so classroom deletion cannot leave dangling quiz references.
    const quizzes = await Quiz.find({ classroom: classroom._id }).select("_id");
    const quizIds = quizzes.map((quiz) => quiz._id);

    await QuizAttempt.deleteMany({ quiz: { $in: quizIds } });
    await Quiz.deleteMany({ classroom: classroom._id });
    await ActivityEvent.deleteMany({ classroom: classroom._id });
    await Doubt.deleteMany({ classroom: classroom._id });

    await Notification.deleteMany({
      classroom: classroom._id,
    });

    await Announcement.deleteMany({
      classroom: classroom._id,
    });

    await Submission.deleteMany({
      assignment: { $in: assignmentIds },
    });

    await Assignment.deleteMany({
      classroom: classroom._id,
    });

    await StudyMaterial.deleteMany({
      classroom: classroom._id,
    });

    await Classroom.deleteOne({
      _id: classroom._id,
    });

    return res.status(200).json({
      success: true,
      message: "Classroom and its related records deleted successfully.",
    });
  } catch (error) {
    console.error("Delete classroom error:", error.message);

    return res.status(500).json({
      success: false,
      message:
        "Classroom deletion/cleanup failed. Check server logs before retrying.",
    });
  }
};

module.exports = {
  createClassroom,
  getMyClassrooms,
  joinClassroom,
  getClassroomById,
  updateClassroom,
  removeStudent,
  leaveClassroom,
  deleteClassroom,
};