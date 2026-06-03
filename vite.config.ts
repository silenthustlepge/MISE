import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'path';
import {defineConfig} from 'vite';

const CAMERA_SERVER_ID = '100-gRWCic9ftqMOx35Ocj6zdp';
const CAMERA_INDEX = '0';
const CAMERA_ID = `${CAMERA_SERVER_ID}:${CAMERA_INDEX}`;
const CAMERA_LABEL = 'Dodo Pizza Guzovsky Kitchen';

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
  labels: CaptureLabel[];
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
  lastCaptureAt?: number;
  lastCaptureAtIso?: string;
};

const STORE_PATH = path.resolve(__dirname, '.mise-capture-store.json');

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

const captures: WebcamCapture[] = loadCaptureStore();
let activeSession: CaptureSession | null = null;
let sessionTimer: NodeJS.Timeout | null = null;
let captureInFlight = false;

const buildPreviewUrl = (quality: string) =>
  `https://openapi-alpha.ivideon.com/cameras/${CAMERA_ID}/live_preview?op=GET&access_token=public&q=${encodeURIComponent(quality)}`;

const buildStreamUrl = (quality: string) =>
  `https://openapi-alpha.ivideon.com/cameras/${CAMERA_ID}/live_stream?op=GET&access_token=public&q=${encodeURIComponent(quality)}&format=hls`;

const liveIframeUrl =
  `https://open.ivideon.com/embed/v3/?server=${CAMERA_SERVER_ID}&camera=${CAMERA_INDEX}&width=&height=&lang=ru`;

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

async function fetchFrameBuffer(quality = '1') {
  const response = await fetch(buildPreviewUrl(quality));
  if (!response.ok) {
    throw new Error(`Ivideon frame fetch failed with ${response.status}`);
  }
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType };
}

async function captureLatestFrame(quality = '1') {
  const { buffer, contentType } = await fetchFrameBuffer(quality);
  const capturedAt = Date.now();
  const capture: WebcamCapture = {
    id: `cap_${capturedAt}_${Math.random().toString(36).slice(2, 8)}`,
    cameraId: CAMERA_ID,
    cameraLabel: CAMERA_LABEL,
    capturedAt,
    capturedAtIso: new Date(capturedAt).toISOString(),
    quality,
    contentType,
    sizeBytes: buffer.byteLength,
    imageDataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
    labels: [],
  };

  captures.unshift(capture);
  captures.splice(60);
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
    await captureLatestFrame(activeSession.quality);
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

            try {
              if (req.method === 'GET' && requestUrl.pathname === '/api/proxy/frame') {
                const { buffer, contentType } = await fetchFrameBuffer(quality);
                const capturedAt = Date.now();
                res.statusCode = 200;
                res.setHeader('content-type', contentType);
                res.setHeader('cache-control', 'no-store');
                res.setHeader('access-control-allow-origin', '*');
                res.setHeader('x-captured-at', String(capturedAt));
                res.setHeader('x-camera-id', CAMERA_ID);
                res.end(buffer);
                return;
              }

              if (req.method === 'GET' && requestUrl.pathname === '/api/proxy/stream-url') {
                const streamResponse = await fetch(buildStreamUrl(quality), { redirect: 'follow' });
                const manifest = await streamResponse.text();
                sendJson(res, 200, {
                  url: streamResponse.url,
                  manifestPreview: manifest.slice(0, 1000),
                  capturedAt: Date.now(),
                  quality,
                  iframeUrl: liveIframeUrl,
                  expiresApprox: '55 minutes',
                });
                return;
              }

              if (req.method === 'GET' && requestUrl.pathname === '/api/proxy/stream') {
                const streamResponse = await fetch(buildStreamUrl(quality), { redirect: 'follow' });
                const manifest = await streamResponse.text();
                res.statusCode = streamResponse.status;
                res.setHeader('content-type', streamResponse.headers.get('content-type') || 'application/vnd.apple.mpegurl');
                res.setHeader('cache-control', 'no-store');
                res.setHeader('access-control-allow-origin', '*');
                res.end(manifest);
                return;
              }

              if (req.method === 'GET' && requestUrl.pathname === '/api/captures') {
                sendJson(res, 200, { captures, total: captures.length });
                return;
              }

              if (req.method === 'POST' && requestUrl.pathname === '/api/captures') {
                const body = await readJsonBody(req);
                const capture = await captureLatestFrame(String(body.q || body.quality || quality));
                sendJson(res, 201, { capture });
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
                sendJson(res, 200, { capture });
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
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
