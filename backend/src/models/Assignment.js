
const mongoose = require("mongoose");

const assignmentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 150,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 5000,
      default: "",
    },

    classroom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Classroom",
      required: true,
    },

    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    dueDate: {
      type: Date,
      required: true,
    },

    maxMarks: {
      type: Number,
      required: true,
      min: 1,
    },

    // Assessment weight used by the ML model.
    // Defaults to 100 for existing assignments.
    weight: {
      type: Number,
      min: 0,
      max: 100,
      default: 100,
    },

    attachment: {
      cloudinaryPublicId: {
        type: String,
        default: null,
      },

      originalName: {
        type: String,
        default: null,
      },

      fileSize: {
        type: Number,
        default: null,
      },

      mimeType: {
        type: String,
        default: null,
      },
    },
  },
  {
    timestamps: true,
  }
);

assignmentSchema.index({
  classroom: 1,
  dueDate: 1,
});

assignmentSchema.index({
  teacher: 1,
});

module.exports = mongoose.model(
  "Assignment",
  assignmentSchema
);
