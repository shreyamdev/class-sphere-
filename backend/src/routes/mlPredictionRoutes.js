
const express = require("express");

const {
  protect,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const {
  getClassroomRiskPredictions,
} = require("../controllers/mlPredictionController");

const router = express.Router();

// Teacher-only classroom risk prediction.
router.get(
  "/teacher/classrooms/:id/risk-predictions",
  protect,
  authorizeRoles("teacher"),
  getClassroomRiskPredictions
);

module.exports = router;
