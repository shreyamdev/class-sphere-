const Announcement = require("../models/Announcement");
const Notification = require("../models/Notification");
const Classroom = require("../models/Classroom");
const { recordStudentActivity } = require("../services/activityTrackingService");

//  Create announcement and notify enrolled students
const createAnnouncement = async (req, res) => {
  let announcement;

  try {
    const { title, content } = req.body;

    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Title and content are required",
      });
    }

    const classroom = await Classroom.findById(req.params.id);

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: "Classroom not found",
      });
    }

    if (classroom.teacher.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "You can only announce in your own classroom",
      });
    }

    announcement = await Announcement.create({
      title: title.trim(),
      content: content.trim(),
      classroom: classroom._id,
      teacher: req.user._id,
    });

    if (classroom.students.length > 0) {
      const notifications = classroom.students.map((studentId) => ({
        recipient: studentId,
        classroom: classroom._id,
        announcement: announcement._id,
        title: "New classroom announcement",
        message: announcement.title,
      }));

      await Notification.insertMany(notifications);
    }

    return res.status(201).json({
      success: true,
      message: "Announcement created successfully",
      data: announcement,
    });
  } catch (error) {
    // Prevent an announcement being left behind if notification creation fails.
    if (announcement) {
      await Promise.all([
        Notification.deleteMany({ announcement: announcement._id }),
        Announcement.findByIdAndDelete(announcement._id),
      ]).catch(() => {});
    }

    console.error("Create announcement error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create announcement",
    });
  }
};

//  Get announcements for a classroom
const getAnnouncements = async (req, res) => {
  try {
    const classroom = await Classroom.findById(req.params.id);

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: "Classroom not found",
      });
    }

    const userId = req.user._id.toString();
    const isTeacher = classroom.teacher.toString() === userId;
    const isStudent = classroom.students.some(
      (studentId) => studentId.toString() === userId
    );

    if (!isTeacher && !isStudent) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this classroom",
      });
    }

    const announcements = await Announcement.find({
      classroom: classroom._id,
    })
      .populate("teacher", "name")
      .sort({ createdAt: -1 });

    await recordStudentActivity({
      user: req.user,
      classroomId: classroom._id,
      eventType: "announcement_list_view",
    });

    return res.status(200).json({
      success: true,
      count: announcements.length,
      data: announcements,
    });
  } catch (error) {
    console.error("Get announcements error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch announcements",
    });
  }
};

//    Update an announcement
const updateAnnouncement = async (req, res) => {
  try {
    const { title, content } = req.body;

    if (title === undefined && content === undefined) {
      return res.status(400).json({
        success: false,
        message: "Provide a title or content to update",
      });
    }

    if (
      (title !== undefined &&
        (typeof title !== "string" || !title.trim())) ||
      (content !== undefined &&
        (typeof content !== "string" || !content.trim()))
    ) {
      return res.status(400).json({
        success: false,
        message: "Title and content must be non-empty strings",
      });
    }

    const announcement = await Announcement.findById(req.params.id);

    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: "Announcement not found",
      });
    }

    if (announcement.teacher.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "You can only update your own announcements",
      });
    }

    if (title !== undefined) announcement.title = title.trim();
    if (content !== undefined) announcement.content = content.trim();

    await announcement.save();

    return res.status(200).json({
      success: true,
      message: "Announcement updated successfully",
      data: announcement,
    });
  } catch (error) {
    console.error("Update announcement error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update announcement",
    });
  }
};
//  Delete an announcement and its notifications
const deleteAnnouncement = async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id);

    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: "Announcement not found",
      });
    }

    if (announcement.teacher.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own announcements",
      });
    }

    await Notification.deleteMany({
      announcement: announcement._id,
    });

    await announcement.deleteOne();

    return res.status(200).json({
      success: true,
      message: "Announcement and related notifications deleted successfully",
    });
  } catch (error) {
    console.error("Delete announcement error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete announcement",
    });
  }
};

module.exports = {
  createAnnouncement,
  getAnnouncements,
  updateAnnouncement,
  deleteAnnouncement,
};