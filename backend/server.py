import base64
import asyncio
import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, Literal

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

load_dotenv('/app/.env')


def required_env(key: str) -> str:
    value = os.environ.get(key)
    if not value:
        raise RuntimeError(f'Missing required config: {key}')
    return value.strip('"')


IVIDEON_API_BASE_URL = required_env('VITE_IVIDEON_API_BASE_URL').rstrip('/')
IVIDEON_EMBED_BASE_URL = required_env('VITE_IVIDEON_EMBED_BASE_URL').rstrip('/')
FALLBACK_FRAME_URL = required_env('VITE_FALLBACK_FRAME_URL')
STORE_PATH = Path(required_env('MISE_CAPTURE_STORE_PATH'))
DEFAULT_SERVER_ID = required_env('VITE_CAMERA_SERVER_ID')
DEFAULT_CAMERA_INDEX = required_env('VITE_CAMERA_INDEX')
DEFAULT_CAMERA_LABEL = required_env('VITE_CAMERA_LABEL')


class CaptureLabel(BaseModel):
    id: str
    className: str
    score: float | None = None
    stationId: str | None = None
    stationName: str | None = None
    bbox: dict[str, float]


class CameraSource(BaseModel):
    serverId: str
    cameraIndex: str = '0'
    cameraId: str | None = None
    cameraLabel: str | None = None
    iframeUrl: str | None = None


class Capture(BaseModel):
    id: str
    cameraId: str
    cameraLabel: str
    capturedAt: int
    capturedAtIso: str
    quality: str
    contentType: str
    sizeBytes: int
    imageDataUrl: str
    frameSource: Literal['live', 'cached', 'fallback'] = 'live'
    cameraOnline: bool = True
    statusMessage: str = 'Live camera frame captured.'
    labels: list[CaptureLabel] = Field(default_factory=list)


class CaptureSession(BaseModel):
    id: str
    status: Literal['active', 'stopped']
    intervalSeconds: int
    quality: str
    startedAt: int
    startedAtIso: str
    frameCount: int
    maxFrames: int = 500
    camera: CameraSource
    stoppedAt: int | None = None
    stoppedAtIso: str | None = None
    lastCaptureAt: int | None = None
    lastCaptureAtIso: str | None = None


def default_camera() -> CameraSource:
    camera_id = f'{DEFAULT_SERVER_ID}:{DEFAULT_CAMERA_INDEX}'
    return CameraSource(
        serverId=DEFAULT_SERVER_ID,
        cameraIndex=DEFAULT_CAMERA_INDEX,
        cameraId=camera_id,
        cameraLabel=DEFAULT_CAMERA_LABEL,
        iframeUrl=f'{IVIDEON_EMBED_BASE_URL}/embed/v3/{camera_id}/',
    )


def normalize_camera(data: dict[str, Any] | None = None) -> CameraSource:
    data = data or {}
    fallback = default_camera()
    raw_camera_id = str(data.get('cameraId') or '')
    server_id = str(data.get('serverId') or data.get('server') or (raw_camera_id.split(':')[0] if ':' in raw_camera_id else '') or fallback.serverId)
    camera_index = str(data.get('cameraIndex') or data.get('camera') or (raw_camera_id.split(':')[1] if ':' in raw_camera_id else '') or fallback.cameraIndex)
    camera_id = f'{server_id}:{camera_index}'
    camera_label = str(data.get('cameraLabel') or data.get('label') or (fallback.cameraLabel if camera_id == fallback.cameraId else f'Ivideon {camera_id}'))
    iframe_url = str(data.get('iframeUrl') or f'{IVIDEON_EMBED_BASE_URL}/embed/v3/{camera_id}/')
    return CameraSource(serverId=server_id, cameraIndex=camera_index, cameraId=camera_id, cameraLabel=camera_label, iframeUrl=iframe_url)


def now_ms() -> int:
    return int(time.time() * 1000)


def iso_from_ms(ms: int) -> str:
    return time.strftime('%Y-%m-%dT%H:%M:%S.', time.gmtime(ms / 1000)) + f'{ms % 1000:03d}Z'


def decode_data_url(data_url: str) -> tuple[bytes, str]:
    header, payload = data_url.split(',', 1)
    content_type = header.removeprefix('data:').removesuffix(';base64') or 'image/jpeg'
    return base64.b64decode(payload), content_type


def load_store() -> list[Capture]:
    if not STORE_PATH.exists():
        return []
    try:
        raw = json.loads(STORE_PATH.read_text())
        return [Capture(**item) for item in raw.get('captures', [])]
    except Exception:
        return []


captures: list[Capture] = load_store()
active_camera: CameraSource = default_camera()
active_session: CaptureSession | None = None
session_task: asyncio.Task | None = None


def persist_store() -> None:
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STORE_PATH.write_text(json.dumps({'captures': [capture.model_dump() for capture in captures]}, indent=2))


def public_capture(capture: Capture) -> dict[str, Any]:
    data = capture.model_dump(exclude={'imageDataUrl'})
    data['imageUrl'] = f'/api/captures/{capture.id}/image'
    return data


async def fetch_fallback_frame(reason: str, camera: CameraSource) -> dict[str, Any]:
    cached = next((capture for capture in captures if capture.cameraId == camera.cameraId), None) or (captures[0] if captures else None)
    if cached:
        content, content_type = decode_data_url(cached.imageDataUrl)
        return {'content': content, 'content_type': content_type, 'source': 'cached', 'online': False, 'message': f'Live camera unavailable; using last captured frame. {reason}'}
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        response = await client.get(FALLBACK_FRAME_URL, headers={'user-agent': 'Mozilla/5.0 MISE backend fallback'})
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f'Camera offline and fallback failed: {response.status_code}. {reason}')
    return {'content': response.content, 'content_type': response.headers.get('content-type', 'image/jpeg'), 'source': 'fallback', 'online': False, 'message': f'Live camera unavailable; using fallback reference frame. {reason}'}


async def fetch_frame(quality: str = '1', camera: CameraSource | None = None) -> dict[str, Any]:
    camera = camera or active_camera
    url = f'{IVIDEON_API_BASE_URL}/cameras/{camera.cameraId}/live_preview?op=GET&access_token=public&q={quality}'
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        response = await client.get(url, headers={'user-agent': 'Mozilla/5.0 MISE backend camera proxy'})
    if response.status_code >= 400:
        return await fetch_fallback_frame(f'Ivideon returned {response.status_code}: {response.text[:240]}', camera)
    return {'content': response.content, 'content_type': response.headers.get('content-type', 'image/jpeg'), 'source': 'live', 'online': True, 'message': 'Live camera frame captured.'}


async def create_capture(quality: str = '1', camera: CameraSource | None = None) -> Capture:
    camera = camera or active_camera
    frame = await fetch_frame(quality, camera)
    ts = now_ms()
    capture = Capture(
        id=f'cap_{ts}_{uuid.uuid4().hex[:6]}',
        cameraId=camera.cameraId or f'{camera.serverId}:{camera.cameraIndex}',
        cameraLabel=camera.cameraLabel or 'Ivideon Camera',
        capturedAt=ts,
        capturedAtIso=iso_from_ms(ts),
        quality=quality,
        contentType=frame['content_type'],
        sizeBytes=len(frame['content']),
        imageDataUrl=f"data:{frame['content_type']};base64,{base64.b64encode(frame['content']).decode('ascii')}",
        frameSource=frame['source'],
        cameraOnline=frame['online'],
        statusMessage=frame['message'],
        labels=[],
    )
    captures.insert(0, capture)
    del captures[20:]
    persist_store()
    return capture


app = FastAPI(title='MISE Camera API')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_credentials=False, allow_methods=['*'], allow_headers=['*'])


@app.get('/api/health')
async def health():
    return {'ok': True, 'camera': active_camera.model_dump()}


@app.get('/api/camera-source')
async def get_camera_source():
    return {'camera': active_camera.model_dump()}


@app.post('/api/camera-source')
async def set_camera_source(request: Request):
    global active_camera, active_session, session_task
    active_camera = normalize_camera(await request.json())
    active_session = None
    if session_task:
        session_task.cancel()
        session_task = None
    frame = await fetch_frame('1', active_camera)
    return {'camera': active_camera.model_dump(), 'health': {'online': frame['online'], 'source': frame['source'], 'statusMessage': frame['message']}}


@app.post('/api/camera-source/reset')
async def reset_camera_source():
    global active_camera, active_session, session_task
    active_camera = default_camera()
    active_session = None
    if session_task:
        session_task.cancel()
        session_task = None
    frame = await fetch_frame('1', active_camera)
    return {'camera': active_camera.model_dump(), 'health': {'online': frame['online'], 'source': frame['source'], 'statusMessage': frame['message']}}


def camera_from_request(request: Request) -> CameraSource:
    params = dict(request.query_params)
    return normalize_camera(params) if any(key in params for key in ['serverId', 'server', 'cameraId']) else active_camera


@app.get('/api/proxy/status')
async def proxy_status(request: Request, q: str = '1'):
    camera = camera_from_request(request)
    frame = await fetch_frame(q, camera)
    return {'cameraId': camera.cameraId, 'cameraLabel': camera.cameraLabel, 'online': frame['online'], 'source': frame['source'], 'iframeUrl': camera.iframeUrl, 'statusMessage': frame['message'], 'checkedAt': now_ms()}


@app.get('/api/proxy/frame')
async def proxy_frame(request: Request, q: str = '1'):
    camera = camera_from_request(request)
    frame = await fetch_frame(q, camera)
    return Response(content=frame['content'], media_type=frame['content_type'], headers={'cache-control': 'no-store', 'x-captured-at': str(now_ms()), 'x-camera-id': camera.cameraId or '', 'x-frame-source': frame['source'], 'x-camera-online': str(frame['online']).lower(), 'x-camera-status': frame['message']})


@app.get('/api/proxy/stream-url')
async def stream_url(request: Request, q: str = '2'):
    camera = camera_from_request(request)
    url = f'{IVIDEON_API_BASE_URL}/cameras/{camera.cameraId}/live_stream?op=GET&access_token=public&q={q}&format=hls'
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        response = await client.get(url, headers={'user-agent': 'Mozilla/5.0 MISE backend stream resolver'})
    manifest = response.text if response.status_code < 400 else ''
    return {'url': str(response.url) if response.status_code < 400 else camera.iframeUrl, 'manifestPreview': manifest[:1000], 'capturedAt': now_ms(), 'quality': q, 'iframeUrl': camera.iframeUrl, 'expiresApprox': '55 minutes', 'online': response.status_code < 400, 'statusMessage': 'Signed HLS URL resolved.' if response.status_code < 400 else f'Signed HLS unavailable ({response.status_code}); iframe/fallback capture still available.'}


@app.get('/api/proxy/stream')
async def proxy_stream(request: Request, q: str = '2'):
    camera = camera_from_request(request)
    url = f'{IVIDEON_API_BASE_URL}/cameras/{camera.cameraId}/live_stream?op=GET&access_token=public&q={q}&format=hls'
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        response = await client.get(url, headers={'user-agent': 'Mozilla/5.0 MISE backend stream proxy'})
    return Response(content=response.text, status_code=response.status_code, media_type=response.headers.get('content-type', 'application/vnd.apple.mpegurl'))


@app.get('/api/captures')
async def list_captures():
    return {'captures': [public_capture(capture) for capture in captures], 'total': len(captures)}


@app.post('/api/captures')
async def post_capture(request: Request):
    body = await request.json()
    camera = normalize_camera(body) if any(key in body for key in ['serverId', 'server', 'cameraId']) else active_camera
    capture = await create_capture(str(body.get('quality') or body.get('q') or '1'), camera)
    return JSONResponse(status_code=201, content={'capture': public_capture(capture)})


@app.get('/api/captures/{capture_id}/image')
async def capture_image(capture_id: str):
    capture = next((item for item in captures if item.id == capture_id), None)
    if not capture:
        raise HTTPException(status_code=404, detail='Capture not found')
    content, content_type = decode_data_url(capture.imageDataUrl)
    return Response(content=content, media_type=content_type, headers={'cache-control': 'public, max-age=300'})


@app.patch('/api/captures/{capture_id}/labels')
async def save_labels(capture_id: str, request: Request):
    capture = next((item for item in captures if item.id == capture_id), None)
    if not capture:
        raise HTTPException(status_code=404, detail='Capture not found')
    body = await request.json()
    capture.labels = [CaptureLabel(**label) for label in body.get('labels', [])]
    persist_store()
    return {'capture': public_capture(capture)}


@app.get('/api/capture-sessions/active')
async def get_active_session():
    return {'session': active_session.model_dump() if active_session else None}


@app.post('/api/capture-sessions/start')
async def start_session(request: Request):
    global active_session, session_task
    body = await request.json()
    camera = normalize_camera(body) if any(key in body for key in ['serverId', 'server', 'cameraId']) else active_camera
    interval = min(60, max(2, int(body.get('intervalSeconds') or 10)))
    ts = now_ms()
    active_session = CaptureSession(id=f'session_{ts}', status='active', intervalSeconds=interval, quality=str(body.get('quality') or body.get('q') or '1'), startedAt=ts, startedAtIso=iso_from_ms(ts), frameCount=0, camera=camera)
    capture = await create_capture(active_session.quality, camera)
    active_session.frameCount = 1
    active_session.lastCaptureAt = capture.capturedAt
    active_session.lastCaptureAtIso = capture.capturedAtIso
    if session_task:
        session_task.cancel()
    session_task = asyncio.create_task(session_capture_loop(active_session.id))
    return JSONResponse(status_code=201, content={'session': active_session.model_dump()})


@app.post('/api/capture-sessions/stop')
async def stop_session():
    global active_session, session_task
    if active_session and active_session.status == 'active':
        ts = now_ms()
        active_session.status = 'stopped'
        active_session.stoppedAt = ts
        active_session.stoppedAtIso = iso_from_ms(ts)
    if session_task:
        session_task.cancel()
        session_task = None
    return {'session': active_session.model_dump() if active_session else None}


async def session_capture_loop(session_id: str):
    global active_session
    try:
        while active_session and active_session.id == session_id and active_session.status == 'active':
            await asyncio.sleep(active_session.intervalSeconds)
            if not active_session or active_session.id != session_id or active_session.status != 'active':
                return
            if active_session.frameCount >= active_session.maxFrames:
                ts = now_ms()
                active_session.status = 'stopped'
                active_session.stoppedAt = ts
                active_session.stoppedAtIso = iso_from_ms(ts)
                return
            capture = await create_capture(active_session.quality, active_session.camera)
            active_session.frameCount += 1
            active_session.lastCaptureAt = capture.capturedAt
            active_session.lastCaptureAtIso = capture.capturedAtIso
    except asyncio.CancelledError:
        return