
const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const Assignment = require("../models/Assignment");
const Classroom = require("../models/Classroom");
const Submission = require("../models/Submission");
const cloudinary = require("../config/cloudinary");

const isValidId = (id) => mongoose.isValidObjectId(id);

const isClassroomMember = (classroom, user) => {
  if (!classroom || !user) return false;

  const userId = String(user._id);

  if (String(classroom.teacher) === userId) return true;

  return (
    user.role === "student" &&
    classroom.students.some((id) => String(id) === userId)
  );
};

const uploadAssignmentPdf = (buffer) =>
  new Promise((resolve, reject) => {
    const publicId = `classsphere/assignments/${randomUUID()}.pdf`;

    cloudinary.uploader
      .upload_stream(
        {
          resource_type: "raw",
          type: "authenticated",
          public_id: publicId,
          overwrite: false,
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        }
      )
      .end(buffer);
  });

const uploadSubmissionPdf = (buffer) =>
  new Promise((resolve, reject) => {
    const publicId = `classsphere/submissions/${randomUUID()}.pdf`;

    cloudinary.uploader
      .upload_stream(
        {
          resource_type: "raw",
          type: "authenticated",
          public_id: publicId,
          overwrite: false,
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        }
      )
      .end(buffer);
  });

const deleteCloudPdf = async (publicId) => {
  if (!publicId) return;

  return cloudinary.uploader.destroy(publicId, {
    resource_type: "raw",
    type: "authenticated",
  });
};


// CREATE ASSIGNMENT + OPTIONAL QUESTION PDF
const createAssignment = async (req, res) => {
  let uploadedPublicId = null;

  try {
    const { id: classroomId } = req.params;

    const {
      title,
      description = "",
      dueDate,
      maxMarks,
      weight = 100,
    } = req.body || {};

    if (!isValidId(classroomId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid classroom ID.",
      });
    }

    if (
      typeof title !== "string" ||
      title.trim().length < 3 ||
      title.trim().length > 150
    ) {
      return res.status(400).json({
        success: false,
        message: "Title must be between 3 and 150 characters.",
      });
    }

    if (
      typeof description !== "string" ||
      description.trim().length > 5000
    ) {
      return res.status(400).json({
        success: false,
        message: "Description must not exceed 5000 characters.",
      });
    }

    if (
      typeof dueDate !== "string" ||
      !Number.isFinite(Date.parse(dueDate))
    ) {
      return res.status(400).json({
        success: false,
        message: "A valid due date is required.",
      });
    }

    const parsedDueDate = new Date(dueDate);

    if (parsedDueDate <= new Date()) {
      return res.status(400).json({
        success: false,
        message: "Due date must be in the future.",
      });
    }

    const parsedMaxMarks = Number(maxMarks);

    if (
      !Number.isFinite(parsedMaxMarks) ||
      parsedMaxMarks < 1 ||
      parsedMaxMarks > 10000
    ) {
      return res.status(400).json({
        success: false,
        message: "Maximum marks must be between 1 and 10000.",
      });
    }

    // ML FEATURE: Assessment weight.
    // Defaults to 100 if the frontend does not provide it.

    if (
      weight === null ||
      (typeof weight === "string" && !weight.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "Assessment weight must be a number between 0 and 100.",
      });
    }

    const parsedWeight = Number(weight);

    if (
      !Number.isFinite(parsedWeight) ||
      parsedWeight < 0 ||
      parsedWeight > 100
    ) {
      return res.status(400).json({
        success: false,
        message: "Assessment weight must be between 0 and 100.",
      });
    }

    if (
      req.file &&
      req.file.buffer.subarray(0, 5).toString() !== "%PDF-"
    ) {
      return res.status(400).json({
        success: false,
        message: "The uploaded file is not a valid PDF.",
      });
    }

    const classroom = await Classroom.findById(classroomId);

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: "Classroom not found.",
      });
    }

    if (String(classroom.teacher) !== String(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Only the classroom teacher can create assignments.",
      });
    }

    let attachment;

    if (req.file) {
      const uploaded = await uploadAssignmentPdf(req.file.buffer);
      uploadedPublicId = uploaded.public_id;

      attachment = {
        cloudinaryPublicId: uploaded.public_id,
        originalName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: "application/pdf",
      };
    }

    const assignment = await Assignment.create({
      title: title.trim(),
      description: description.trim(),
      classroom: classroom._id,
      teacher: req.user._id,
      dueDate: parsedDueDate,
      maxMarks: parsedMaxMarks,

      // New ML field
      weight: parsedWeight,

      ...(attachment ? { attachment } : {}),
    });

    const result = assignment.toObject();

    if (result.attachment) {
      result.attachment.hasAttachment = Boolean(
        result.attachment.cloudinaryPublicId
      );
      delete result.attachment.cloudinaryPublicId;
    }

    return res.status(201).json({
      success: true,
      message: "Assignment created successfully.",
      data: { assignment: result },
    });
  } catch (error) {
    if (uploadedPublicId) {
      try {
        await deleteCloudPdf(uploadedPublicId);
      } catch (cleanupError) {
        console.error("PDF cleanup error:", cleanupError.message);
      }
    }

    console.error("Create assignment error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// GET CLASSROOM ASSIGNMENTS
const getAssignments = async (req, res) => {
  try {
    const { id: classroomId } = req.params;

    if (!isValidId(classroomId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid classroom ID.",
      });
    }

    const classroom = await Classroom.findById(classroomId);

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: "Classroom not found.",
      });
    }

    if (!isClassroomMember(classroom, req.user)) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to view these assignments.",
      });
    }

    const assignments = await Assignment.find({
      classroom: classroomId,
    })
      .populate("teacher", "name email")
      .sort({ dueDate: 1 });

    const result = assignments.map((assignment) => {
      const item = assignment.toObject();

      item.hasAttachment = Boolean(
        item.attachment?.cloudinaryPublicId
      );

      if (item.attachment) {
        delete item.attachment.cloudinaryPublicId;
      }

      return item;
    });

    return res.status(200).json({
      success: true,
      count: result.length,
      data: { assignments: result },
    });
  } catch (error) {
    console.error("Get assignments error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// VIEW/DOWNLOAD TEACHER'S ASSIGNMENT PDF
const getAssignmentAttachment = async (req, res) => {
  try {
    const { id: assignmentId } = req.params;

    if (!isValidId(assignmentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid assignment ID.",
      });
    }

    const assignment = await Assignment.findById(assignmentId);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Assignment not found.",
      });
    }

    const classroom = await Classroom.findById(assignment.classroom);

    if (!isClassroomMember(classroom, req.user)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to view this PDF.",
      });
    }

    const publicId = assignment.attachment?.cloudinaryPublicId;

    if (!publicId) {
      return res.status(404).json({
        success: false,
        message: "This assignment has no attached PDF.",
      });
    }

    const signedUrl = cloudinary.utils.private_download_url(
      publicId,
      "pdf",
      {
        resource_type: "raw",
        type: "authenticated",
        expires_at: Math.floor(Date.now() / 1000) + 60,
      }
    );

    const fileResponse = await fetch(signedUrl);

    if (!fileResponse.ok) {
      console.error(
        "Cloudinary PDF response status:",
        fileResponse.status
      );

      return res.status(502).json({
        success: false,
        message: "Unable to retrieve the assignment PDF.",
      });
    }

    const buffer = Buffer.from(await fileResponse.arrayBuffer());

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    const filename = (
      assignment.attachment.originalName || "assignment.pdf"
    ).replace(/[\r\n"]/g, "_");

    res.setHeader(
      "Content-Disposition",
      `inline; filename="${filename}"`
    );

    return res.status(200).send(buffer);
  } catch (error) {
    console.error("Get assignment PDF error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve assignment PDF.",
    });
  }
};


// SUBMIT ASSIGNMENT: TEXT, URL, PDF, OR A COMBINATION
const submitAssignment = async (req, res) => {
  let uploadedPublicId = null;

  try {
    const { id: assignmentId } = req.params;

    const {
      answerText = "",
      submissionUrl = "",
    } = req.body || {};

    if (!isValidId(assignmentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid assignment ID.",
      });
    }

    if (
      typeof answerText !== "string" ||
      answerText.trim().length > 10000
    ) {
      return res.status(400).json({
        success: false,
        message: "Answer must be a string of at most 10000 characters.",
      });
    }

    if (
      typeof submissionUrl !== "string" ||
      submissionUrl.trim().length > 2048
    ) {
      return res.status(400).json({
        success: false,
        message: "Submission URL must be a string of at most 2048 characters.",
      });
    }

    if (
      submissionUrl.trim() &&
      !/^https?:\/\/\S+$/i.test(submissionUrl.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide a valid HTTP or HTTPS submission URL.",
      });
    }

    if (
      !answerText.trim() &&
      !submissionUrl.trim() &&
      !req.file
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide an answer, a submission URL, or a PDF file.",
      });
    }

    if (
      req.file &&
      (
        !req.file.buffer ||
        req.file.buffer.subarray(0, 5).toString() !== "%PDF-"
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "The uploaded file is not a valid PDF.",
      });
    }

    const assignment = await Assignment.findById(assignmentId);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Assignment not found.",
      });
    }

    const classroom = await Classroom.findById(assignment.classroom);

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: "Classroom not found.",
      });
    }

    const isMember = classroom.students.some(
      (studentId) => String(studentId) === String(req.user._id)
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "Join the classroom before submitting assignments.",
      });
    }

    // Late submissions are accepted.
    // submittedAt is saved below. The ML controller compares
    // submittedAt with assignment.dueDate to calculate late_submissions.

    let submission = await Submission.findOne({
      assignment: assignmentId,
      student: req.user._id,
    });

    if (submission && submission.status === "graded") {
      return res.status(400).json({
        success: false,
        message: "This submission has already been graded.",
      });
    }

    if (!submission) {
      submission = new Submission({
        assignment: assignmentId,
        student: req.user._id,
      });
    }

    const previousPublicId =
      submission.attachment?.cloudinaryPublicId || null;

    if (req.file) {
      const uploaded = await uploadSubmissionPdf(req.file.buffer);
      uploadedPublicId = uploaded.public_id;

      submission.attachment = {
        cloudinaryPublicId: uploaded.public_id,
        originalName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: "application/pdf",
      };
    }

    submission.answerText = answerText.trim();
    submission.submissionUrl = submissionUrl.trim();

    // Important for ML late-submission calculation.
    submission.submittedAt = new Date();

    submission.status = "submitted";

    await submission.save();

    if (
      uploadedPublicId &&
      previousPublicId &&
      previousPublicId !== uploadedPublicId
    ) {
      try {
        await deleteCloudPdf(previousPublicId);
      } catch (cleanupError) {
        console.error(
          "Previous submission PDF cleanup error:",
          cleanupError.message
        );
      }
    }

    const responseSubmission = submission.toObject();

    if (responseSubmission.attachment) {
      responseSubmission.attachment.hasAttachment = Boolean(
        responseSubmission.attachment.cloudinaryPublicId
      );
      delete responseSubmission.attachment.cloudinaryPublicId;
    }

    return res.status(201).json({
      success: true,
      message: "Assignment submitted successfully.",
      data: { submission: responseSubmission },
    });
  } catch (error) {
    if (uploadedPublicId) {
      try {
        await deleteCloudPdf(uploadedPublicId);
      } catch (cleanupError) {
        console.error(
          "Submission PDF cleanup error:",
          cleanupError.message
        );
      }
    }

    console.error("Submit assignment error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// GET STUDENT SUBMISSIONS FOR AN ASSIGNMENT (TEACHER)
const getAssignmentSubmissions = async (req, res) => {
  try {
    const { id: assignmentId } = req.params;

    if (!isValidId(assignmentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid assignment ID.",
      });
    }

    const assignment = await Assignment.findById(assignmentId);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Assignment not found.",
      });
    }

    if (String(assignment.teacher) !== String(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Only the assignment teacher can view submissions.",
      });
    }

    const submissions = await Submission.find({
      assignment: assignmentId,
    })
      .populate("student", "name email")
      .sort({ submittedAt: -1 });

    const result = submissions.map((submission) => {
      const item = submission.toObject();

      if (item.attachment) {
        item.attachment.hasAttachment = Boolean(
          item.attachment.cloudinaryPublicId
        );
        delete item.attachment.cloudinaryPublicId;
      }

      return item;
    });

    return res.status(200).json({
      success: true,
      count: result.length,
      data: { submissions: result },
    });
  } catch (error) {
    console.error("Get assignment submissions error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// VIEW/DOWNLOAD A STUDENT'S SUBMITTED PDF (TEACHER ONLY)
const getSubmissionAttachment = async (req, res) => {
  try {
    const { assignmentId, submissionId } = req.params;

    if (
      !isValidId(assignmentId) ||
      !isValidId(submissionId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid assignment or submission ID.",
      });
    }

    const assignment = await Assignment.findById(assignmentId);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Assignment not found.",
      });
    }

    if (String(assignment.teacher) !== String(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Only the assignment teacher can view submitted PDFs.",
      });
    }

    const submission = await Submission.findOne({
      _id: submissionId,
      assignment: assignmentId,
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: "Submission not found for this assignment.",
      });
    }

    const attachment = submission.attachment;
    const publicId = attachment?.cloudinaryPublicId;

    if (!publicId) {
      return res.status(404).json({
        success: false,
        message: "This student has not uploaded a PDF.",
      });
    }

    const signedUrl = cloudinary.utils.private_download_url(
      publicId,
      "pdf",
      {
        resource_type: "raw",
        type: "authenticated",
        expires_at: Math.floor(Date.now() / 1000) + 60,
      }
    );

    const fileResponse = await fetch(signedUrl);

    if (!fileResponse.ok) {
      console.error(
        "Cloudinary submission PDF response:",
        fileResponse.status
      );

      return res.status(502).json({
        success: false,
        message: "Unable to retrieve the student's PDF.",
      });
    }

    const buffer = Buffer.from(await fileResponse.arrayBuffer());

    const filename = (
      attachment.originalName || "student-submission.pdf"
    ).replace(/[\r\n"]/g, "_");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    res.setHeader(
      "Content-Disposition",
      `inline; filename="${filename}"`
    );

    return res.status(200).send(buffer);
  } catch (error) {
    console.error("Get submission attachment error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve the student's PDF.",
    });
  }
};


// GRADE SUBMISSION
const gradeSubmission = async (req, res) => {
  try {
    const { assignmentId, submissionId } = req.params;

    const {
      marksObtained,
      feedback = "",
    } = req.body || {};

    if (
      !isValidId(assignmentId) ||
      !isValidId(submissionId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid assignment or submission ID.",
      });
    }

    const marks = Number(marksObtained);

    if (
      marksObtained === undefined ||
      !Number.isFinite(marks) ||
      marks < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Marks must be a non-negative number.",
      });
    }

    if (
      typeof feedback !== "string" ||
      feedback.trim().length > 3000
    ) {
      return res.status(400).json({
        success: false,
        message: "Feedback must not exceed 3000 characters.",
      });
    }

    const assignment = await Assignment.findById(assignmentId);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Assignment not found.",
      });
    }

    if (String(assignment.teacher) !== String(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Only the assignment teacher can grade submissions.",
      });
    }

    if (marks > assignment.maxMarks) {
      return res.status(400).json({
        success: false,
        message: `Marks cannot exceed ${assignment.maxMarks}.`,
      });
    }

    const submission = await Submission.findOne({
      _id: submissionId,
      assignment: assignmentId,
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: "Submission not found for this assignment.",
      });
    }

    submission.marksObtained = marks;
    submission.feedback = feedback.trim();
    submission.status = "graded";
    submission.gradedAt = new Date();

    await submission.save();

    const result = submission.toObject();

    if (result.attachment) {
      result.attachment.hasAttachment = Boolean(
        result.attachment.cloudinaryPublicId
      );
      delete result.attachment.cloudinaryPublicId;
    }

    return res.status(200).json({
      success: true,
      message: "Submission graded successfully.",
      data: { submission: result },
    });
  } catch (error) {
    console.error("Grade submission error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


// STUDENT VIEWS THEIR SUBMISSION AND GRADE
const getMySubmission = async (req, res) => {
  try {
    const { id: assignmentId } = req.params;

    if (!isValidId(assignmentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid assignment ID.",
      });
    }

    const assignment = await Assignment.findById(assignmentId);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Assignment not found.",
      });
    }

    const classroom = await Classroom.findById(assignment.classroom);

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: "Classroom not found.",
      });
    }

    const isMember = classroom.students.some(
      (studentId) => String(studentId) === String(req.user._id)
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "You are not enrolled in this classroom.",
      });
    }

    const submission = await Submission.findOne({
      assignment: assignmentId,
      student: req.user._id,
    });

    let submissionResult = submission ? submission.toObject() : null;

    if (submissionResult?.attachment) {
      submissionResult.attachment.hasAttachment = Boolean(
        submissionResult.attachment.cloudinaryPublicId
      );
      delete submissionResult.attachment.cloudinaryPublicId;
    }

    return res.status(200).json({
      success: true,
      data: {
        assignment: {
          _id: assignment._id,
          title: assignment.title,
          dueDate: assignment.dueDate,
          maxMarks: assignment.maxMarks,

          // New ML-related assignment field
          weight: assignment.weight ?? 100,

          hasAttachment: Boolean(
            assignment.attachment?.cloudinaryPublicId
          ),
        },
        submission: submissionResult,
      },
    });
  } catch (error) {
    console.error("Get my submission error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


module.exports = {
  createAssignment,
  getAssignments,
  getAssignmentAttachment,
  submitAssignment,
  getAssignmentSubmissions,
  getSubmissionAttachment,
  gradeSubmission,
  getMySubmission,
};
