import os

import pytest
import requests


# API contract checks for lightweight capture metadata and image retrieval
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or os.environ.get("VITE_API_BASE_URL") or "http://127.0.0.1:3000"


@pytest.fixture(scope="session")
def api_base_url() -> str:
    return BASE_URL.rstrip("/")


@pytest.fixture(scope="session")
def api_client() -> requests.Session:
    session = requests.Session()
    session.headers.update({"content-type": "application/json"})
    return session


@pytest.fixture(autouse=True)
def reset_active_camera(api_client: requests.Session, api_base_url: str):
    api_client.post(f"{api_base_url}/api/camera-source/reset", timeout=60)


def test_post_capture_still_creates_capture(api_client: requests.Session, api_base_url: str):
    response = api_client.post(f"{api_base_url}/api/captures", json={"quality": "1"}, timeout=60)
    assert response.status_code == 201

    capture = response.json()["capture"]
    assert isinstance(capture["id"], str)
    assert capture["cameraId"] == "100-gRWCic9ftqMOx35Ocj6zdp:0"
    assert capture["contentType"].startswith("image/")


def test_get_captures_returns_lightweight_metadata_without_base64(api_client: requests.Session, api_base_url: str):
    response = api_client.get(f"{api_base_url}/api/captures", timeout=30)
    assert response.status_code == 200

    data = response.json()
    captures = data["captures"]
    assert isinstance(captures, list)
    assert data["total"] == len(captures)

    if captures:
      first = captures[0]
      assert "imageUrl" in first
      assert first["imageUrl"].startswith("/api/captures/")
      assert "imageDataUrl" not in first


def test_get_capture_image_endpoint_returns_jpeg_bytes(api_client: requests.Session, api_base_url: str):
    list_response = api_client.get(f"{api_base_url}/api/captures", timeout=30)
    assert list_response.status_code == 200
    captures = list_response.json()["captures"]
    assert captures, "No captures available to validate image endpoint"

    capture_id = captures[0]["id"]
    image_response = api_client.get(f"{api_base_url}/api/captures/{capture_id}/image", timeout=30)
    assert image_response.status_code == 200
    assert image_response.headers.get("content-type", "").startswith("image/")
    assert len(image_response.content) > 1000


def test_capture_store_capped_to_20_records(api_client: requests.Session, api_base_url: str):
    for _ in range(3):
        post_response = api_client.post(f"{api_base_url}/api/captures", json={"quality": "1"}, timeout=60)
        assert post_response.status_code == 201

    list_response = api_client.get(f"{api_base_url}/api/captures", timeout=30)
    assert list_response.status_code == 200
    captures = list_response.json()["captures"]
    assert len(captures) <= 20


def test_custom_ivideon_camera_source_is_supported(api_client: requests.Session, api_base_url: str):
    custom_payload = {
        "quality": "1",
        "serverId": "100-7BSgZfsYiTvX0Ykm406uEg",
        "cameraIndex": "0",
        "cameraLabel": "Custom Ivideon Test Camera",
        "iframeUrl": "https://open.ivideon.com/embed/v3/100-7BSgZfsYiTvX0Ykm406uEg:0/",
    }
    status = api_client.get(
        f"{api_base_url}/api/proxy/status",
        params={"q": "1", **custom_payload},
        timeout=60,
    )
    assert status.status_code == 200
    assert status.json()["cameraId"] == "100-7BSgZfsYiTvX0Ykm406uEg:0"

    create = api_client.post(f"{api_base_url}/api/captures", json=custom_payload, timeout=60)
    assert create.status_code == 201
    capture = create.json()["capture"]
    assert capture["cameraId"] == "100-7BSgZfsYiTvX0Ykm406uEg:0"
    assert capture["cameraLabel"] == "Custom Ivideon Test Camera"
    assert capture["imageUrl"].startswith(f"/api/captures/{capture['id']}/image")


def test_backend_active_camera_source_can_be_changed_and_used(api_client: requests.Session, api_base_url: str):
    custom_payload = {
        "serverId": "100-7BSgZfsYiTvX0Ykm406uEg",
        "cameraIndex": "0",
        "cameraLabel": "Backend Active Camera",
        "iframeUrl": "https://open.ivideon.com/embed/v3/100-7BSgZfsYiTvX0Ykm406uEg:0/",
    }
    save = api_client.post(f"{api_base_url}/api/camera-source", json=custom_payload, timeout=60)
    assert save.status_code == 200
    assert save.json()["camera"]["cameraId"] == "100-7BSgZfsYiTvX0Ykm406uEg:0"

    current = api_client.get(f"{api_base_url}/api/camera-source", timeout=30)
    assert current.status_code == 200
    assert current.json()["camera"]["cameraLabel"] == "Backend Active Camera"

    create = api_client.post(f"{api_base_url}/api/captures", json={"quality": "1"}, timeout=60)
    assert create.status_code == 201
    assert create.json()["capture"]["cameraId"] == "100-7BSgZfsYiTvX0Ykm406uEg:0"

    reset = api_client.post(f"{api_base_url}/api/camera-source/reset", timeout=60)
    assert reset.status_code == 200
    assert reset.json()["camera"]["cameraId"] == "100-gRWCic9ftqMOx35Ocj6zdp:0"
