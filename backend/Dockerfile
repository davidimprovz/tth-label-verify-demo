# syntax=docker/dockerfile:1
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System libs required by opencv-python-headless (libGL / glib) for the OCR tier.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libgl1 \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies from project metadata. Copy only the files needed to
# resolve deps first so this layer caches across source changes.
COPY pyproject.toml README.md ./
# Minimal package skeletons so the editable install can resolve the packages
# declared in pyproject ([tool.setuptools].packages = backend, scripts).
RUN mkdir -p backend/models backend/services scripts eval/engines \
    && touch backend/__init__.py backend/models/__init__.py \
            backend/services/__init__.py scripts/__init__.py \
            eval/__init__.py eval/engines/__init__.py
# Include the optional `vlm` group (langchain + langchain-ollama, both pure-Python
# MIT — no torch) so the async refinement tier can be switched on at runtime via
# TTB_VLM_ENABLED. It is lazy-imported, so it costs nothing when the flag is off.
RUN pip install --upgrade pip \
    && pip install ".[dev,vlm]"

# Warm the RapidOCR ONNX models into the image so the first request (and tests)
# don't pay the one-time model download. RapidOCR fetches its PP-OCRv5 models on
# first construction; constructing it here bakes them into a build layer.
RUN python -c "from rapidocr_onnxruntime import RapidOCR; RapidOCR()"

# Copy the full source.
COPY . .

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
