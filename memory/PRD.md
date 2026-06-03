# MISE PRD

## Original Problem Statement
Build and fix a real-time webcam pipeline for the MISE kitchen operations dashboard using the public Dodo Pizza Guzovsky Ivideon stream. Include proxy access, timestamped frame capture, capture sessions, schema/storage equivalent, COCO-SSD detection, labeling UI, overlays, and dashboard integration.

## Architecture Decisions
- Existing repository is a Vite React app, not Convex, so the pipeline is implemented with Vite dev middleware API routes.
- Public Ivideon camera JPEG frames are proxied through `/api/proxy/frame` to avoid browser CORS issues.
- HLS iframe remains embedded directly; the UI camera health badge now checks the reliable JPEG proxy instead of a slow signed HLS probe.
- Captures are stored in `/tmp/mise-capture-store.json` to avoid Vite reload loops from writes inside the project tree.
- Runtime URLs, camera settings, fallback video, and allowed hosts are environment-driven via `.env`.

## Implemented
- Live Ivideon iframe viewer and camera health badge.
- Server-side JPEG proxy and stream-url resolver.
- Timestamped capture creation, label persistence, and continuous capture sessions.
- Labeling studio with capture gallery, manual station labels, COCO-SSD auto detection, and reliable station overlays.
- Dashboard occupancy integration and high-contrast Swiss-style UI.
- Fixed preview host blocking bug for `webcam-studio-2.cluster-7.preview.emergentcf.cloud`.
- Fixed HLS PROBE FAILED confusion by replacing it with CAMERA READY based on the working frame proxy.
- Fixed overlay/labeling failures by using same-origin API routing and stable image dimensions.

## Validation
- `yarn lint` passes.
- `yarn build` passes.
- `pytest /app/tests/test_mise_api.py` passes: 4/4.
- Browser test confirms CAMERA READY, capture image visible, manual label row visible, and overlay visible.
- Direct Host header check confirms no “Blocked request” for the reported preview host.

## Prioritized Backlog
### P0
- Keep preview host list updated through `VITE_ALLOWED_HOSTS` for future preview domains.

### P1
- Add persistent production backend/storage if captures need to survive beyond local file storage.
- Add editable bounding-box drawing instead of zone-button labels only.

### P2
- Code-split TensorFlow model loading to reduce bundle size.
- Add station-specific analytics history charts.
