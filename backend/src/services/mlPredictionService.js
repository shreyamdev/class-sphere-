
const REQUIRED_FEATURES = [
  "num_assessments_done",
  "avg_score",
  "min_score",
  "weighted_score",
  "late_submissions",
  "active_days",
];

class ModelServiceError extends Error {
  constructor(message, code, statusCode = 502) {
    super(message);
    this.name = "ModelServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const getModelBaseUrl = () => {
  const value = process.env.MODEL_API_URL;
  const apiKey = process.env.MODEL_API_KEY;

  if (!apiKey) {
    throw new ModelServiceError(
      "MODEL_API_KEY is not configured.",
      "MODEL_API_KEY_NOT_CONFIGURED",
      503
    );
  }
  if (apiKey.length < 32) {
    throw new ModelServiceError(
      "MODEL_API_KEY must contain at least 32 characters.",
      "MODEL_API_KEY_TOO_WEAK",
      503
    );
  }

  if (!value) {
    throw new ModelServiceError(
      "MODEL_API_URL is not configured.",
      "MODEL_URL_NOT_CONFIGURED",
      503
    );
  }

  let url;

  try {
    url = new URL(value);
  } catch {
    throw new ModelServiceError(
      "MODEL_API_URL is not a valid URL.",
      "MODEL_URL_INVALID",
      503
    );
  }

  const isLocalHost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1";

  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && isLocalHost)
  ) {
    throw new ModelServiceError(
      "MODEL_API_URL must use HTTPS outside localhost.",
      "MODEL_URL_INSECURE",
      503
    );
  }

  return url.toString().replace(/\/+$/, "");
};

// Validate the six input features before sending them.
const validateStudentInput = (student) => {
  if (
    !student ||
    typeof student !== "object" ||
    Array.isArray(student)
  ) {
    throw new ModelServiceError(
      "Each student input must be a JSON object.",
      "MODEL_INVALID_INPUT",
      400
    );
  }

  const keys = Object.keys(student);

  if (
    keys.length !== REQUIRED_FEATURES.length ||
    REQUIRED_FEATURES.some((field) => !keys.includes(field))
  ) {
    throw new ModelServiceError(
      "Student input must contain exactly the six required ML features.",
      "MODEL_INVALID_INPUT",
      400
    );
  }

  for (const field of REQUIRED_FEATURES) {
    if (
      typeof student[field] !== "number" ||
      !Number.isFinite(student[field]) ||
      student[field] < 0
    ) {
      throw new ModelServiceError(
        `${field} must be a non-negative number.`,
        "MODEL_INVALID_INPUT",
        400
      );
    }
  }

  const integerFields = [
    "num_assessments_done",
    "late_submissions",
    "active_days",
  ];

  for (const field of integerFields) {
    if (!Number.isInteger(student[field])) {
      throw new ModelServiceError(
        `${field} must be a non-negative integer.`,
        "MODEL_INVALID_INPUT",
        400
      );
    }
  }

  if (
    student.avg_score > 100 ||
    student.min_score > 100 ||
    student.min_score > student.avg_score
  ) {
    throw new ModelServiceError(
      "Invalid assessment score values.",
      "MODEL_INVALID_INPUT",
      400
    );
  }

  if (student.late_submissions > student.num_assessments_done) {
    throw new ModelServiceError(
      "late_submissions cannot exceed num_assessments_done.",
      "MODEL_INVALID_INPUT",
      400
    );
  }

  // The PDF describes activity through day 90 inclusive. Depending on
  // course-relative day boundaries, the observation window may contain 91
  // distinct day numbers (day 0 through day 90), so do not cap at 90.

  if (
    student.num_assessments_done === 0 &&
    (student.avg_score !== 0 ||
      student.min_score !== 0 ||
      student.weighted_score !== 0 ||
      student.late_submissions !== 0)
  ) {
    throw new ModelServiceError(
      "Assessment metrics must be zero when no scored assessments exist.",
      "MODEL_INVALID_INPUT",
      400
    );
  }
};

const postJson = async (path, body) => {
  const baseUrl = getModelBaseUrl();

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    60000
  );

  try {
    const response = await fetch(
      `${baseUrl}${path}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Model-API-Key": process.env.MODEL_API_KEY,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );

    let data;

    try {
      data = await response.json();
    } catch {
      throw new ModelServiceError(
        "The ML service returned an unreadable response.",
        "MODEL_INVALID_RESPONSE",
        502
      );
    }

    if (!response.ok) {
      console.error(
        `ML service responded with HTTP ${response.status}.`
      );

      throw new ModelServiceError(
        response.status === 422
          ? "The ML service rejected the prediction input. Check the six model features."
          : "The ML prediction service returned an error.",
        "MODEL_REQUEST_FAILED",
        502
      );
    }

    return data;
  } catch (error) {
    if (error instanceof ModelServiceError) {
      throw error;
    }

    if (error.name === "AbortError") {
      throw new ModelServiceError(
        "The ML prediction service timed out. Please retry.",
        "MODEL_TIMEOUT",
        504
      );
    }

    throw new ModelServiceError(
      "The ML prediction service is unreachable. Please retry later.",
      "MODEL_UNAVAILABLE",
      502
    );
  } finally {
    clearTimeout(timeout);
  }
};

const predictBatch = async (students) => {
  if (!Array.isArray(students) || students.length === 0) {
    return [];
  }

  students.forEach(validateStudentInput);

  const data = await postJson(
    "/predict-batch",
    students
  );

  if (
    !Array.isArray(data) ||
    data.length !== students.length
  ) {
    throw new ModelServiceError(
      "The ML service returned an unexpected number of predictions.",
      "MODEL_RESPONSE_MISMATCH",
      502
    );
  }

  for (const prediction of data) {
    const probability = prediction?.risk_probability;
    const expectedAtRisk =
      typeof probability === "number" && probability >= 0.35;
    const expectedRiskLevel =
      typeof probability !== "number"
        ? null
        : probability < 0.35
          ? "Low"
          : probability < 0.65
            ? "Medium"
            : "High";

    if (
      typeof prediction?.at_risk !== "boolean" ||
      typeof probability !== "number" ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1 ||
      !["Low", "Medium", "High"].includes(prediction?.risk_level) ||
      prediction.at_risk !== expectedAtRisk ||
      prediction.risk_level !== expectedRiskLevel
    ) {
      throw new ModelServiceError(
        "The ML service returned an invalid or threshold-inconsistent prediction result.",
        "MODEL_INVALID_RESPONSE",
        502
      );
    }
  }

  return data;
};

module.exports = {
  predictBatch,
  ModelServiceError,
};
