import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import 'dotenv/config';
import fs from 'node:fs';
import path from 'path';
import {defineConfig} from 'vite';

const readServerEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required server config: ${key}`);
  }
  return value;
};

const CAMERA_SERVER_ID = readServerEnv('VITE_CAMERA_SERVER_ID');
const CAMERA_INDEX = readServerEnv('VITE_CAMERA_INDEX');
const CAMERA_LABEL = readServerEnv('VITE_CAMERA_LABEL');
const IVIDEON_API_BASE_URL = readServerEnv('VITE_IVIDEON_API_BASE_URL').replace(/\/$/, '');
const IVIDEON_EMBED_BASE_URL = readServerEnv('VITE_IVIDEON_EMBED_BASE_URL').replace(/\/$/, '');
const FALLBACK_FRAME_URL = readServerEnv('VITE_FALLBACK_FRAME_URL');
const ALLOWED_HOSTS = readServerEnv('VITE_ALLOWED_HOSTS')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

type CaptureLabel = {
  id: string;
  className: string;
  score?: number;
  stationId?: string;
  stationName?: string;
  bbox: { x: number; y: number; width: number; height: number };
};

type WebcamCapture = {
  id: string;
  cameraId: string;
  cameraLabel: string;
  capturedAt: number;
  capturedAtIso: string;
  quality: string;
  contentType: string;
  sizeBytes: number;
  imageDataUrl: string;
  frameSource?: 'live' | 'cached' | 'fallback';
  cameraOnline?: boolean;
  statusMessage?: string;
  labels: CaptureLabel[];
};

type PublicWebcamCapture = Omit<WebcamCapture, 'imageDataUrl'> & {
  imageUrl: string;
  frameSource?: 'live' | 'cached' | 'fallback';
  cameraOnline?: boolean;
};

type FrameFetchResult = {
  buffer: Buffer;
  contentType: string;
  source: 'live' | 'cached' | 'fallback';
  cameraOnline: boolean;
  statusMessage: string;
};

type CameraSource = {
  serverId: string;
  cameraIndex: string;
  cameraId: string;
  cameraLabel: string;
  iframeUrl: string;
};

type CaptureSession = {
  id: string;
  status: 'active' | 'stopped';
  intervalSeconds: number;
  quality: string;
  startedAt: number;
  startedAtIso: string;
  stoppedAt?: number;
  stoppedAtIso?: string;
  frameCount: number;
  maxFrames: number;
  camera: CameraSource;
  lastCaptureAt?: number;
  lastCaptureAtIso?: string;
};

const defaultCamera = (): CameraSource => {
  const cameraId = `${CAMERA_SERVER_ID}:${CAMERA_INDEX}`;
  return {
    serverId: CAMERA_SERVER_ID,
    cameraIndex: CAMERA_INDEX,
    cameraId,
    cameraLabel: CAMERA_LABEL,
    iframeUrl: `${IVIDEON_EMBED_BASE_URL}/embed/v3/${cameraId}/`,
  };
};

function normalizeCamera(values: Record<string, unknown>): CameraSource {
  const fallback = defaultCamera();
  const cameraIdRaw = String(values.cameraId || '').trim();
  const serverId = String(values.serverId || values.server || cameraIdRaw.split(':')[0] || fallback.serverId).trim();
  const cameraIndex = String(values.cameraIndex || values.camera || cameraIdRaw.split(':')[1] || fallback.cameraIndex).trim();
  const cameraId = `${serverId}:${cameraIndex}`;
  const cameraLabel = String(values.cameraLabel || values.label || (cameraId === fallback.cameraId ? fallback.cameraLabel : `Ivideon ${cameraId}`));
  const iframeUrl = String(values.iframeUrl || `${IVIDEON_EMBED_BASE_URL}/embed/v3/${cameraId}/`);
  return { serverId, cameraIndex, cameraId, cameraLabel, iframeUrl };
}

function cameraFromSearch(params: URLSearchParams): CameraSource {
  return normalizeCamera(Object.fromEntries(params.entries()));
}

const STORE_PATH = readServerEnv('MISE_CAPTURE_STORE_PATH');

function loadCaptureStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return [] as WebcamCapture[];
    const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) as { captures?: WebcamCapture[] };
    return Array.isArray(data.captures) ? data.captures : [];
  } catch (error) {
    console.warn('[mise] capture store could not be read', error);
    return [] as WebcamCapture[];
  }
}

function persistCaptureStore() {
  fs.writeFileSync(STORE_PATH, JSON.stringify({ captures }, null, 2));
}

function toPublicCapture(capture: WebcamCapture): PublicWebcamCapture {
  const { imageDataUrl, ...metadata } = capture;
  return {
    ...metadata,
    imageUrl: `/api/captures/${capture.id}/image`,
    frameSource: capture.frameSource,
    cameraOnline: capture.cameraOnline,
  };
}

function decodeDataUrl(dataUrl: string) {
  const [header = '', base64Payload = ''] = dataUrl.split(',');
  const contentType = header.match(/^data:(.*?);base64$/)?.[1] || 'image/jpeg';
  return { buffer: Buffer.from(base64Payload, 'base64'), contentType };
}

async function fetchFallbackFrame(reason: string, camera: CameraSource): Promise<FrameFetchResult> {
  const cachedCapture = captures.find((capture) => capture.cameraId === camera.cameraId && capture.imageDataUrl)
    || captures.find((capture) => capture.imageDataUrl);
  if (cachedCapture) {
    const decoded = decodeDataUrl(cachedCapture.imageDataUrl);
    return {
      ...decoded,
      source: 'cached',
      cameraOnline: false,
      statusMessage: `Live camera unavailable; using last captured frame. ${reason}`,
    };
  }

  const fallbackResponse = await fetch(FALLBACK_FRAME_URL, {
    headers: { 'user-agent': 'Mozilla/5.0 MISE camera fallback' },
  });
  if (!fallbackResponse.ok) {
    throw new Error(`Camera offline and fallback frame failed with ${fallbackResponse.status}. ${reason}`);
  }
  const contentType = fallbackResponse.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await fallbackResponse.arrayBuffer());
  return {
    buffer,
    contentType,
    source: 'fallback',
    cameraOnline: false,
    statusMessage: `Live camera unavailable; using fallback reference frame. ${reason}`,
  };
}

const captures: WebcamCapture[] = loadCaptureStore();
let activeCamera: CameraSource = defaultCamera();
let activeSession: CaptureSession | null = null;
let sessionTimer: NodeJS.Timeout | null = null;
let captureInFlight = false;

const buildPreviewUrl = (camera: CameraSource, quality: string) =>
  `${IVIDEON_API_BASE_URL}/cameras/${camera.cameraId}/live_preview?op=GET&access_token=public&q=${encodeURIComponent(quality)}`;

const buildStreamUrl = (camera: CameraSource, quality: string) =>
  `${IVIDEON_API_BASE_URL}/cameras/${camera.cameraId}/live_stream?op=GET&access_token=public&q=${encodeURIComponent(quality)}&format=hls`;

async function readJsonBody(req: import('http').IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString('utf8').trim();
  if (!body) return {};
  return JSON.parse(body);
}

function sendJson(res: import('http').ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

function sendError(res: import('http').ServerResponse, statusCode: number, message: string) {
  sendJson(res, statusCode, { error: message });
}

async function fetchFrameBuffer(quality = '1', camera = defaultCamera()): Promise<FrameFetchResult> {
  const response = await fetch(buildPreviewUrl(camera, quality), {
    headers: { 'user-agent': 'Mozilla/5.0 MISE camera proxy' },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return fetchFallbackFrame(`Ivideon returned ${response.status}${body ? `: ${body}` : ''}`, camera);
  }
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    contentType,
    source: 'live',
    cameraOnline: true,
    statusMessage: 'Live camera frame captured.',
  };
}

async function captureLatestFrame(quality = '1', camera = defaultCamera()) {
  const { buffer, contentType, source, cameraOnline, statusMessage } = await fetchFrameBuffer(quality, camera);
  const capturedAt = Date.now();
  const capture: WebcamCapture = {
    id: `cap_${capturedAt}_${Math.random().toString(36).slice(2, 8)}`,
    cameraId: camera.cameraId,
    cameraLabel: camera.cameraLabel,
    capturedAt,
    capturedAtIso: new Date(capturedAt).toISOString(),
    quality,
    contentType,
    sizeBytes: buffer.byteLength,
    imageDataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
    frameSource: source,
    cameraOnline,
    statusMessage,
    labels: [],
  } as WebcamCapture;

  captures.unshift(capture);
  captures.splice(20);
  persistCaptureStore();

  if (activeSession?.status === 'active') {
    activeSession.frameCount += 1;
    activeSession.lastCaptureAt = capturedAt;
    activeSession.lastCaptureAtIso = capture.capturedAtIso;
  }

  return capture;
}

function stopCaptureSession() {
  if (sessionTimer) {
    clearInterval(sessionTimer);
    sessionTimer = null;
  }

  if (activeSession?.status === 'active') {
    const stoppedAt = Date.now();
    activeSession = {
      ...activeSession,
      status: 'stopped',
      stoppedAt,
      stoppedAtIso: new Date(stoppedAt).toISOString(),
    };
  }
}

async function safeSessionCapture() {
  if (!activeSession || activeSession.status !== 'active' || captureInFlight) return;
  if (activeSession.frameCount >= activeSession.maxFrames) {
    stopCaptureSession();
    return;
  }

  captureInFlight = true;
  try {
    await captureLatestFrame(activeSession.quality, activeSession.camera);
  } catch (error) {
    console.error('[mise] session capture failed', error);
  } finally {
    captureInFlight = false;
  }
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'mise-webcam-api',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (!req.url?.startsWith('/api/')) {
              next();
              return;
            }

            const requestUrl = new URL(req.url, 'http://localhost');
            const quality = requestUrl.searchParams.get('q') || '1';
            const hasCameraParams = requestUrl.searchParams.has('serverId') || requestUrl.searchParams.has('server') || requestUrl.searchParams.has('cameraId');
            const requestCamera = hasCameraParams ? cameraFromSearch(requestUrl.searchParams) : activeCamera;

            try {
              if (req.method === 'GET' && requestUrl.pathname === '/api/camera-source') {
                sendJson(res, 200, { camera: activeCamera });
                return;
              }

              if (req.method === 'POST' && requestUrl.pathname === '/api/camera-source') {
                const body = await readJsonBody(req) as Record<string, unknown>;
                activeCamera = normalizeCamera(body);
                stopCaptureSession();
                const health = await fetchFrameBuffer('1', activeCamera);
                sendJson(res, 200, {
                  camera: activeCamera,
                  health: {
                    online: health.cameraOnline,
                    source: health.source,
                    statusMessage: health.statusMessage,
                  },
                });
                return;
              }

              if (req.method === 'POST' && requestUrl.pathname === '/api/camera-source/reset') {
                activeCamera = defaultCamera();
                stopCaptureSession();
                const health = await fetchFrameBuffer('1', activeCamera);
                sendJson(res, 200, {
                  camera: activeCamera,
                  health: {
                    online: health.cameraOnline,
                    source: health.source,
                    statusMessage: health.statusMessage,
                  },
                });
                return;
              }

              if (req.method === 'GET' && requestUrl.pathname === '/api/proxy/frame') {
                const { buffer, contentType, source, cameraOnline, statusMessage } = await fetchFrameBuffer(quality, requestCamera);
                const capturedAt = Date.now();
                res.statusCode = 200;
                res.setHeader('content-type', contentType);
                res.setHeader('cache-control', 'no-store');
                res.setHeader('access-control-allow-origin', '*');
                res.setHeader('x-captured-at', String(capturedAt));
                res.setHeader('x-camera-id', requestCamera.cameraId);
                res.setHeader('x-frame-source', source);
                res.setHeader('x-camera-online', String(cameraOnline));
                res.setHeader('x-camera-status', statusMessage);
                res.end(buffer);
                return;
              }

              if (req.method === 'GET' && requestUrl.pathname === '/api/proxy/status') {
                const frame = await fetchFrameBuffer(quality, requestCamera);
                sendJson(res, 200, {
                  cameraId: requestCamera.cameraId,
                  cameraLabel: requestCamera.cameraLabel,
                  online: frame.cameraOnline,
                  source: frame.source,
                  iframeUrl: requestCamera.iframeUrl,
                  statusMessage: frame.statusMessage,
                  checkedAt: Date.now(),
                });
                return;
              }

              if (req.method === 'GET' && requestUrl.pathname === '/api/proxy/stream-url') {
                const streamResponse = await fetch(buildStreamUrl(requestCamera, quality), { redirect: 'follow' });
                const manifest = await streamResponse.text().catch(() => '');
                sendJson(res, 200, {
                  url: streamResponse.ok ? streamResponse.url : requestCamera.iframeUrl,
                  manifestPreview: manifest.slice(0, 1000),
                  capturedAt: Date.now(),
                  quality,
                  iframeUrl: requestCamera.iframeUrl,
                  expiresApprox: '55 minutes',
                  online: streamResponse.ok,
                  statusMessage: streamResponse.ok ? 'Signed HLS URL resolved.' : `Signed HLS unavailable (${streamResponse.status}); iframe/fallback capture still available.`,
                });
                return;
              }

              if (req.method === 'GET' && requestUrl.pathname === '/api/proxy/stream') {
                const streamResponse = await fetch(buildStreamUrl(requestCamera, quality), { redirect: 'follow' });
                const manifest = await streamResponse.text();
                res.statusCode = streamResponse.status;
                res.setHeader('content-type', streamResponse.headers.get('content-type') || 'application/vnd.apple.mpegurl');
                res.setHeader('cache-control', 'no-store');
                res.setHeader('access-control-allow-origin', '*');
                res.end(manifest);
                return;
              }

              if (req.method === 'GET' && requestUrl.pathname === '/api/captures') {
                sendJson(res, 200, { captures: captures.map(toPublicCapture), total: captures.length });
                return;
              }

              if (req.method === 'GET' && requestUrl.pathname.startsWith('/api/captures/') && requestUrl.pathname.endsWith('/image')) {
                const captureId = requestUrl.pathname.split('/')[3];
                const capture = captures.find((item) => item.id === captureId);
                if (!capture) {
                  sendError(res, 404, 'Capture not found');
                  return;
                }
                const [, base64Payload = ''] = capture.imageDataUrl.split(',');
                const buffer = Buffer.from(base64Payload, 'base64');
                res.statusCode = 200;
                res.setHeader('content-type', capture.contentType || 'image/jpeg');
                res.setHeader('cache-control', 'public, max-age=300');
                res.end(buffer);
                return;
              }

              if (req.method === 'POST' && requestUrl.pathname === '/api/captures') {
                const body = await readJsonBody(req);
                const bodyRecord = body as Record<string, unknown>;
                const captureCamera = bodyRecord.serverId || bodyRecord.server || bodyRecord.cameraId ? normalizeCamera(bodyRecord) : activeCamera;
                const capture = await captureLatestFrame(String(bodyRecord.q || bodyRecord.quality || quality), captureCamera);
                sendJson(res, 201, { capture: toPublicCapture(capture) });
                return;
              }

              if (req.method === 'PATCH' && requestUrl.pathname.startsWith('/api/captures/') && requestUrl.pathname.endsWith('/labels')) {
                const captureId = requestUrl.pathname.split('/')[3];
                const body = await readJsonBody(req);
                const capture = captures.find((item) => item.id === captureId);
                if (!capture) {
                  sendError(res, 404, 'Capture not found');
                  return;
                }
                capture.labels = Array.isArray(body.labels) ? body.labels : [];
                persistCaptureStore();
                sendJson(res, 200, { capture: toPublicCapture(capture) });
                return;
              }

              if (req.method === 'GET' && requestUrl.pathname === '/api/capture-sessions/active') {
                sendJson(res, 200, { session: activeSession });
                return;
              }

              if (req.method === 'POST' && requestUrl.pathname === '/api/capture-sessions/start') {
                const body = await readJsonBody(req);
                const intervalSeconds = Math.min(60, Math.max(2, Number(body.intervalSeconds || 10)));
                const sessionQuality = String(body.q || body.quality || '1');

                stopCaptureSession();
                const startedAt = Date.now();
                activeSession = {
                  id: `session_${startedAt}`,
                  status: 'active',
                  intervalSeconds,
                  quality: sessionQuality,
                  startedAt,
                  startedAtIso: new Date(startedAt).toISOString(),
                  frameCount: 0,
                  maxFrames: 500,
                  camera: normalizeCamera(body as Record<string, unknown>),
                };

                await safeSessionCapture();
                sessionTimer = setInterval(safeSessionCapture, intervalSeconds * 1000);
                sendJson(res, 201, { session: activeSession });
                return;
              }

              if (req.method === 'POST' && requestUrl.pathname === '/api/capture-sessions/stop') {
                stopCaptureSession();
                sendJson(res, 200, { session: activeSession });
                return;
              }

              sendError(res, 404, 'Unknown MISE API route');
            } catch (error) {
              console.error('[mise] api error', error);
              sendError(res, 500, error instanceof Error ? error.message : 'Unexpected API error');
            }
          });
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      allowedHosts: ALLOWED_HOSTS,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: [
          STORE_PATH,
          '**/.mise-capture-store.json',
          '**/memory/**',
          '**/test_reports/**',
          '**/tests/**',
          '**/dist/**',
        ],
      },
    },
  };
});
