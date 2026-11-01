# ML FastAPI Security Contract (ML teammate action required)

The Node backend sends `X-Model-API-Key` on every prediction request and requires `MODEL_API_KEY` to be configured. The Python service must validate that header itself. Without the Python-side check, the public FastAPI endpoints remain callable by anyone who knows the service URL.

Add this to the FastAPI service:

```python
import os
import secrets
from fastapi import Header, HTTPException


def require_backend_api_key(
    x_model_api_key: str | None = Header(default=None),
) -> None:
    expected = os.getenv("MODEL_API_KEY")
    if not expected:
        # Fail closed if the deployment is missing its secret.
        raise RuntimeError("MODEL_API_KEY is not configured")
    if not x_model_api_key or not secrets.compare_digest(
        x_model_api_key, expected
    ):
        raise HTTPException(status_code=401, detail="Invalid API key")
```

Attach the dependency to both prediction routes:

```python
from fastapi import Depends

@app.post("/predict", dependencies=[Depends(require_backend_api_key)])
def predict(...):
    ...

@app.post("/predict-batch", dependencies=[Depends(require_backend_api_key)])
def predict_batch(...):
    ...
```

Keep `GET /` public only if it returns health status and no model or environment details. Set the exact same high-entropy `MODEL_API_KEY` in the Express and FastAPI deployment environments. Use HTTPS. Do not put this key in the frontend, source control, logs, or API responses.

## Deployment verification

1. Request `/predict-batch` without the header: expect HTTP 401.
2. Request with an incorrect header: expect HTTP 401.
3. Request with the correct header and six valid features: expect HTTP 200.
4. Call the Express classroom risk-predictions endpoint: expect the Node service to add the header and receive the prediction response.

This change requires a code/deployment update in the separate Python repository; it cannot be completed solely by changing the Node backend archive.
