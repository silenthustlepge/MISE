import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { edgeVision } from '../services/VisionService';
import { StationZone, BoundingBox } from '../core/types';
import { cn } from '../lib/utils';
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
  imageDataUrl: string;
  labels: CaptureLabel[];
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

const LIVE_IFRAME_URL =
  'https://open.ivideon.com/embed/v3/?server=100-gRWCic9ftqMOx35Ocj6zdp&camera=0&width=&height=&lang=ru';

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

export function WebcamLabelingStudio({ zones, onOccupancyChange }: WebcamLabelingStudioProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [captures, setCaptures] = useState<WebcamCapture[]>([]);
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [intervalSeconds, setIntervalSeconds] = useState(8);
  const [quality, setQuality] = useState('1');
  const [isCapturing, setIsCapturing] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Connecting to public camera proxy…');
  const [streamStatus, setStreamStatus] = useState<'checking' | 'ready' | 'error'>('checking');

  const selectedCapture = useMemo(
    () => captures.find((capture) => capture.id === selectedCaptureId) || captures[0],
    [captures, selectedCaptureId]
  );

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
    const response = await fetch('/api/captures');
    if (!response.ok) throw new Error('Could not load captures');
    const data = (await response.json()) as ApiCapturesResponse;
    setCaptures(data.captures);
    setSelectedCaptureId((current) => current || data.captures[0]?.id || null);
  }, []);

  const refreshSession = useCallback(async () => {
    const response = await fetch('/api/capture-sessions/active');
    if (!response.ok) throw new Error('Could not load session');
    const data = await response.json();
    setSession(data.session);
  }, []);

  useEffect(() => {
    let mounted = true;
    edgeVision
      .initialize()
      .then(() => mounted && setModelReady(true))
      .catch(() => mounted && setStatusMessage('COCO-SSD model failed to load. Capture still works.'));

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    refreshCaptures().catch(() => setStatusMessage('Capture API is warming up.'));
    refreshSession().catch(() => undefined);
  }, [refreshCaptures, refreshSession]);

  useEffect(() => {
    const timer = setInterval(() => {
      refreshCaptures().catch(() => undefined);
      refreshSession().catch(() => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [refreshCaptures, refreshSession]);

  useEffect(() => {
    fetch('/api/proxy/stream-url?q=2')
      .then((response) => {
        if (!response.ok) throw new Error('stream probe failed');
        return response.json();
      })
      .then(() => setStreamStatus('ready'))
      .catch(() => setStreamStatus('error'));
  }, []);

  const captureNow = async () => {
    setIsCapturing(true);
    setStatusMessage('Capturing timestamped JPEG on the server…');
    try {
      const response = await fetch('/api/captures', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quality }),
      });
      if (!response.ok) throw new Error('capture failed');
      const data = await response.json();
      setCaptures((current) => [data.capture, ...current.filter((item) => item.id !== data.capture.id)]);
      setSelectedCaptureId(data.capture.id);
      setStatusMessage(`Captured ${Math.round(data.capture.sizeBytes / 1024)}KB at ${formatTime(data.capture.capturedAtIso)}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Capture failed.');
    } finally {
      setIsCapturing(false);
    }
  };

  const runAutoDetect = async () => {
    if (!selectedCapture || !imageRef.current || !modelReady) return;
    setIsDetecting(true);
    setStatusMessage('Running local COCO-SSD detection on captured frame…');
    try {
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
    setStatusMessage('Saving labels to the local capture schema…');
    try {
      const response = await fetch(`/api/captures/${selectedCapture.id}/labels`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ labels: selectedCapture.labels }),
      });
      if (!response.ok) throw new Error('label save failed');
      const data = await response.json();
      setCaptures((current) => current.map((capture) => (capture.id === data.capture.id ? data.capture : capture)));
      setStatusMessage('Labels saved. Station occupancy is feeding the fusion dashboard.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Label save failed.');
    } finally {
      setIsSaving(false);
    }
  };

  const startSession = async () => {
    setStatusMessage('Starting continuous server-side capture session…');
    const response = await fetch('/api/capture-sessions/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intervalSeconds, quality }),
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
    const response = await fetch('/api/capture-sessions/stop', { method: 'POST' });
    const data = await response.json();
    setSession(data.session);
    setStatusMessage('Capture session stopped.');
  };

  const addManualZoneLabel = (zone: StationZone) => {
    if (!selectedCapture || !imageRef.current) return;
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

    setCaptures((current) =>
      current.map((capture) =>
        capture.id === selectedCapture.id ? { ...capture, labels: [...capture.labels, label] } : capture
      )
    );
  };

  const imageWidth = imageRef.current?.naturalWidth || 1;
  const imageHeight = imageRef.current?.naturalHeight || 1;
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
                IVIDEON_PUBLIC / server=100-gRWCic9ftqMOx35Ocj6zdp / camera=0
              </p>
            </div>
            <span
              className={cn(
                'font-mono text-xs px-2 py-1 border',
                streamStatus === 'ready' && 'border-emerald-600 bg-emerald-50 text-emerald-700',
                streamStatus === 'checking' && 'border-amber-500 bg-amber-50 text-amber-700',
                streamStatus === 'error' && 'border-red-600 bg-red-50 text-red-700'
              )}
              data-testid="stream-proxy-status"
            >
              {streamStatus === 'ready' ? 'HLS RESOLVED' : streamStatus === 'checking' ? 'CHECKING HLS' : 'HLS PROBE FAILED'}
            </span>
          </div>
          <div className="bg-[#0A0A0A] p-3">
            <div className="aspect-video w-full overflow-hidden border border-zinc-800 bg-black" data-testid="ivideon-iframe-container">
              <iframe
                title="Dodo Pizza Guzovsky Ivideon live stream"
                src={LIVE_IFRAME_URL}
                className="h-full w-full"
                allow="autoplay; fullscreen; picture-in-picture"
                data-testid="ivideon-live-iframe"
              />
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
                disabled={!selectedCapture || !modelReady || isDetecting}
                className="inline-flex items-center gap-2 border border-zinc-400 bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-zinc-950 transition-colors hover:border-[#002FA7] hover:text-[#002FA7] disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="auto-detect-button"
              >
                {isDetecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                Auto Detect
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
                    src={selectedCapture.imageDataUrl}
                    alt="Captured kitchen frame for labeling"
                    className="h-full w-full object-contain"
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
                          left: `${(label.bbox.x / imageWidth) * 100}%`,
                          top: `${(label.bbox.y / imageHeight) * 100}%`,
                          width: `${(label.bbox.width / imageWidth) * 100}%`,
                          height: `${(label.bbox.height / imageHeight) * 100}%`,
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
                      disabled={!selectedCapture}
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
                <img src={capture.imageDataUrl} alt="Captured thumbnail" className="aspect-video w-full object-cover" />
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
              <span className={modelReady ? 'text-emerald-400' : 'text-amber-400'}>{modelReady ? 'READY' : 'LOADING'}</span>
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