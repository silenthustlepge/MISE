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
