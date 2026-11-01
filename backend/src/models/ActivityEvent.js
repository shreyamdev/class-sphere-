const mongoose = require("mongoose");

const activityEventSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    classroom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Classroom",
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: [
        "classroom_view",
        "assignment_list_view",
        "assignment_submission",
        "quiz_list_view",
        "quiz_attempt",
        "announcement_list_view",
        "doubt_list_view",
        "resource_list_view",
        "resource_download",
        "doubt_created",
        "doubt_reply",
      ],
      required: true,
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    occurredAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

activityEventSchema.index({ student: 1, classroom: 1, occurredAt: 1 });
activityEventSchema.index({ classroom: 1, occurredAt: 1 });

module.exports = mongoose.model("ActivityEvent", activityEventSchema);
