
require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const User = require("../src/models/User");
const Classroom = require("../src/models/Classroom");
const Assignment = require("../src/models/Assignment");
const Submission = require("../src/models/Submission");
const Announcement = require("../src/models/Announcement");
const Notification = require("../src/models/Notification");
const StudyMaterial = require("../src/models/StudyMaterial");
const Quiz = require("../src/models/Quiz");
const QuizAttempt = require("../src/models/QuizAttempt");
const Doubt = require("../src/models/Doubt");
const ActivityEvent = require("../src/models/ActivityEvent");
const cloudinary = require("../src/config/cloudinary");

const DEMO_PASSWORD = "Demo@12345";
const DAY = 24 * 60 * 60 * 1000;

async function seedDemo() {
  try {
    if (process.env.ALLOW_DATABASE_RESET !== "true") {
      throw new Error("Reset blocked. Set ALLOW_DATABASE_RESET=true only when ready.");
    }

    if (!process.env.MONGODB_URI || !process.env.RESET_DB_NAME) {
      throw new Error("MONGODB_URI and RESET_DB_NAME are required.");
    }

    await mongoose.connect(process.env.MONGODB_URI);

    const actualDbName = mongoose.connection.db.databaseName;
    const expectedDbName = process.env.RESET_DB_NAME.trim();

    if (actualDbName !== expectedDbName) {
      throw new Error(
        `Database mismatch: connected to "${actualDbName}", expected "${expectedDbName}". Nothing was deleted.`
      );
    }

    console.log(`Connected to existing database: ${actualDbName}`);

    // Remove old authenticated PDFs before clearing their MongoDB references.
    const [oldAssignments, oldSubmissions, oldMaterials] = await Promise.all([
      Assignment.find().select("attachment.cloudinaryPublicId").lean(),
      Submission.find().select("attachment.cloudinaryPublicId").lean(),
      StudyMaterial.find().select("cloudinaryPublicId").lean(),
    ]);
    const oldAssetIds = [...new Set([
      ...oldAssignments.map((item) => item.attachment?.cloudinaryPublicId),
      ...oldSubmissions.map((item) => item.attachment?.cloudinaryPublicId),
      ...oldMaterials.map((item) => item.cloudinaryPublicId),
    ].filter(Boolean))];

    for (const publicId of oldAssetIds) {
      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: "raw",
        type: "authenticated",
        invalidate: true,
      });
      if (result.result !== "ok" && result.result !== "not found") {
        throw new Error(`Could not remove existing Cloudinary asset ${publicId}`);
      }
    }

    // Clear dependent records first.
    const modelsToClear = [
      Notification,
      QuizAttempt,
      Quiz,
      Doubt,
      ActivityEvent,
      Submission,
      Announcement,
      Assignment,
      StudyMaterial,
      Classroom,
      User,
    ];

    for (const Model of modelsToClear) {
      const result = await Model.deleteMany({});
      console.log(`${Model.modelName}: deleted ${result.deletedCount}`);
    }

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

    const teacherSeed = [
      ["Aarav Sharma", "aarav.sharma"],
      ["Priya Verma", "priya.verma"],
      ["Rahul Mehta", "rahul.mehta"],
      ["Neha Kapoor", "neha.kapoor"],
    ];

    const studentSeed = [
      ["Ananya Gupta", "ananya.gupta"],
      ["Rohan Singh", "rohan.singh"],
      ["Ishita Patel", "ishita.patel"],
      ["Kabir Jain", "kabir.jain"],
      ["Meera Joshi", "meera.joshi"],
      ["Arjun Kumar", "arjun.kumar"],
      ["Diya Agarwal", "diya.agarwal"],
      ["Vivaan Shah", "vivaan.shah"],
      ["Sara Khan", "sara.khan"],
      ["Aditya Verma", "aditya.verma"],
      ["Aditi Mishra", "aditi.mishra"],
      ["Kunal Bansal", "kunal.bansal"],
      ["Tanya Roy", "tanya.roy"],
      ["Dev Malhotra", "dev.malhotra"],
      ["Nisha Yadav", "nisha.yadav"],
    ];

    const teachers = await User.insertMany(
      teacherSeed.map(([name, handle]) => ({
        name,
        email: `teacher.${handle}@demo.classsphere.test`,
        password: passwordHash,
        role: "teacher",
        isEmailVerified: true,
      }))
    );

    const students = await User.insertMany(
      studentSeed.map(([name, handle]) => ({
        name,
        email: `student.${handle}@demo.classsphere.test`,
        password: passwordHash,
        role: "student",
        isEmailVerified: true,
      }))
    );

    const classroomSpecs = [
      { name: "Data Structures & Algorithms", subject: "Computer Science", section: "Semester 3 - A", teacher: 0, students: [0, 1, 2, 3, 4, 5, 6], code: "CSDS2601" },
      { name: "Database Management Systems", subject: "DBMS", section: "Semester 3 - A", teacher: 1, students: [2, 3, 4, 5, 7, 8, 9], code: "CSDB2602" },
      { name: "Full Stack Web Development", subject: "Web Development", section: "Semester 3 - B", teacher: 2, students: [0, 5, 6, 7, 8, 10, 11], code: "CSWD2603" },
      { name: "Operating Systems", subject: "Computer Science", section: "Semester 3 - A", teacher: 0, students: [1, 3, 6, 9, 10, 12, 13], code: "CSOS2604" },
      { name: "Artificial Intelligence Fundamentals", subject: "Artificial Intelligence", section: "Semester 3 - B", teacher: 3, students: [2, 4, 7, 8, 11, 12, 14], code: "CSAI2605" },
      { name: "Computer Networks", subject: "Networking", section: "Semester 4 - A", teacher: 1, students: [0, 1, 5, 9, 10, 13, 14], code: "CSCN2606" },
      { name: "Software Engineering", subject: "Software Engineering", section: "Semester 4 - B", teacher: 2, students: [2, 3, 6, 7, 11, 12, 14], code: "CSSE2607" },
    ];

    const now = new Date();
    // Demo courses are 120 days old so predictions can be exercised immediately.
    const demoCourseStart = new Date(now.getTime() - 120 * DAY);

    const classrooms = await Classroom.insertMany(
      classroomSpecs.map((spec, index) => ({
        name: spec.name,
        description: `ClassSphere demo classroom for ${spec.name}. Explore announcements, assignments, submissions, and learning progress.`,
        subject: spec.subject,
        semesterSection: spec.section,
        classCode: spec.code,
        courseStartDate: new Date(demoCourseStart.getTime() - index * DAY),
        teacher: teachers[spec.teacher]._id,
        students: spec.students.map((i) => students[i]._id),
      }))
    );

    const assignmentTemplates = [
      { title: "Concept Check", description: "Answer core concept questions and explain your reasoning.", maxMarks: 20, dueInCourseDays: 20, weight: 20 },
      { title: "Practical Exercise", description: "Complete practical tasks and submit your solution.", maxMarks: 30, dueInCourseDays: 45, weight: 30 },
      { title: "Mini Project", description: "Build a small project demonstrating the topics covered.", maxMarks: 50, dueInCourseDays: 70, weight: 50 },
    ];

    const assignmentsToCreate = [];

    classrooms.forEach((classroom, i) => {
      assignmentTemplates.forEach((template, j) => {
        assignmentsToCreate.push({
          title: `${classroom.name} - ${template.title}`,
          description: template.description,
          classroom: classroom._id,
          teacher: teachers[classroomSpecs[i].teacher]._id,
          dueDate: new Date(
            classroom.courseStartDate.getTime() +
            (template.dueInCourseDays + (i % 3)) * DAY
          ),
          maxMarks: template.maxMarks,
          weight: template.weight,
        });
      });
    });

    const assignments = await Assignment.insertMany(assignmentsToCreate);

    const submissionsToCreate = [];

    assignments.forEach((assignment, assignmentIndex) => {
      const classroom = classrooms.find((c) => c._id.equals(assignment.classroom));

      classroom.students.forEach((studentId, studentIndex) => {
        if ((studentIndex + assignmentIndex) % 4 === 0) return;

        const graded = (studentIndex + assignmentIndex) % 3 !== 0;
        const marks = Math.min(
          assignment.maxMarks,
          Math.round(assignment.maxMarks * (0.55 + ((studentIndex + assignmentIndex) % 5) * 0.09))
        );

        submissionsToCreate.push({
          assignment: assignment._id,
          student: studentId,
          answerText: `Demo response for ${assignment.title}. I completed the required concepts and included examples.`,
          submittedAt: new Date(
            assignment.dueDate.getTime() +
            (((studentIndex + assignmentIndex) % 5) - 2) * DAY
          ),
          status: graded ? "graded" : "submitted",
          marksObtained: graded ? marks : null,
          feedback: graded
            ? marks / assignment.maxMarks >= 0.8
              ? "Excellent work. Clear explanation and good application."
              : "Good attempt. Review the feedback and strengthen your explanation."
            : "",
          gradedAt: graded ? new Date(now.getTime() - (studentIndex % 3) * DAY) : null,
        });
      });
    });

    await Submission.insertMany(submissionsToCreate);

    const announcementTemplates = [
      {
        title: "Welcome to your classroom",
        content: "Welcome to ClassSphere! Check this classroom regularly for resources, assignments, and important updates.",
      },
      {
        title: "Weekly learning plan",
        content: "Focus on core concepts, complete the practical exercise, and raise questions during class discussion.",
      },
    ];

    const announcementsToCreate = [];

    classrooms.forEach((classroom, i) => {
      announcementTemplates.forEach((announcement) => {
        announcementsToCreate.push({
          ...announcement,
          classroom: classroom._id,
          teacher: teachers[classroomSpecs[i].teacher]._id,
        });
      });
    });

    const announcements = await Announcement.insertMany(announcementsToCreate);
    const notificationsToCreate = [];

    announcements.forEach((announcement) => {
      const classroom = classrooms.find((c) => c._id.equals(announcement.classroom));

      classroom.students.forEach((studentId, i) => {
        notificationsToCreate.push({
          recipient: studentId,
          classroom: classroom._id,
          announcement: announcement._id,
          title: announcement.title,
          message: `New update posted in ${classroom.name}.`,
          isRead: i % 4 === 0,
        });
      });
    });

    await Notification.insertMany(notificationsToCreate);

    // Seed real activity events used by the six-feature ML model.
    // The event dates are within each classroom's first 90 course days.
    const activityEvents = [];
    const activityTypes = [
      "classroom_view",
      "assignment_list_view",
      "quiz_list_view",
      "announcement_list_view",
      "doubt_list_view",
      "resource_list_view",
      "resource_download",
      "doubt_created",
      "doubt_reply",
    ];

    classrooms.forEach((classroom, classIndex) => {
      classroom.students.forEach((studentId, studentIndex) => {
        const activityOffsets = [
          3 + (studentIndex % 3),
          11 + (studentIndex % 4),
          22 + (classIndex % 5),
          36 + (studentIndex % 6),
          51 + (classIndex % 7),
          68 + (studentIndex % 5),
          84 - (classIndex % 4),
        ];

        activityOffsets.forEach((dayOffset, eventIndex) => {
          activityEvents.push({
            student: studentId,
            classroom: classroom._id,
            eventType: activityTypes[eventIndex % activityTypes.length],
            occurredAt: new Date(
              classroom.courseStartDate.getTime() +
              dayOffset * DAY +
              (eventIndex + 1) * 60 * 1000
            ),
          });
        });
      });
    });

    // Also create explicit activity events for the synthetic assignment submissions.
    submissionsToCreate.forEach((submission) => {
      const assignment = assignments.find((item) =>
        item._id.equals(submission.assignment)
      );
      if (!assignment) return;
      activityEvents.push({
        student: submission.student,
        classroom: assignment.classroom,
        eventType: "assignment_submission",
        sourceId: assignment._id,
        occurredAt: submission.submittedAt,
      });
    });

    await ActivityEvent.insertMany(activityEvents);

    // Leave StudyMaterial empty for actual teacher uploads.
    console.log("\nSEED COMPLETE");
    console.log(`Database: ${actualDbName}`);
    console.log(`Teachers: ${teachers.length}`);
    console.log(`Students: ${students.length}`);
    console.log(`Classrooms: ${classrooms.length}`);
    console.log(`Assignments: ${assignments.length}`);
    console.log(`Submissions: ${submissionsToCreate.length}`);
    console.log(`Announcements: ${announcements.length}`);
    console.log(`Notifications: ${notificationsToCreate.length}`);
    console.log(`Activity events: ${activityEvents.length}`);
    console.log("Study materials: 0");
    console.log(`Demo password for all accounts: ${DEMO_PASSWORD}`);

    teachers.forEach((u) => console.log(`TEACHER ${u.email}`));
    students.forEach((u) => console.log(`STUDENT ${u.email}`));
  } catch (error) {
    console.error("Seed failed:", error.message);
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

seedDemo();
