const mongoose = require("mongoose");

const classroomSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    subject: {
      type: String,
      trim: true,
      maxlength: 100,
      default: "",
    },
    semesterSection: {
      type: String,
      trim: true,
      maxlength: 50,
      default: "",
    },
    // Academic day 0 for the ML observation window.
    courseStartDate: {
      type: Date,
      required: true,
    },
    classCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    students: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  { timestamps: true }
);

classroomSchema.index({ teacher: 1 });
classroomSchema.index({ students: 1 });

module.exports = mongoose.model("Classroom", classroomSchema);
