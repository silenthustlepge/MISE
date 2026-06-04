# mise

Browser-first kitchen operations dashboard for webcam-based station labeling and bottleneck analysis.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Frontend: React + Vite](https://img.shields.io/badge/Frontend-React%20%2B%20Vite-blue.svg)]()
[![Backend: FastAPI](https://img.shields.io/badge/Backend-FastAPI-green.svg)]()

## What this app actually is

This repository is a React/Vite dashboard with a FastAPI backend that proxies public Ivideon camera frames, captures timestamped stills, lets operators label kitchen stations, and feeds those labels into station-level bottleneck analysis.

It runs as:

- Frontend: React + TypeScript + Vite on port `3000`
- Backend: FastAPI on port `8001`
- Storage: lightweight local JSON capture store at `MISE_CAPTURE_STORE_PATH`

## Key features

- Paste an Ivideon embed URL or iframe snippet and click **Use Source** to switch camera source.
- Backend camera source persistence through `/api/camera-source`.
- Camera health check with accurate states: `LIVE CAMERA READY` or `CAMERA OFFLINE — CACHED MODE`.
- Timestamped frame capture through `/api/captures`.
- Capture image serving through `/api/captures/:id/image`.
- Manual station labels and lightweight auto-labeling.
- Station occupancy and bottleneck dashboard.

## Privacy and accuracy notes

The app is privacy-by-design, but it should not make unverified compliance claims.

- It stores station metadata and labeled frame captures for analysis.
- It does not identify individual workers.
- Display blur is cosmetic and should not be described as legal anonymization.
- Current auto-labeling is a lightweight deterministic station heuristic, not a cloud LLM or TensorFlow model.

## Setup

```bash
yarn install
yarn dev
```

Backend is managed by supervisor in the preview environment:

```bash
supervisorctl status backend frontend
```

For local API testing:

```bash
curl http://127.0.0.1:8001/api/health
curl http://127.0.0.1:8001/api/proxy/status?q=1
```

## Environment

Required values live in `.env`:

- `VITE_API_BASE_URL`
- `VITE_LIVE_IFRAME_URL`
- `VITE_CAMERA_SERVER_ID`
- `VITE_CAMERA_INDEX`
- `VITE_CAMERA_LABEL`
- `VITE_IVIDEON_API_BASE_URL`
- `VITE_IVIDEON_EMBED_BASE_URL`
- `VITE_ALLOWED_HOSTS`
- `VITE_FALLBACK_VIDEO_URL`
- `VITE_DIRECT_FRAME_URL`
- `VITE_FALLBACK_FRAME_URL`
- `MISE_CAPTURE_STORE_PATH`

## Tests

```bash
yarn lint
yarn build
pytest -q /app/tests/test_mise_api.py /app/tests/test_mise_api_contracts.py
REACT_APP_BACKEND_URL=http://127.0.0.1:8001 pytest -q /app/tests/test_mise_api.py /app/tests/test_mise_api_contracts.py
```

## Current limitations

- Browser apps cannot consume RTSP streams directly. Use an embed/HLS source or a backend ingest pipeline.
- The default Dodo camera may be offline; use **Use Source** to switch to a live Ivideon source.
- The current detector is lightweight and deterministic for preview stability. A production vision model should be wired through a backend/cloud service.
