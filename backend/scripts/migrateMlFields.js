require("dotenv").config();
const mongoose = require("mongoose");

const Classroom = require("../src/models/Classroom");
const Assignment = require("../src/models/Assignment");

async function migrateMlFields() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required.");
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const dbName = mongoose.connection.db.databaseName;
  console.log(`Connected to database: ${dbName}`);

  const classrooms = await Classroom.collection.updateMany(
    {
      $or: [
        { courseStartDate: { $exists: false } },
        { courseStartDate: null },
      ],
    },
    [
      {
        $set: {
          courseStartDate: {
            $ifNull: ["$createdAt", new Date()],
          },
        },
      },
    ]
  );

  const assignments = await Assignment.collection.updateMany(
    {
      $or: [
        { weight: { $exists: false } },
        { weight: null },
      ],
    },
    { $set: { weight: 100 } }
  );

  console.log(`Classrooms backfilled from createdAt: ${classrooms.modifiedCount}`);
  console.log(`Assignments backfilled with weight 100: ${assignments.modifiedCount}`);
  console.log("Migration complete. Review weight semantics with the ML training owner.");
}

migrateMlFields()
  .catch((error) => {
    console.error("ML field migration failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
