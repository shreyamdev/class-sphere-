
const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const StudyMaterial = require("../models/StudyMaterial");
const Classroom = require("../models/Classroom");
const cloudinary = require("../config/cloudinary");
const { recordStudentActivity } = require("../services/activityTrackingService");

const isValidId = (id) => mongoose.isValidObjectId(id);

const isTeacherOwner = (classroom, userId) =>
  classroom && String(classroom.teacher) === String(userId);

const canAccessClassroom = (classroom, user) => {
  if (!classroom) return false;

  if (user.role === "teacher") {
    return isTeacherOwner(classroom, user._id);
  }

  return (
    user.role === "student" &&
    classroom.students.some(
      (id) => String(id) === String(user._id)
    )
  );
};

// Upload PDF to Cloudinary as an authenticated raw file.
const uploadToCloudinary = (buffer) =>
  new Promise((resolve, reject) => {
    const publicId =
      `classsphere/study-materials/${randomUUID()}.pdf`;

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

const deleteCloudFile = async (publicId) => {
  return cloudinary.uploader.destroy(publicId, {
    resource_type: "raw",
    type: "authenticated",
  });
};

// Create study material.
exports.createStudyMaterial = async (req, res) => {
  let uploadedPublicId;

  try {
    const { id: classroomId } = req.params;
    const { title, description = "" } = req.body;

    if (!isValidId(classroomId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid classroom ID.",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please attach a PDF using the 'file' field.",
      });
    }

    // Verify the PDF signature.
    if (req.file.buffer.subarray(0, 5).toString() !== "%PDF-") {
      return res.status(400).json({
        success: false,
        message: "The uploaded file is not a valid PDF.",
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
      description.length > 2000
    ) {
      return res.status(400).json({
        success: false,
        message: "Description cannot exceed 2000 characters.",
      });
    }

    const classroom = await Classroom.findById(classroomId);

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: "Classroom not found.",
      });
    }

    if (!isTeacherOwner(classroom, req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Only the classroom's teacher can upload materials.",
      });
    }

    const uploaded = await uploadToCloudinary(req.file.buffer);
    uploadedPublicId = uploaded.public_id;

    const material = await StudyMaterial.create({
      title: title.trim(),
      description: description.trim(),
      classroom: classroom._id,
      uploadedBy: req.user._id,
      cloudinaryPublicId: uploaded.public_id,
      originalName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: "application/pdf",
    });

    return res.status(201).json({
      success: true,
      message: "Study material uploaded successfully.",
      material,
    });
  } catch (error) {
    // Clean up the cloud file if saving the database record fails.
    if (uploadedPublicId) {
      try {
        await deleteCloudFile(uploadedPublicId);
      } catch (cleanupError) {
        console.error("Cloudinary cleanup failed:", cleanupError.message);
      }
    }

    console.error("Upload material error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to upload study material.",
    });
  }
};

// Get materials for a classroom.
exports.getClassroomMaterials = async (req, res) => {
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

    if (!canAccessClassroom(classroom, req.user)) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this classroom.",
      });
    }

    const materials = await StudyMaterial.find({
      classroom: classroomId,
    })
      .select("-cloudinaryPublicId -__v")
      .populate("uploadedBy", "name email")
      .sort({ createdAt: -1 })
      .lean();

    const result = materials.map((material) => ({
      ...material,
      downloadUrl: `/api/materials/${material._id}/download`,
    }));

    await recordStudentActivity({
      user: req.user,
      classroomId,
      eventType: "resource_list_view",
    });

    return res.status(200).json({
      success: true,
      count: result.length,
      materials: result,
    });
  } catch (error) {
    console.error("Get materials error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch study materials.",
    });
  }
};

// Download PDF after checking classroom membership.
exports.downloadStudyMaterial = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid material ID.",
      });
    }

    const material = await StudyMaterial.findById(id);

    if (!material) {
      return res.status(404).json({
        success: false,
        message: "Study material not found.",
      });
    }

    const classroom = await Classroom.findById(material.classroom);

    if (!canAccessClassroom(classroom, req.user)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to download this PDF.",
      });
    }

    // Generate a signed URL for the authenticated Cloudinary asset.
    const signedUrl = cloudinary.utils.private_download_url(
      material.cloudinaryPublicId,
      "pdf",
      {
        resource_type: "raw",
        type: "authenticated",
        expires_at: Math.floor(Date.now() / 1000) + 60,
        attachment: true,
      }
    );

    const fileResponse = await fetch(signedUrl);

    if (!fileResponse.ok) {
      console.error(
        "Cloudinary download status:",
        fileResponse.status
      );

      return res.status(502).json({
        success: false,
        message: "Unable to retrieve the PDF from cloud storage.",
      });
    }

    const fileBuffer = Buffer.from(
      await fileResponse.arrayBuffer()
    );

    await recordStudentActivity({
      user: req.user,
      classroomId: material.classroom,
      eventType: "resource_download",
      sourceId: material._id,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", fileBuffer.length);
    res.setHeader("Cache-Control", "private, no-store");
    res.attachment(material.originalName);

    return res.status(200).send(fileBuffer);
  } catch (error) {
    console.error("Download material error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to download study material.",
    });
  }
};

// Update material title or description.
exports.updateStudyMaterial = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid material ID.",
      });
    }

    if (title === undefined && description === undefined) {
      return res.status(400).json({
        success: false,
        message: "Provide a title or description to update.",
      });
    }

    const material = await StudyMaterial.findById(id);

    if (!material) {
      return res.status(404).json({
        success: false,
        message: "Study material not found.",
      });
    }

    const classroom = await Classroom.findById(material.classroom);

    if (!isTeacherOwner(classroom, req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Only the classroom's teacher can update this material.",
      });
    }

    if (title !== undefined) {
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

      material.title = title.trim();
    }

    if (description !== undefined) {
      if (
        typeof description !== "string" ||
        description.length > 2000
      ) {
        return res.status(400).json({
          success: false,
          message: "Description cannot exceed 2000 characters.",
        });
      }

      material.description = description.trim();
    }

    await material.save();

    return res.status(200).json({
      success: true,
      message: "Study material updated successfully.",
      material,
    });
  } catch (error) {
    console.error("Update material error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to update study material.",
    });
  }
};

// Delete material and its cloud file.
exports.deleteStudyMaterial = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid material ID.",
      });
    }

    const material = await StudyMaterial.findById(id);

    if (!material) {
      return res.status(404).json({
        success: false,
        message: "Study material not found.",
      });
    }

    const classroom = await Classroom.findById(material.classroom);

    if (!isTeacherOwner(classroom, req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Only the classroom's teacher can delete this material.",
      });
    }

    await deleteCloudFile(material.cloudinaryPublicId);
    await StudyMaterial.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: "Study material deleted successfully.",
    });
  } catch (error) {
    console.error("Delete material error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to delete study material.",
    });
  }
};
