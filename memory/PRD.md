# MISE PRD

## Original Problem Statement
Build and stabilize a real-time webcam pipeline for the MISE kitchen operations dashboard using the public Dodo Pizza Guzovsky Ivideon stream. Include proxy access, timestamped frame capture, capture sessions, schema/storage equivalent, COCO-SSD detection, labeling UI, overlays, and dashboard integration.

## Crash Diagnosis
The app was crashing / becoming nonfunctional due to a combination of runtime and efficiency issues:
- Supervisor initially pointed to missing `/app/frontend`, causing the real served app to fail even when local tests worked.
- Duplicate Vite processes fought for port 3000/3001, creating inconsistent runtime behavior.
- Capture data was stored as base64 in watched project files, triggering Vite reload loops.
- `/api/captures` returned every capture with full base64 image payloads, causing repeated multi-MB polling and browser memory pressure.
- Browser localStorage stored too many full base64 images, risking quota and reload instability.
- COCO-SSD/TensorFlow loaded on page open, causing WebGL warnings and heavy startup work.
- Label buttons could be clicked while capture was still in progress, applying labels to the previous frame.

## Architecture Decisions
- Existing repository is a Vite React app, not Convex, so the pipeline is implemented with Vite dev middleware API routes.
- Public Ivideon camera JPEG frames are proxied through `/api/proxy/frame`.
- HLS iframe remains embedded directly; the UI camera health badge checks the reliable JPEG proxy and shows CAMERA READY.
- Captures are stored in `/tmp/mise-capture-store.json` to avoid Vite reload loops.
- Server keeps at most 20 captures; browser localStorage mirrors at most 8 lightweight entries.
- `GET /api/captures` returns lightweight metadata + `imageUrl`; image bytes are retrieved via `/api/captures/:id/image`.
- COCO-SSD is lazy-loaded only when Auto Detect is clicked and uses CPU backend to reduce WebGL warnings.

## Implemented
- Live Ivideon iframe viewer and camera health badge.
- Server-side JPEG proxy, stream-url resolver, lightweight capture metadata endpoint, and image endpoint.
- Timestamped capture creation, label persistence, and continuous capture sessions.
- Labeling studio with capture gallery, manual station labels, COCO-SSD auto detection, and reliable station overlays.
- Dashboard occupancy integration and high-contrast Swiss-style UI.
- Fixed preview host blocking and supervisor runtime config.
- Fixed duplicate frontend process conflict.
- Fixed crash causes by reducing payload size, file watching, polling frequency, localStorage size, and startup ML load.
- Fixed stale-frame labeling by disabling label buttons during capture and tracking the active capture ID.

## Validation
- `yarn lint` passes.
- `yarn build` passes.
- `pytest /app/tests/test_mise_api.py /app/tests/test_mise_api_contracts.py` passes: 8/8.
- Supervisor reports frontend RUNNING on port 3000.
- API stress confirms captures list has no base64 payload and image endpoint returns JPEG bytes.
- Browser test confirms CAMERA READY, COCO-SSD ON DEMAND, capture works repeatedly, label overlay appears, Save Labels persists, and no crash/OOM/quota console errors appear.
- Independent testing agent verified backend + frontend flows and no mocked APIs.

## Prioritized Backlog
### P0
- Keep preview host list updated through `VITE_ALLOWED_HOSTS` for future preview domains.

### P1
- Add persistent production backend/storage if captures need to survive beyond local file storage.
- Add editable bounding-box drawing instead of zone-button labels only.

### P2
- Code-split TensorFlow model imports to further reduce initial bundle size.
- Add station-specific analytics history charts.


## Latest Feature: Custom Livestream Source
- Added a livestream source input that accepts full Ivideon iframe embed HTML or direct embed URLs like `https://open.ivideon.com/embed/v3/100-7BSgZfsYiTvX0Ykm406uEg:0/`.
- The parser extracts `serverId` and `cameraIndex`, updates the live iframe, and routes capture/status/session API calls to the selected camera.
- Custom camera captures store the custom `cameraId`, `cameraLabel`, and image endpoint correctly.
- Validation: `yarn lint`, `yarn build`, API tests 9/9, and browser test for pasted embed → capture → label overlay passed.


## Camera Check Failed Diagnosis + Fix
- Diagnosis: the original default Ivideon camera currently returns `418 CAMERA_OFFLINE`, so a failure badge was expected for that source. The newly provided Ivideon camera `100-7BSgZfsYiTvX0Ykm406uEg:0` returns live JPEG frames successfully.
- Fix: camera health now distinguishes `LIVE CAMERA READY` from `CAMERA OFFLINE — CACHED MODE` instead of generic failure.
- Fix: live iframe now uses the selected camera source and shows a live proxy thumbnail when the frame proxy verifies the camera.
- Fix: fallback logic no longer incorrectly marks fallback frames as live.
- Validation: default source reports cached/offline accurately; custom source reports `LIVE CAMERA READY`; capture + label overlay works; `yarn lint`, `yarn build`, and API tests 9/9 pass.


## Backend Source Selection Fix
- Diagnosed Use Source button: frontend switched local state, but the backend still treated source as request-specific/default, making the project flow unreliable.
- Added backend active camera source endpoints: `GET /api/camera-source`, `POST /api/camera-source`, `POST /api/camera-source/reset`.
- Use Source now saves the chosen Ivideon camera to backend state, stops any active capture session, verifies health, updates UI status, and makes future captures/sessions use the selected backend source.
- Added regression tests for backend active camera switching and custom source captures.
- Validation: `yarn lint`, `yarn build`, API tests 10/10, and browser Use Source → LIVE CAMERA READY → capture → label → save passed.


## Preview Camera Check Failed Root Cause + Full Fix
- Root cause: the preview environment routes `/api/*` to backend port 8001, but the project only had API logic inside Vite dev middleware on port 3000. In preview, camera status/capture API calls therefore failed and the UI showed `CAMERA CHECK FAILED`.
- Fix: added a real FastAPI backend in `/app/backend/server.py` serving `/api/health`, `/api/camera-source`, `/api/proxy/status`, `/api/proxy/frame`, `/api/proxy/stream-url`, `/api/captures`, label save, and capture session routes on port 8001.
- Fix: supervisor now runs backend with uvicorn on `0.0.0.0:8001` and frontend on `0.0.0.0:3000`.
- Fix: removed TensorFlow/COCO-SSD deployment blockers and replaced auto-labeling with lightweight station heuristics so preview remains stable.
- Fix: `.gitignore` no longer blocks `.env`, and backend uses `load_dotenv()` for portable env discovery.
- Validation: backend tests pass against port 8001, frontend/local tests pass, browser flow works, build passes, and deployment scan reports only non-blocking warnings.


## Uploaded Cleanup Patch Review + Merge
- Reviewed uploaded `mise-cleanup.patch` and PR description. Patch targeted the original browser-only repo, so it was not applied blindly because current project now includes a real FastAPI backend, custom livestream source switching, and lightweight detector changes.
- Safely merged compatible cleanup: accurate README, MIT LICENSE, package rename `mise` 0.1.0, removed conflicting Apache header, corrected privacy/compliance wording, removed stale TensorFlow/COCO-SSD/RTSP/YOLO claims, and regenerated `package-lock.json` to match current dependencies.
- Existing fixes from the patch were already present or superseded: KdsAdapter import path and SpatialTracker `zone.bounds` logic.
- Validation after merge: `yarn lint`, `yarn build`, Python lint, backend tests against port 8001, local frontend middleware tests, supervisor status, and browser Use Source/capture/auto-label flow all pass.
