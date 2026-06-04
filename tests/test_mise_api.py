import os
import time

import pytest
import requests


# Core MISE webcam proxy/session/capture API regression tests
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or os.environ.get("VITE_API_BASE_URL") or "http://127.0.0.1:3000"


@pytest.fixture(scope="session")
def api_base_url() -> str:
    return BASE_URL.rstrip("/")


@pytest.fixture(scope="session")
def api_client() -> requests.Session:
    session = requests.Session()
    session.headers.update({"content-type": "application/json"})
    return session


def test_proxy_frame_returns_jpeg_and_headers(api_client: requests.Session, api_base_url: str):
    response = api_client.get(f"{api_base_url}/api/proxy/frame?q=1", timeout=30)
    assert response.status_code == 200
    assert response.headers.get("content-type", "").startswith("image/")
    assert response.headers.get("x-camera-id") == "100-gRWCic9ftqMOx35Ocj6zdp:0"
    assert response.headers.get("x-captured-at")
    assert len(response.content) > 1000


def test_stream_url_returns_expected_payload(api_client: requests.Session, api_base_url: str):
    response = api_client.get(f"{api_base_url}/api/proxy/stream-url?q=2", timeout=30)
    assert response.status_code == 200
    data = response.json()
    assert data["quality"] == "2"
    assert data["iframeUrl"].startswith("https://open.ivideon.com/embed/v3/")
    assert "hls" in data["url"]
    assert data["expiresApprox"]


def test_create_capture_and_persist_labels(api_client: requests.Session, api_base_url: str):
    create_response = api_client.post(f"{api_base_url}/api/captures", json={"quality": "1"}, timeout=60)
    assert create_response.status_code == 201
    capture = create_response.json()["capture"]
    assert capture["cameraId"] == "100-gRWCic9ftqMOx35Ocj6zdp:0"
    assert capture["imageDataUrl"].startswith("data:image/")
    assert isinstance(capture["labels"], list)

    labels = [
        {
            "id": f"TEST_label_{int(time.time() * 1000)}",
            "className": "manual-station-zone",
            "stationId": "dough",
            "stationName": "Dough Rolling",
            "score": 1,
            "bbox": {"x": 100, "y": 50, "width": 120, "height": 140},
        }
    ]
    patch_response = api_client.patch(
        f"{api_base_url}/api/captures/{capture['id']}/labels",
        json={"labels": labels},
        timeout=30,
    )
    assert patch_response.status_code == 200
    patched_capture = patch_response.json()["capture"]
    assert patched_capture["id"] == capture["id"]
    assert patched_capture["labels"][0]["stationId"] == "dough"

    list_response = api_client.get(f"{api_base_url}/api/captures", timeout=30)
    assert list_response.status_code == 200
    all_captures = list_response.json()["captures"]
    persisted = next(item for item in all_captures if item["id"] == capture["id"])
    assert persisted["labels"][0]["stationName"] == "Dough Rolling"


def test_start_session_increments_frames_and_can_stop(api_client: requests.Session, api_base_url: str):
    stop_response = api_client.post(f"{api_base_url}/api/capture-sessions/stop", timeout=30)
    assert stop_response.status_code == 200

    start_response = api_client.post(
        f"{api_base_url}/api/capture-sessions/start",
        json={"intervalSeconds": 2, "quality": "1"},
        timeout=60,
    )
    assert start_response.status_code == 201
    session = start_response.json()["session"]
    assert session["status"] == "active"
    assert session["intervalSeconds"] == 2

    time.sleep(4.5)
    active_response = api_client.get(f"{api_base_url}/api/capture-sessions/active", timeout=30)
    assert active_response.status_code == 200
    active_session = active_response.json()["session"]
    assert active_session["status"] == "active"
    assert active_session["frameCount"] >= 2

    stop_response = api_client.post(f"{api_base_url}/api/capture-sessions/stop", timeout=30)
    assert stop_response.status_code == 200
    stopped_session = stop_response.json()["session"]
    assert stopped_session["status"] == "stopped"
