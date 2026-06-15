# syntax=docker/dockerfile:1
# Cloud Run image: builds the React UI, then a lean Python backend that serves
# both the API and the built UI from one container ($PORT-aware).

# --- Stage 1: build the React frontend ------------------------------------
FROM node:20-slim AS frontend
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json* ./
# `npm ci` (and `npm install` against an existing lockfile) has a known bug
# (npm/cli#4828) where a lockfile generated on one OS/arch omits another
# platform's optional native deps (e.g. rollup's binary), breaking `vite build`
# on linux/amd64 (Cloud Build). Dropping the lockfile forces a clean resolution
# that installs the correct platform binary — works on both arm64 and amd64.
RUN rm -rf node_modules package-lock.json && npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# --- Stage 2: backend runtime ---------------------------------------------
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System libs for opencv-python-headless (OCR tier).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

# Resolve deps first (cached across source changes). Package skeletons let the
# install resolve the declared packages without the full source.
COPY pyproject.toml README.md ./
RUN mkdir -p backend/models backend/services scripts \
    && touch backend/__init__.py backend/models/__init__.py \
            backend/services/__init__.py scripts/__init__.py
# Production deps only: runtime + the optional vlm group (langchain/langchain-ollama,
# pure-Python MIT, no torch). NOT [dev]/[bench] — keep the image lean / cold start low.
RUN pip install --upgrade pip && pip install ".[vlm]"

# Bake the RapidOCR ONNX models into the image so first request pays no download.
RUN python -c "from rapidocr_onnxruntime import RapidOCR; RapidOCR()"

# Real source over the skeletons.
COPY backend/ ./backend/
COPY scripts/ ./scripts/
# Built UI, served by FastAPI StaticFiles (see backend/main.py).
COPY --from=frontend /ui/dist ./frontend/dist
ENV TTB_FRONTEND_DIST=/app/frontend/dist

# Cloud Run injects $PORT; shell form so it expands. Falls back to 8000 locally.
CMD exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}
