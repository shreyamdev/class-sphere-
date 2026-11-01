require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../src/models/User");
const Classroom = require("../src/models/Classroom");
const Assignment = require("../src/models/Assignment");
const Submission = require("../src/models/Submission");
const StudyMaterial = require("../src/models/StudyMaterial");
const Quiz = require("../src/models/Quiz");
const QuizAttempt = require("../src/models/QuizAttempt");
const Doubt = require("../src/models/Doubt");
const Announcement = require("../src/models/Announcement");
const Notification = require("../src/models/Notification");
const ActivityEvent = require("../src/models/ActivityEvent");
const cloudinary = require("../src/config/cloudinary");

const asIdSet = (docs) => new Set(docs.map((doc) => String(doc._id)));
const has = (set, value) => value && set.has(String(value));

async function deleteCloudinaryAssets(publicIds) {
  const uniqueIds = [...new Set(publicIds.filter(Boolean))];
  for (const publicId of uniqueIds) {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: "raw",
      type: "authenticated",
      invalidate: true,
    });
    if (result.result !== "ok" && result.result !== "not found") {
      throw new Error(`Could not remove Cloudinary asset ${publicId}`);
    }
  }
  return uniqueIds.length;
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required.");
  if (apply && process.env.ALLOW_ORPHAN_CLEANUP !== "true") {
    throw new Error("Apply blocked. Set ALLOW_ORPHAN_CLEANUP=true after reviewing the dry run.");
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const dbName = mongoose.connection.db.databaseName;
  console.log(`Connected database: ${dbName}`);

  if (apply) {
    const expectedDb = process.env.ORPHAN_CLEANUP_DB_NAME;
    if (!expectedDb || expectedDb !== dbName) {
      throw new Error(
        "ORPHAN_CLEANUP_DB_NAME must exactly match the connected database before --apply."
      );
    }
  }

  const [users, classrooms, assignments, submissions, materials, quizzes,
    attempts, doubts, announcements, notifications, activities] = await Promise.all([
    User.find().select("_id").lean(),
    Classroom.find().select("_id teacher").lean(),
    Assignment.find().select("_id classroom teacher attachment.cloudinaryPublicId").lean(),
    Submission.find().select("_id assignment student attachment.cloudinaryPublicId").lean(),
    StudyMaterial.find().select("_id classroom uploadedBy cloudinaryPublicId").lean(),
    Quiz.find().select("_id classroom teacher").lean(),
    QuizAttempt.find().select("_id quiz student").lean(),
    Doubt.find().select("_id classroom student").lean(),
    Announcement.find().select("_id classroom teacher").lean(),
    Notification.find().select("_id classroom announcement recipient").lean(),
    ActivityEvent.find().select("_id classroom student").lean(),
  ]);

  const userIds = asIdSet(users);
  const classroomIds = asIdSet(classrooms);
  const assignmentIds = asIdSet(assignments);
  const quizIds = asIdSet(quizzes);
  const announcementIds = asIdSet(announcements);

  const orphanClassrooms = classrooms.filter(
    (item) => !has(userIds, item.teacher)
  );
  const orphanClassroomIds = new Set(orphanClassrooms.map((item) => String(item._id)));

  const orphanAssignments = assignments.filter(
    (item) => !has(classroomIds, item.classroom) ||
      orphanClassroomIds.has(String(item.classroom)) ||
      !has(userIds, item.teacher)
  );
  const orphanAssignmentIds = new Set(orphanAssignments.map((item) => String(item._id)));

  const orphanSubmissions = submissions.filter(
    (item) => !has(assignmentIds, item.assignment) ||
      orphanAssignmentIds.has(String(item.assignment)) ||
      !has(userIds, item.student)
  );
  const orphanMaterials = materials.filter(
    (item) => !has(classroomIds, item.classroom) ||
      orphanClassroomIds.has(String(item.classroom)) ||
      !has(userIds, item.uploadedBy)
  );
  const orphanQuizzes = quizzes.filter(
    (item) => !has(classroomIds, item.classroom) ||
      orphanClassroomIds.has(String(item.classroom)) ||
      !has(userIds, item.teacher)
  );
  const orphanQuizIds = new Set(orphanQuizzes.map((item) => String(item._id)));
  const orphanAttempts = attempts.filter(
    (item) => !has(quizIds, item.quiz) || orphanQuizIds.has(String(item.quiz)) || !has(userIds, item.student)
  );
  const orphanDoubts = doubts.filter(
    (item) => !has(classroomIds, item.classroom) ||
      orphanClassroomIds.has(String(item.classroom)) ||
      !has(userIds, item.student)
  );
  const orphanAnnouncements = announcements.filter(
    (item) => !has(classroomIds, item.classroom) ||
      orphanClassroomIds.has(String(item.classroom)) ||
      !has(userIds, item.teacher)
  );
  const orphanAnnouncementIds = new Set(orphanAnnouncements.map((item) => String(item._id)));
  const orphanNotifications = notifications.filter(
    (item) => !has(classroomIds, item.classroom) ||
      orphanClassroomIds.has(String(item.classroom)) ||
      !has(announcementIds, item.announcement) ||
      orphanAnnouncementIds.has(String(item.announcement)) ||
      !has(userIds, item.recipient)
  );
  const orphanActivities = activities.filter(
    (item) => !has(classroomIds, item.classroom) ||
      orphanClassroomIds.has(String(item.classroom)) ||
      !has(userIds, item.student)
  );

  const report = {
    classrooms: orphanClassrooms.length,
    assignments: orphanAssignments.length,
    submissions: orphanSubmissions.length,
    studyMaterials: orphanMaterials.length,
    quizzes: orphanQuizzes.length,
    quizAttempts: orphanAttempts.length,
    doubts: orphanDoubts.length,
    announcements: orphanAnnouncements.length,
    notifications: orphanNotifications.length,
    activityEvents: orphanActivities.length,
  };

  console.log("Orphan audit report:");
  for (const [name, count] of Object.entries(report)) {
    console.log(`  ${name}: ${count}`);
  }

  const total = Object.values(report).reduce((sum, value) => sum + value, 0);
  if (!apply) {
    console.log(`DRY RUN ONLY: ${total} orphaned records identified. No data was changed.`);
    return;
  }

  const assetIds = [
    ...orphanAssignments.map((item) => item.attachment?.cloudinaryPublicId),
    ...orphanSubmissions.map((item) => item.attachment?.cloudinaryPublicId),
    ...orphanMaterials.map((item) => item.cloudinaryPublicId),
  ];
  const deletedAssets = await deleteCloudinaryAssets(assetIds);

  const ids = (items) => items.map((item) => item._id);
  await Promise.all([
    Assignment.deleteMany({ _id: { $in: ids(orphanAssignments) } }),
    Submission.deleteMany({ _id: { $in: ids(orphanSubmissions) } }),
    StudyMaterial.deleteMany({ _id: { $in: ids(orphanMaterials) } }),
    Quiz.deleteMany({ _id: { $in: ids(orphanQuizzes) } }),
    Classroom.deleteMany({ _id: { $in: ids(orphanClassrooms) } }),
    QuizAttempt.deleteMany({ _id: { $in: ids(orphanAttempts) } }),
    Doubt.deleteMany({ _id: { $in: ids(orphanDoubts) } }),
    Announcement.deleteMany({ _id: { $in: ids(orphanAnnouncements) } }),
    Notification.deleteMany({ _id: { $in: ids(orphanNotifications) } }),
    ActivityEvent.deleteMany({ _id: { $in: ids(orphanActivities) } }),
  ]);

  console.log(`Cleanup applied. Cloudinary assets removed/not-found: ${deletedAssets}.`);
}

main()
  .catch((error) => {
    console.error("Orphan audit failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
