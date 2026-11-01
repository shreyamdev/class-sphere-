
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  predictBatch,
  ModelServiceError,
} = require("../services/mlPredictionService");

const originalFetch = global.fetch;
const originalModelUrl = process.env.MODEL_API_URL;

const validStudent = {
  num_assessments_done: 2,
  avg_score: 62.5,
  min_score: 50,
  weighted_score: 14.2,
  late_submissions: 1,
  active_days: 24,
};

const validPrediction = {
  at_risk: true,
  risk_probability: 0.6248,
  risk_level: "Medium",
};

test.after(() => {
  global.fetch = originalFetch;

  if (originalModelUrl === undefined) {
    delete process.env.MODEL_API_URL;
  } else {
    process.env.MODEL_API_URL = originalModelUrl;
  }
});

test("predictBatch sends six-feature inputs to /predict-batch", async () => {
  process.env.MODEL_API_URL = "https://ml-service.example";

  let receivedUrl;
  let receivedOptions;

  const expected = [
    validPrediction,
    {
      at_risk: false,
      risk_probability: 0.12,
      risk_level: "Low",
    },
  ];

  global.fetch = async (url, options) => {
    receivedUrl = url;
    receivedOptions = options;

    return new Response(JSON.stringify(expected), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  };

  const input = [
    validStudent,
    {
      num_assessments_done: 0,
      avg_score: 0,
      min_score: 0,
      weighted_score: 0,
      late_submissions: 0,
      active_days: 3,
    },
  ];

  const result = await predictBatch(input);

  assert.equal(
    receivedUrl,
    "https://ml-service.example/predict-batch"
  );

  assert.equal(receivedOptions.method, "POST");

  assert.equal(
    receivedOptions.headers["Content-Type"],
    "application/json"
  );

  assert.deepEqual(
    JSON.parse(receivedOptions.body),
    input
  );

  assert.deepEqual(result, expected);
});

test("predictBatch rejects extra ML input fields", async () => {
  process.env.MODEL_API_URL = "https://ml-service.example";

  const invalidStudent = {
    ...validStudent,
    gender: "M",
  };

  await assert.rejects(
    predictBatch([invalidStudent]),
    (error) =>
      error instanceof ModelServiceError &&
      error.code === "MODEL_INVALID_INPUT"
  );
});

test("predictBatch rejects missing ML input fields", async () => {
  process.env.MODEL_API_URL = "https://ml-service.example";

  const invalidStudent = {
    num_assessments_done: 2,
    avg_score: 62.5,
  };

  await assert.rejects(
    predictBatch([invalidStudent]),
    (error) =>
      error instanceof ModelServiceError &&
      error.code === "MODEL_INVALID_INPUT"
  );
});

test("predictBatch rejects a mismatched prediction count", async () => {
  process.env.MODEL_API_URL = "https://ml-service.example";

  global.fetch = async () =>
    new Response(JSON.stringify([]), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });

  await assert.rejects(
    predictBatch([validStudent]),
    (error) =>
      error instanceof ModelServiceError &&
      error.code === "MODEL_RESPONSE_MISMATCH"
  );
});

test("predictBatch reports a missing MODEL_API_URL", async () => {
  delete process.env.MODEL_API_URL;

  await assert.rejects(
    predictBatch([validStudent]),
    (error) =>
      error instanceof ModelServiceError &&
      error.code === "MODEL_URL_NOT_CONFIGURED"
  );
});

test("predictBatch rejects invalid prediction probabilities", async () => {
  process.env.MODEL_API_URL = "https://ml-service.example";

  global.fetch = async () =>
    new Response(
      JSON.stringify([
        {
          at_risk: true,
          risk_probability: 1.5,
          risk_level: "High",
        },
      ]),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

  await assert.rejects(
    predictBatch([validStudent]),
    (error) =>
      error instanceof ModelServiceError &&
      error.code === "MODEL_INVALID_RESPONSE"
  );
});
