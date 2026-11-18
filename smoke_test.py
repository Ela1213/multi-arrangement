"""Submit synthetic layouts to verify the demo and 90-word reference profiles."""

import json
import math
import os
import urllib.error
import urllib.request
import uuid

BASE = os.getenv("STUDY_BASE_URL", "http://127.0.0.1:3100").rstrip("/")


def call(route, body=None, token="", expected_status=200):
    content = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(BASE + route, data=content,
        headers={**({"content-type": "application/json"} if content is not None else {}),
                 **({"x-participant-invite": token} if token else {})})
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            if response.status != expected_status:
                raise AssertionError(f"Expected HTTP {expected_status}, got {response.status}")
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == expected_status:
            return json.loads(error.read())
        raise RuntimeError(f"{route}: {error.code} {error.read().decode()}") from error


def main():
    config = call("/api/config")
    assert config["profile"] in {"demo", "bi90"}
    production = os.getenv("SMOKE_PRODUCTION") == "1"
    pid = uuid.uuid4().hex[:24] if production else "PILOT_" + uuid.uuid4().hex[:10]
    identity = {"participant_id": pid}
    if production:
        identity.update(prolific_study_id=uuid.uuid4().hex[:24],
                        prolific_session_id=uuid.uuid4().hex[:24])
    start = call("/api/participant/start", identity)
    token = start["invite"]
    assert call("/api/participant/start", identity)["invite"] == token
    assert call("/api/finish", {"participant_id": pid}, token, expected_status=409)["error"]
    session = call(f"/api/ma/public/invites/{token}/start", {}, token)
    trial = call(f"/api/ma/sessions/{session['session_id']}/next", token=token)
    assert len(trial["subset_indices"]) == len(config["words"])
    count = 0
    while not trial["is_final"] and (config["profile"] == "demo" or count == 0) and count < 80:
        subset = trial["subset_indices"]
        size = 850 if len(subset) > 24 else 620
        center = size / 2
        radius = size * 0.39
        positions = {str(ordinal): {"x": center + radius * math.cos(2 * math.pi * i / len(subset)),
                                    "y": center + radius * math.sin(2 * math.pi * i / len(subset))}
                     for i, ordinal in enumerate(subset)}
        result = call(f"/api/ma/sessions/{session['session_id']}/trials", {
            "trial_index": trial["trial_index"], "subset_indices": subset,
            "positions": positions, "arena_size": size, "duration_seconds": 2.0}, token)
        trial = result["next_trial"]
        count += 1
    if config["profile"] == "demo":
        assert trial["is_final"]
        assert call("/api/finish", {"participant_id": pid}, token)["completed"]
        print(f"PASS: demo participant {pid}; {count} arrangements; completion verified")
    else:
        assert count == 1 and 4 <= len(trial["subset_indices"]) <= 12
        print(f"PASS: 90-word reference participant {pid}; first 90×90 matrix; next subset {len(trial['subset_indices'])} words")


if __name__ == "__main__":
    main()
