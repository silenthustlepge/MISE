import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { edgeVision } from '../services/VisionService';
import { StationZone, BoundingBox } from '../core/types';
import { cn } from '../lib/utils';
import { apiUrl, runtimeConfig } from '../lib/runtimeConfig';
import {
  AlertCircle,
  Bot,
  Camera,
  CheckCircle2,
  Clock3,
  Crosshair,
  Database,
  Loader2,
  Play,
  Save,
  Square,
  Video,
} from 'lucide-react';

type CaptureLabel = {
  id: string;
  className: string;
  score?: number;
  stationId?: string;
  stationName?: string;
  bbox: BoundingBox;
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
  imageDataUrl?: string;
  imageUrl?: string;
  frameSource?: 'live' | 'cached' | 'fallback';
  cameraOnline?: boolean;
  statusMessage?: string;
  labels: CaptureLabel[];
};

type CameraStatus = {
  cameraId: string;
  cameraLabel: string;
  online: boolean;
  source: 'live' | 'cached' | 'fallback';
  iframeUrl?: string;
  statusMessage: string;
};

type CameraSourceResponse = {
  camera: CameraSource;
  health?: {
    online: boolean;
    source: 'live' | 'cached' | 'fallback';
    statusMessage: string;
  };
};

type CameraSource = {
  cameraId: string;
  serverId: string;
  cameraIndex: string;
  cameraLabel: string;
  iframeUrl: string;
};

type CaptureSession = {
  id: string;
  status: 'active' | 'stopped';
  intervalSeconds: number;
  quality: string;
  startedAtIso: string;
  stoppedAtIso?: string;
  frameCount: number;
  maxFrames: number;
  lastCaptureAtIso?: string;
};

type ApiCapturesResponse = {
  captures: WebcamCapture[];
  total: number;
};

type WebcamLabelingStudioProps = {
  zones: StationZone[];
  onOccupancyChange: (state: Map<string, boolean>) => void;
};

const LOCAL_CAPTURE_STORE_KEY = 'mise-webcam-captures-v1';

const loadLocalCaptures = () => {
  try {
    const raw = window.localStorage.getItem(LOCAL_CAPTURE_STORE_KEY);
    if (!raw) return [] as WebcamCapture[];
    const parsed = JSON.parse(raw) as { captures?: WebcamCapture[] };
    return Array.isArray(parsed.captures) ? parsed.captures : [];
  } catch {
    return [] as WebcamCapture[];
  }
};

const persistLocalCaptures = (captures: WebcamCapture[]) => {
  try {
    window.localStorage.setItem(LOCAL_CAPTURE_STORE_KEY, JSON.stringify({ captures: captures.slice(0, 8) }));
  } catch {
    // Local storage can be full or disabled; the live UI should continue working.
  }
};

const formatTime = (iso?: string) => {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-CA', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(iso));
};

const classifyZone = (bbox: BoundingBox, zones: StationZone[], imageWidth: number, imageHeight: number) => {
  const centerX = (bbox.x + bbox.width / 2) / Math.max(imageWidth, 1);
  const centerY = (bbox.y + bbox.height / 2) / Math.max(imageHeight, 1);

  return zones.find((zone) => {
    const { x, y, width, height } = zone.bounds;
    return centerX >= x && centerX <= x + width && centerY >= y && centerY <= y + height;
  });
};

const fileToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const fetchWithTimeout = (url: string, options: RequestInit = {}, timeoutMs = 12000) => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => window.clearTimeout(timer));
};

const captureImageSrc = (capture: WebcamCapture) => capture.imageDataUrl || (capture.imageUrl ? apiUrl(capture.imageUrl) : '');

const defaultCameraSource: CameraSource = {
  cameraId: '100-gRWCic9ftqMOx35Ocj6zdp:0',
  serverId: '100-gRWCic9ftqMOx35Ocj6zdp',
  cameraIndex: '0',
  cameraLabel: 'Dodo Pizza Guzovsky Kitchen',
  iframeUrl: runtimeConfig.liveIframeUrl,
};

const cameraQuery = (camera: CameraSource) =>
  `serverId=${encodeURIComponent(camera.serverId)}&cameraIndex=${encodeURIComponent(camera.cameraIndex)}&cameraLabel=${encodeURIComponent(camera.cameraLabel)}&iframeUrl=${encodeURIComponent(camera.iframeUrl)}`;

const parseIvideonSource = (value: string): CameraSource | null => {
  const trimmed = value.trim();
  const srcMatch = trimmed.match(/src=["']([^"']+)["']/i);
  const candidate = srcMatch?.[1] || trimmed;
  const cameraMatch = candidate.match(/(?:server=([^&]+).*camera=([^&]+))|embed\/v3\/(100-[^/:?]+):(\d+)/i);
  if (!cameraMatch) return null;
  const serverId = decodeURIComponent(cameraMatch[1] || cameraMatch[3]);
  const cameraIndex = decodeURIComponent(cameraMatch[2] || cameraMatch[4] || '0');
  const cameraId = `${serverId}:${cameraIndex}`;
  const iframeUrl = candidate.startsWith('http')
    ? candidate
    : `https://open.ivideon.com/embed/v3/${cameraId}/`;
  return {
    cameraId,
    serverId,
    cameraIndex,
    cameraLabel: `Ivideon ${cameraId}`,
    iframeUrl,
  };
};

export function WebcamLabelingStudio({ zones, onOccupancyChange }: WebcamLabelingStudioProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const capturesRef = useRef<WebcamCapture[]>([]);
  const labelDraftsRef = useRef<Map<string, CaptureLabel[]>>(new Map());
  const activeCaptureIdRef = useRef<string | null>(null);
  const skipNextCameraProbeRef = useRef(false);
  const [captures, setCaptures] = useState<WebcamCapture[]>([]);
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [intervalSeconds, setIntervalSeconds] = useState(8);
  const [quality, setQuality] = useState('1');
  const [isCapturing, setIsCapturing] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isApplyingSource, setIsApplyingSource] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 1, height: 1 });
  const [statusMessage, setStatusMessage] = useState('Connecting to public camera proxy…');
  const [streamStatus, setStreamStatus] = useState<'checking' | 'ready' | 'cached' | 'error'>('checking');
  const [cameraStatusMessage, setCameraStatusMessage] = useState('Checking camera health…');
  const [cameraPreviewSrc, setCameraPreviewSrc] = useState('');
  const [cameraSource, setCameraSource] = useState<CameraSource>(defaultCameraSource);
  const [livestreamInput, setLivestreamInput] = useState('');

  const selectedCapture = useMemo(
    () => captures.find((capture) => capture.id === selectedCaptureId) || captures[0],
    [captures, selectedCaptureId]
  );

  useEffect(() => {
    activeCaptureIdRef.current = selectedCapture?.id || null;
  }, [selectedCapture?.id]);

  useEffect(() => {
    capturesRef.current = captures;
    persistLocalCaptures(captures);
  }, [captures]);

  const occupancy = useMemo(() => {
    const map = new Map<string, boolean>();
    zones.forEach((zone) => map.set(zone.id, false));
    selectedCapture?.labels.forEach((label) => {
      if (label.stationId) map.set(label.stationId, true);
    });
    return map;
  }, [selectedCapture, zones]);

  useEffect(() => {
    onOccupancyChange(occupancy);
  }, [occupancy, onOccupancyChange]);

  const refreshCaptures = useCallback(async () => {
    const response = await fetch(apiUrl('/api/captures'));
    if (!response.ok) throw new Error('Could not load captures');
    const data = (await response.json()) as ApiCapturesResponse;
    setCaptures((current) => {
      const localById = new Map<string, WebcamCapture>(current.map((capture) => [capture.id, capture]));
      const mergedRemote = data.captures.map((remoteCapture) => {
        const localCapture = localById.get(remoteCapture.id);
        if (localCapture && localCapture.labels.length > remoteCapture.labels.length) {
          return { ...remoteCapture, labels: localCapture.labels };
        }
        return remoteCapture;
      });
      const localOnly = current.filter((capture) => !data.captures.some((remoteCapture) => remoteCapture.id === capture.id));
      return [...localOnly, ...mergedRemote];
    });
    setSelectedCaptureId((current) => {
      const next = current || data.captures[0]?.id || null;
      activeCaptureIdRef.current = next;
      return next;
    });
  }, []);

  const refreshSession = useCallback(async () => {
    const response = await fetch(apiUrl('/api/capture-sessions/active'));
    if (!response.ok) throw new Error('Could not load session');
    const data = await response.json();
    setSession(data.session);
  }, []);

  const refreshCameraSource = useCallback(async () => {
    const response = await fetch(apiUrl('/api/camera-source'));
    if (!response.ok) throw new Error('Could not load camera source');
    const data = (await response.json()) as CameraSourceResponse;
    setCameraSource(data.camera);
  }, []);

  useEffect(() => {
    const localCaptures = loadLocalCaptures();
    if (localCaptures.length) {
      setCaptures(localCaptures);
      setSelectedCaptureId(localCaptures[0].id);
      localCaptures.forEach((capture) => labelDraftsRef.current.set(capture.id, capture.labels));
    }
    refreshCameraSource().catch(() => undefined);
    refreshCaptures().catch(() => setStatusMessage('Capture API is warming up.'));
    refreshSession().catch(() => undefined);
  }, [refreshCameraSource, refreshCaptures, refreshSession]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!isCapturing && !isSaving && !isDetecting) {
        refreshCaptures().catch(() => undefined);
      }
      refreshSession().catch(() => undefined);
    }, 12000);
    return () => clearInterval(timer);
  }, [isCapturing, isDetecting, isSaving, refreshCaptures, refreshSession]);

  useEffect(() => {
    let mounted = true;

    const probeCamera = async () => {
      if (skipNextCameraProbeRef.current) {
        skipNextCameraProbeRef.current = false;
        return;
      }
      setStreamStatus('checking');

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const statusResponse = await fetchWithTimeout(apiUrl(`/api/proxy/status?q=1&${cameraQuery(cameraSource)}`), { cache: 'no-store' }, 6000);
          if (statusResponse.ok) {
            const status = (await statusResponse.json()) as CameraStatus;
            setCameraStatusMessage(status.statusMessage);
            setCameraPreviewSrc(apiUrl(`/api/proxy/frame?q=1&t=${Date.now()}&${cameraQuery(cameraSource)}`));
            if (mounted) setStreamStatus(status.online ? 'ready' : 'cached');
            return;
          }

          const response = await fetchWithTimeout(apiUrl(`/api/proxy/frame?q=1&${cameraQuery(cameraSource)}`), { cache: 'no-store' }, 6000);
          if (!response.ok) throw new Error('frame probe failed');
          await response.blob();
          const cameraOnline = response.headers.get('x-camera-online') !== 'false';
          setCameraStatusMessage(response.headers.get('x-camera-status') || 'Camera frame available.');
          setCameraPreviewSrc(apiUrl(`/api/proxy/frame?q=1&t=${Date.now()}&${cameraQuery(cameraSource)}`));
          if (mounted) setStreamStatus(cameraOnline ? 'ready' : 'cached');
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 900));
        }
      }

      try {
        let fallbackResponse = await fetchWithTimeout(runtimeConfig.directFrameUrl, { cache: 'no-store' }, 6000);
        if (!fallbackResponse.ok) {
          fallbackResponse = await fetchWithTimeout(runtimeConfig.fallbackFrameUrl, { cache: 'no-store' }, 6000);
        }
        if (!fallbackResponse.ok) throw new Error('direct frame probe failed');
        await fallbackResponse.blob();
        const isFallback = fallbackResponse.url === runtimeConfig.fallbackFrameUrl;
        setCameraStatusMessage(isFallback ? 'Live camera unavailable; fallback reference frame is available.' : 'Direct camera frame available.');
        setCameraPreviewSrc(isFallback ? runtimeConfig.fallbackFrameUrl : runtimeConfig.directFrameUrl);
        if (mounted) setStreamStatus(isFallback ? 'cached' : 'ready');
      } catch {
        setCameraStatusMessage('Camera is unavailable right now. Capture will use cached/reference frames if available.');
        setCameraPreviewSrc(runtimeConfig.fallbackFrameUrl);
        if (mounted) setStreamStatus('error');
      }
    };

    probeCamera();
    return () => {
      mounted = false;
    };
  }, [cameraSource]);

  const captureNow = async () => {
    setIsCapturing(true);
    setStatusMessage('Capturing timestamped JPEG on the server…');
    try {
      const response = await fetchWithTimeout(apiUrl('/api/captures'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quality, ...cameraSource }),
      });
      if (!response.ok) throw new Error('capture failed');
      const data = await response.json();
      labelDraftsRef.current.set(data.capture.id, data.capture.labels || []);
      activeCaptureIdRef.current = data.capture.id;
      setCaptures((current) => [data.capture, ...current.filter((item) => item.id !== data.capture.id)]);
      setSelectedCaptureId(data.capture.id);
      setImageDimensions({ width: 1, height: 1 });
      setCameraPreviewSrc(data.capture.imageUrl ? apiUrl(data.capture.imageUrl) : cameraPreviewSrc);
      setStatusMessage(`${data.capture.cameraOnline === false ? 'Cached/reference frame captured' : 'Live frame captured'} (${Math.round(data.capture.sizeBytes / 1024)}KB) at ${formatTime(data.capture.capturedAtIso)}.`);
    } catch (error) {
      try {
        let fallbackResponse = await fetchWithTimeout(runtimeConfig.directFrameUrl, { cache: 'no-store' }, 12000);
        if (!fallbackResponse.ok) {
          fallbackResponse = await fetchWithTimeout(runtimeConfig.fallbackFrameUrl, { cache: 'no-store' }, 12000);
        }
        if (!fallbackResponse.ok) throw new Error('direct camera capture failed');
        const blob = await fallbackResponse.blob();
        const capturedAt = Date.now();
        const capture: WebcamCapture = {
          id: `browser_${capturedAt}_${Math.random().toString(36).slice(2, 8)}`,
          cameraId: cameraSource.cameraId,
          cameraLabel: cameraSource.cameraLabel,
          capturedAt,
          capturedAtIso: new Date(capturedAt).toISOString(),
          quality,
          contentType: blob.type || 'image/jpeg',
          sizeBytes: blob.size,
          imageDataUrl: await fileToDataUrl(blob),
          frameSource: fallbackResponse.url === runtimeConfig.fallbackFrameUrl ? 'fallback' : 'live',
          cameraOnline: fallbackResponse.url !== runtimeConfig.fallbackFrameUrl,
          statusMessage: fallbackResponse.url === runtimeConfig.fallbackFrameUrl ? 'Live camera unavailable; using fallback reference frame.' : 'Direct camera frame captured.',
          labels: [],
        };
        labelDraftsRef.current.set(capture.id, []);
        activeCaptureIdRef.current = capture.id;
        setCaptures((current) => [capture, ...current.filter((item) => item.id !== capture.id)]);
        setSelectedCaptureId(capture.id);
        setImageDimensions({ width: 1, height: 1 });
        setStatusMessage(`${capture.cameraOnline ? 'Captured directly from camera' : 'Captured fallback reference frame'} at ${formatTime(capture.capturedAtIso)}.`);
      } catch (fallbackError) {
        setStatusMessage(fallbackError instanceof Error ? fallbackError.message : 'Capture failed.');
      }
    } finally {
      setIsCapturing(false);
    }
  };

  const runAutoDetect = async () => {
    if (!selectedCapture || !imageRef.current) return;
    setIsDetecting(true);
    setStatusMessage(modelReady ? 'Running local COCO-SSD detection on captured frame…' : 'Loading COCO-SSD model, then detecting…');
    try {
      if (!modelReady) {
        await edgeVision.initialize();
        setModelReady(true);
      }
      const image = imageRef.current;
      if (!image.complete) await image.decode();
      const detections = await edgeVision.processFrame(image);
      const labels = detections
        .filter((detection) => detection.class === 'person' || (detection.score || 0) > 0.45)
        .slice(0, 12)
        .map((detection, index) => {
          const station = classifyZone(detection, zones, image.naturalWidth, image.naturalHeight);
          return {
            id: `label_${Date.now()}_${index}`,
            className: detection.class || 'object',
            score: detection.score,
            stationId: station?.id,
            stationName: station?.name,
            bbox: detection,
          } satisfies CaptureLabel;
        });

      setCaptures((current) =>
        current.map((capture) => (capture.id === selectedCapture.id ? { ...capture, labels } : capture))
      );
      setStatusMessage(labels.length ? `Detected ${labels.length} objects and mapped stations.` : 'No confident objects detected.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Auto-detect failed.');
    } finally {
      setIsDetecting(false);
    }
  };

  const saveLabels = async () => {
    if (!selectedCapture) return;
    setIsSaving(true);
    const targetCaptureId = activeCaptureIdRef.current || selectedCapture.id;
    const captureToSave = capturesRef.current.find((capture) => capture.id === targetCaptureId) || selectedCapture;
    const labelsToSave = labelDraftsRef.current.get(captureToSave.id) || captureToSave.labels;
    setStatusMessage('Saving labels to the local capture schema…');
    setCaptures((current) => {
      const next = current.map((capture) => (capture.id === captureToSave.id ? { ...capture, labels: labelsToSave } : capture));
      persistLocalCaptures(next);
      return next;
    });
    try {
      const response = await fetchWithTimeout(apiUrl(`/api/captures/${captureToSave.id}/labels`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ labels: labelsToSave }),
      }, 8000);
      if (response.ok) {
        const data = await response.json();
        setCaptures((current) => current.map((capture) => (capture.id === data.capture.id ? { ...data.capture, labels: labelsToSave } : capture)));
      }
      setStatusMessage('Labels saved locally. Station occupancy is feeding the fusion dashboard.');
    } catch (error) {
      setStatusMessage('Labels saved locally. Station occupancy is feeding the fusion dashboard.');
    } finally {
      setIsSaving(false);
    }
  };

  const startSession = async () => {
    setStatusMessage('Starting continuous server-side capture session…');
    const response = await fetch(apiUrl('/api/capture-sessions/start'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intervalSeconds, quality, ...cameraSource }),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatusMessage(data.error || 'Could not start session.');
      return;
    }
    setSession(data.session);
    await refreshCaptures();
    setStatusMessage(`Capture session active every ${intervalSeconds}s.`);
  };

  const stopSession = async () => {
    const response = await fetch(apiUrl('/api/capture-sessions/stop'), { method: 'POST' });
    const data = await response.json();
    setSession(data.session);
    setStatusMessage('Capture session stopped.');
  };

  const applyLivestreamSource = () => {
    const parsed = parseIvideonSource(livestreamInput);
    if (!parsed) {
      setStatusMessage('Paste a valid Ivideon iframe/embed URL containing a 100-... camera id.');
      return;
    }
    setIsApplyingSource(true);
    setStatusMessage(`Checking and saving livestream source ${parsed.cameraId}…`);
    fetchWithTimeout(apiUrl('/api/camera-source'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed),
    }, 20000)
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not save camera source');
        const data = (await response.json()) as CameraSourceResponse;
        skipNextCameraProbeRef.current = true;
        setCameraSource(data.camera);
        setSelectedCaptureId(null);
        setCameraPreviewSrc(apiUrl(`/api/proxy/frame?q=1&t=${Date.now()}`));
        setCameraStatusMessage(data.health?.statusMessage || `Source ${data.camera.cameraId} saved.`);
        setStreamStatus(data.health?.online ? 'ready' : 'cached');
        setStatusMessage(`Switched livestream source to ${data.camera.cameraId}. Capture now uses this backend source.`);
      })
      .catch((error) => {
        setStatusMessage(error instanceof Error ? error.message : 'Could not save livestream source.');
        setStreamStatus('error');
      })
      .finally(() => {
        setIsApplyingSource(false);
      });
  };

  const resetLivestreamSource = () => {
    setIsApplyingSource(true);
    setStatusMessage('Resetting livestream source…');
    fetchWithTimeout(apiUrl('/api/camera-source/reset'), { method: 'POST' }, 20000)
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not reset camera source');
        const data = (await response.json()) as CameraSourceResponse;
        skipNextCameraProbeRef.current = true;
        setCameraSource(data.camera);
        setLivestreamInput('');
        setCameraPreviewSrc(apiUrl(`/api/proxy/frame?q=1&t=${Date.now()}`));
        setCameraStatusMessage(data.health?.statusMessage || 'Camera source reset.');
        setStreamStatus(data.health?.online ? 'ready' : 'cached');
        setStatusMessage('Reset livestream source to Dodo Pizza Guzovsky.');
      })
      .catch((error) => {
        setStatusMessage(error instanceof Error ? error.message : 'Could not reset livestream source.');
        setStreamStatus('error');
      })
      .finally(() => {
        setIsApplyingSource(false);
      });
  };

  const addManualZoneLabel = (zone: StationZone) => {
    const targetCaptureId = activeCaptureIdRef.current || selectedCapture?.id || null;
    if (!selectedCapture || !targetCaptureId || !imageRef.current || isCapturing) return;
    const image = imageRef.current;
    const label: CaptureLabel = {
      id: `manual_${Date.now()}_${zone.id}`,
      className: 'manual-station-zone',
      stationId: zone.id,
      stationName: zone.name,
      score: 1,
      bbox: {
        x: zone.bounds.x * image.naturalWidth,
        y: zone.bounds.y * image.naturalHeight,
        width: zone.bounds.width * image.naturalWidth,
        height: zone.bounds.height * image.naturalHeight,
      },
    };

    setCaptures((current) => {
      const next = current.map((capture) => {
        if (capture.id !== targetCaptureId) return capture;
        const labels = [...capture.labels, label];
        labelDraftsRef.current.set(capture.id, labels);
        return { ...capture, labels };
      });
      persistLocalCaptures(next);
      return next;
    });
    setStatusMessage(`${zone.name} label added. Click Save Labels to persist it.`);
  };

  const imageWidth = imageRef.current?.naturalWidth || 1;
  const imageHeight = imageRef.current?.naturalHeight || 1;
  const overlayWidth = Math.max(imageDimensions.width, imageWidth, 1);
  const overlayHeight = Math.max(imageDimensions.height, imageHeight, 1);
  const activeSession = session?.status === 'active';

  return (
    <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.65fr)_420px] gap-6" data-testid="webcam-labeling-studio">
      <div className="space-y-4 min-w-0">
        <div className="border border-zinc-300 bg-white" data-testid="live-stream-panel">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-300 px-4 py-3">
            <div>
              <h2 className="font-heading text-xl text-zinc-950 flex items-center gap-2" data-testid="live-stream-heading">
                <Video className="w-5 h-5 text-[#002FA7]" /> Live Kitchen Stream
              </h2>
              <p className="font-mono text-xs text-zinc-500" data-testid="live-stream-source">
                IVIDEON_PUBLIC / server={cameraSource.serverId} / camera={cameraSource.cameraIndex}
              </p>
            </div>
            <span
              className={cn(
                'font-mono text-xs px-2 py-1 border',
                streamStatus === 'ready' && 'border-emerald-600 bg-emerald-50 text-emerald-700',
                streamStatus === 'cached' && 'border-blue-600 bg-blue-50 text-blue-700',
                streamStatus === 'checking' && 'border-amber-500 bg-amber-50 text-amber-700',
                streamStatus === 'error' && 'border-red-600 bg-red-50 text-red-700'
              )}
              data-testid="stream-proxy-status"
            >
              {streamStatus === 'ready'
                ? 'LIVE CAMERA READY'
                : streamStatus === 'cached'
                  ? 'CAMERA OFFLINE — CACHED MODE'
                  : streamStatus === 'checking'
                    ? 'CHECKING CAMERA'
                    : 'CAMERA CHECK FAILED'}
            </span>
          </div>
          <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 font-mono text-xs text-zinc-600" data-testid="camera-status-message">
            {cameraStatusMessage}
          </div>
          <div className="grid gap-3 border-b border-zinc-200 bg-white px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]" data-testid="livestream-source-panel">
            <label className="block min-w-0" data-testid="livestream-source-field">
              <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                Livestream source / active: {cameraSource.cameraId}
              </span>
              <input
                value={livestreamInput}
                onChange={(event) => setLivestreamInput(event.target.value)}
                placeholder="Paste Ivideon iframe embed code or https://open.ivideon.com/embed/v3/100-...:0/"
                className="w-full border border-zinc-300 px-3 py-2 font-mono text-xs text-zinc-950 focus:border-[#002FA7]"
                data-testid="livestream-source-input"
              />
            </label>
            <button
              onClick={applyLivestreamSource}
              disabled={isApplyingSource}
              className="self-end border border-[#002FA7] bg-[#002FA7] px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] text-white transition-colors hover:bg-blue-800"
              data-testid="apply-livestream-source-button"
            >
              {isApplyingSource ? 'Saving…' : 'Use Source'}
            </button>
            <button
              onClick={resetLivestreamSource}
              disabled={isApplyingSource}
              className="self-end border border-zinc-300 bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] text-zinc-700 transition-colors hover:border-zinc-950"
              data-testid="reset-livestream-source-button"
            >
              Reset
            </button>
          </div>
          <div className="bg-[#0A0A0A] p-3">
            <div className="aspect-video w-full overflow-hidden border border-zinc-800 bg-black" data-testid="ivideon-iframe-container">
              {streamStatus === 'ready' ? (
                <div className="relative h-full w-full" data-testid="live-camera-preview">
                  <iframe
                    title="Selected Ivideon live stream"
                    src={cameraSource.iframeUrl}
                    className="h-full w-full"
                    allow="autoplay; fullscreen; picture-in-picture"
                    data-testid="ivideon-live-iframe"
                  />
                  {cameraPreviewSrc && (
                    <img
                      src={cameraPreviewSrc}
                      alt="Live proxy frame preview"
                      className="pointer-events-none absolute right-3 top-3 h-24 w-36 border border-emerald-400 bg-black object-cover shadow-lg"
                      data-testid="live-proxy-frame-thumbnail"
                    />
                  )}
                  <div className="absolute left-3 top-3 border border-emerald-400 bg-black/80 px-3 py-2 font-mono text-xs uppercase tracking-[0.18em] text-emerald-200" data-testid="live-camera-preview-badge">
                    Live source verified by frame proxy
                  </div>
                </div>
              ) : (
                <div className="relative h-full w-full" data-testid="cached-camera-preview">
                  {cameraPreviewSrc ? (
                    <img
                      src={cameraPreviewSrc}
                      alt="Cached kitchen camera preview"
                      className="h-full w-full object-contain"
                      data-testid="cached-camera-preview-image"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center font-mono text-sm text-zinc-400" data-testid="cached-camera-preview-loading">
                      Preparing camera preview…
                    </div>
                  )}
                  <div className="absolute left-3 top-3 border border-blue-400 bg-black/80 px-3 py-2 font-mono text-xs uppercase tracking-[0.18em] text-blue-200" data-testid="cached-camera-preview-badge">
                    Live feed offline — labeling uses cached/reference frames
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border border-zinc-300 bg-white" data-testid="capture-labeling-panel">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-300 px-4 py-3">
            <div>
              <h2 className="font-heading text-xl text-zinc-950 flex items-center gap-2" data-testid="capture-workspace-heading">
                <Crosshair className="w-5 h-5 text-[#002FA7]" /> Timestamped Frame Labeling
              </h2>
              <p className="font-mono text-xs text-zinc-500" data-testid="capture-status-message">{statusMessage}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={captureNow}
                disabled={isCapturing}
                className="inline-flex items-center gap-2 border border-zinc-950 bg-zinc-950 px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-white transition-colors hover:bg-[#002FA7] disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="capture-frame-button"
              >
                {isCapturing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                Capture Now
              </button>
              <button
                onClick={runAutoDetect}
                disabled={!selectedCapture || isDetecting || isCapturing}
                className="inline-flex items-center gap-2 border border-zinc-400 bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-zinc-950 transition-colors hover:border-[#002FA7] hover:text-[#002FA7] disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="auto-detect-button"
              >
                {isDetecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                {isDetecting ? 'Detecting' : 'Auto Detect'}
              </button>
              <button
                onClick={saveLabels}
                disabled={!selectedCapture || isSaving}
                className="inline-flex items-center gap-2 border border-emerald-700 bg-emerald-50 px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="save-labels-button"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Labels
              </button>
            </div>
          </div>

          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="relative min-h-[280px] overflow-hidden border border-zinc-300 bg-zinc-950" data-testid="labeling-image-stage">
              {selectedCapture ? (
                <div className="relative mx-auto aspect-video h-full w-full max-h-[540px]">
                  <img
                    ref={imageRef}
                    src={captureImageSrc(selectedCapture)}
                    alt="Captured kitchen frame for labeling"
                    className="h-full w-full object-contain"
                    onLoad={(event) => {
                      setImageDimensions({
                        width: event.currentTarget.naturalWidth || 1,
                        height: event.currentTarget.naturalHeight || 1,
                      });
                    }}
                    data-testid="selected-capture-image"
                  />
                  <div className="pointer-events-none absolute inset-0" data-testid="label-overlay">
                    {zones.map((zone) => (
                      <div
                        key={zone.id}
                        className="absolute border border-dashed border-white/60 bg-white/5"
                        style={{
                          left: `${zone.bounds.x * 100}%`,
                          top: `${zone.bounds.y * 100}%`,
                          width: `${zone.bounds.width * 100}%`,
                          height: `${zone.bounds.height * 100}%`,
                        }}
                        data-testid={`station-zone-overlay-${zone.id}`}
                      >
                        <span className="absolute left-1 top-1 bg-black/80 px-1.5 py-0.5 font-mono text-[10px] uppercase text-white">
                          {zone.name}
                        </span>
                      </div>
                    ))}
                    {selectedCapture.labels.map((label) => (
                      <div
                        key={label.id}
                        className="absolute border-2 border-[#F59E0B] bg-amber-400/10"
                        style={{
                          left: `${(label.bbox.x / overlayWidth) * 100}%`,
                          top: `${(label.bbox.y / overlayHeight) * 100}%`,
                          width: `${(label.bbox.width / overlayWidth) * 100}%`,
                          height: `${(label.bbox.height / overlayHeight) * 100}%`,
                        }}
                        data-testid={`capture-label-overlay-${label.id}`}
                      >
                        <span className="absolute -top-6 left-0 bg-[#F59E0B] px-2 py-1 font-mono text-[10px] uppercase text-zinc-950">
                          {label.className} {label.stationName ? `/ ${label.stationName}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 text-zinc-400" data-testid="empty-capture-state">
                  <AlertCircle className="w-8 h-8" />
                  <p className="font-mono text-sm">No frame captured yet. Use Capture Now to begin labeling.</p>
                </div>
              )}
            </div>

            <aside className="space-y-3" data-testid="labeling-side-panel">
              <div className="border border-zinc-300 p-3">
                <h3 className="mb-3 font-heading text-sm uppercase tracking-[0.2em] text-zinc-950" data-testid="manual-zone-heading">
                  Manual Zone Labels
                </h3>
                <div className="space-y-2">
                  {zones.map((zone) => (
                    <button
                      key={zone.id}
                      onClick={() => addManualZoneLabel(zone)}
                      disabled={!selectedCapture || isCapturing}
                      className="w-full border border-zinc-300 px-3 py-2 text-left text-xs font-bold uppercase tracking-[0.16em] text-zinc-800 transition-colors hover:border-[#002FA7] hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                      data-testid={`add-zone-label-button-${zone.id}`}
                    >
                      Add {zone.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border border-zinc-300 p-3">
                <h3 className="mb-3 font-heading text-sm uppercase tracking-[0.2em] text-zinc-950" data-testid="detected-labels-heading">
                  Saved Detections
                </h3>
                <div className="max-h-52 space-y-2 overflow-y-auto pr-1" data-testid="detected-labels-list">
                  {selectedCapture?.labels.length ? (
                    selectedCapture.labels.map((label) => (
                      <div key={label.id} className="border border-zinc-200 p-2" data-testid={`detected-label-row-${label.id}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs uppercase text-zinc-950" data-testid={`detected-label-class-${label.id}`}>
                            {label.className}
                          </span>
                          <span className="font-mono text-[10px] text-zinc-500" data-testid={`detected-label-score-${label.id}`}>
                            {Math.round((label.score || 0) * 100)}%
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-500" data-testid={`detected-label-station-${label.id}`}>
                          {label.stationName || 'No station match'}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-zinc-500" data-testid="no-detections-message">Run auto-detect or add a manual zone.</p>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </div>

        <div className="border border-zinc-300 bg-white" data-testid="capture-gallery-panel">
          <div className="flex items-center justify-between border-b border-zinc-300 px-4 py-3">
            <h2 className="font-heading text-lg text-zinc-950 flex items-center gap-2" data-testid="capture-gallery-heading">
              <Database className="w-5 h-5 text-[#002FA7]" /> Capture Store
            </h2>
            <span className="font-mono text-xs text-zinc-500" data-testid="capture-count">{captures.length} frames</span>
          </div>
          <div className="flex gap-3 overflow-x-auto p-4" data-testid="capture-gallery-list">
            {captures.map((capture) => (
              <button
                key={capture.id}
                onClick={() => setSelectedCaptureId(capture.id)}
                className={cn(
                  'min-w-44 border bg-white p-2 text-left transition-transform hover:-translate-y-0.5',
                  selectedCapture?.id === capture.id ? 'border-[#002FA7] ring-2 ring-[#002FA7]/20' : 'border-zinc-300'
                )}
                data-testid={`capture-gallery-item-${capture.id}`}
              >
                <img src={captureImageSrc(capture)} alt="Captured thumbnail" className="aspect-video w-full object-cover" />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-zinc-950" data-testid={`capture-gallery-time-${capture.id}`}>
                    {formatTime(capture.capturedAtIso)}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-500" data-testid={`capture-gallery-label-count-${capture.id}`}>
                    {capture.labels.length} labels
                  </span>
                </div>
              </button>
            ))}
            {!captures.length && (
              <div className="border border-dashed border-zinc-300 p-6 text-sm text-zinc-500" data-testid="empty-gallery-message">
                Captured frames will appear here with exact server timestamps.
              </div>
            )}
          </div>
        </div>
      </div>

      <aside className="space-y-4" data-testid="capture-session-sidebar">
        <div className="border border-zinc-300 bg-white p-4" data-testid="capture-session-panel">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-heading text-xl text-zinc-950" data-testid="capture-session-heading">Server Capture Session</h2>
              <p className="font-mono text-xs text-zinc-500" data-testid="capture-session-description">
                Continuous JPEG sampling without browser CORS limits.
              </p>
            </div>
            <span
              className={cn(
                'font-mono text-xs px-2 py-1 border',
                activeSession ? 'border-emerald-700 bg-emerald-50 text-emerald-700' : 'border-zinc-300 text-zinc-500'
              )}
              data-testid="capture-session-status"
            >
              {activeSession ? 'ACTIVE' : 'IDLE'}
            </span>
          </div>

          <div className="space-y-4">
            <label className="block" data-testid="session-interval-field">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Interval Seconds</span>
              <input
                type="range"
                min="2"
                max="60"
                value={intervalSeconds}
                onChange={(event) => setIntervalSeconds(Number(event.target.value))}
                className="w-full accent-[#002FA7]"
                data-testid="session-interval-input"
              />
              <span className="font-mono text-sm text-zinc-950" data-testid="session-interval-value">{intervalSeconds}s</span>
            </label>

            <label className="block" data-testid="quality-field">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Preview Quality</span>
              <select
                value={quality}
                onChange={(event) => setQuality(event.target.value)}
                className="w-full border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-950 focus:border-[#002FA7] focus:outline-none"
                data-testid="quality-select"
              >
                <option value="1">q=1 / Fast JPEG</option>
                <option value="2">q=2 / Higher detail</option>
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={startSession}
                disabled={activeSession}
                className="inline-flex items-center justify-center gap-2 border border-emerald-700 bg-emerald-700 px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
                data-testid="start-session-button"
              >
                <Play className="w-4 h-4" /> Start
              </button>
              <button
                onClick={stopSession}
                disabled={!activeSession}
                className="inline-flex items-center justify-center gap-2 border border-red-700 bg-red-50 px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] text-red-800 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
                data-testid="stop-session-button"
              >
                <Square className="w-4 h-4" /> Stop
              </button>
            </div>
          </div>
        </div>

        <div className="border border-zinc-300 bg-white p-4" data-testid="capture-session-audit-panel">
          <h3 className="mb-3 font-heading text-sm uppercase tracking-[0.2em] text-zinc-950" data-testid="session-audit-heading">
            Session Audit
          </h3>
          <div className="space-y-3 font-mono text-xs text-zinc-700">
            <div className="flex justify-between border-b border-zinc-200 pb-2">
              <span>Frames</span>
              <span data-testid="session-frame-count">{session?.frameCount || 0}/{session?.maxFrames || 500}</span>
            </div>
            <div className="flex justify-between border-b border-zinc-200 pb-2">
              <span>Started</span>
              <span data-testid="session-started-at">{formatTime(session?.startedAtIso)}</span>
            </div>
            <div className="flex justify-between border-b border-zinc-200 pb-2">
              <span>Last Frame</span>
              <span data-testid="session-last-capture-at">{formatTime(session?.lastCaptureAtIso)}</span>
            </div>
            <div className="flex items-start gap-2 pt-1 text-zinc-500" data-testid="privacy-note">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              <span>Labels store coordinates and station names for analysis; raw stream remains external.</span>
            </div>
          </div>
        </div>

        <div className="border border-zinc-300 bg-zinc-950 p-4 text-white" data-testid="pipeline-health-panel">
          <h3 className="font-heading text-sm uppercase tracking-[0.2em]" data-testid="pipeline-health-heading">Pipeline Health</h3>
          <div className="mt-4 space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between gap-3" data-testid="pipeline-proxy-row">
              <span>JPEG Proxy</span>
              <span className="text-emerald-400">/api/proxy/frame</span>
            </div>
            <div className="flex items-center justify-between gap-3" data-testid="pipeline-model-row">
              <span>COCO-SSD</span>
              <span className={modelReady ? 'text-emerald-400' : 'text-blue-300'}>{modelReady ? 'READY' : 'ON DEMAND'}</span>
            </div>
            <div className="flex items-center justify-between gap-3" data-testid="pipeline-clock-row">
              <span>Timestamp</span>
              <span className="text-blue-300 flex items-center gap-1"><Clock3 className="w-3 h-3" /> UTC ms</span>
            </div>
          </div>
        </div>
      </aside>
    </section>
  );
}