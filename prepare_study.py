"""Create a versioned word study in the bundled Multiarrangement API."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MATERIALS = Path(os.getenv("STUDY_MATERIALS_ROOT", ROOT))
DATA = Path(os.getenv("STUDY_DATA_ROOT", ROOT / "data"))
API = os.getenv("MA_API_ORIGIN", "http://127.0.0.1:8000").rstrip("/")
PROFILE = os.getenv("STUDY_PROFILE", "demo")
WORD_FILE = {"demo": "words.demo.txt", "bi90": "words.bi90-reference.txt", "formal": "words.txt"}[PROFILE]


def materials():
    # Preserve CRLF bytes when hashing: Node's material() reads UTF-8 without newline translation.
    words_text = (MATERIALS / WORD_FILE).read_bytes().decode("utf-8")
    config_text = (MATERIALS / "arrangement.config.json").read_bytes().decode("utf-8")
    profile_text = (MATERIALS / "arrangement.bi90.config.json").read_bytes().decode("utf-8") if PROFILE == "bi90" else ""
    images_file = MATERIALS / "word-images.json"
    images_text = images_file.read_bytes().decode("utf-8")
    images = json.loads(images_text) if images_text else {}
    words = [line.strip() for line in words_text.splitlines() if line.strip() and not line.startswith("#")]
    if words and (len(words) < 3 or len({word.casefold() for word in words}) != len(words)):
        raise ValueError("Word list must contain at least three unique words")
    if PROFILE == "bi90" and len(words) != 90:
        raise ValueError("bi90 requires exactly 90 words")
    if not isinstance(images, dict) or set(images) - set(words):
        raise ValueError("word-images.json must map current word labels to image filenames")
    for filename in images.values():
        if not isinstance(filename, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+\.(png|jpe?g|webp)", filename, re.I):
            raise ValueError(f"Invalid image filename: {filename}")
        if not (MATERIALS / "public" / "stimuli" / filename).is_file():
            raise ValueError(f"Image file is missing: {filename}")
    config = json.loads(config_text)
    if profile_text:
        override = json.loads(profile_text)
        config = {**config, **override, "ma_config": {**config["ma_config"], **override.get("ma_config", {})}}
    version_input = PROFILE + "\n" + words_text + "\n" + config_text
    if profile_text:
        version_input += "\n" + profile_text
    if images_text:
        version_input += "\n" + images_text
    digest = hashlib.sha256(version_input.encode("utf-8"))
    for word, filename in sorted(images.items()):
        digest.update(f"\n{word}\0{filename}\0".encode("utf-8"))
        digest.update((MATERIALS / "public" / "stimuli" / filename).read_bytes())
    if config.get("instruction_image"):
        digest.update((MATERIALS / "public" / Path(config["instruction_image"]).name).read_bytes())
    version = digest.hexdigest()[:16]
    return words, images, config, version


def experimenter_key():
    provided = os.getenv("MA_EXPERIMENTER_KEY", "")
    if provided:
        return provided
    key_file = DATA / "experimenter-key.txt"
    if key_file.exists():
        return key_file.read_text(encoding="utf-8").strip()
    secret = os.getenv("EXPERIMENTER_KEY_SECRET", "")
    if os.getenv("APP_ENV") == "production" and not secret:
        raise ValueError("EXPERIMENTER_KEY_SECRET is required in production")
    secret = secret or "local-dev-signing-secret"
    payload = base64.urlsafe_b64encode(secrets.token_bytes(24)).decode("ascii").rstrip("=")
    signature = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()[:12]
    key = f"{payload}.{signature}"
    key_file.write_text(key + "\n", encoding="utf-8")
    key_file.chmod(0o600)
    return key


def request(method, route, key, body=None):
    content = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(API + "/api/v1" + route, data=content, method=method,
                                 headers={"x-experimenter-key": key,
                                          **({"content-type": "application/json"} if content is not None else {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"API {error.code}: {error.read().decode()}") from error


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    words, images, config, version = materials()
    if not words:
        print("Formal word list is empty; no participant study created.")
        return
    key = experimenter_key()
    manifest_file = DATA / f"study-manifest.{PROFILE}.json"
    version_file = DATA / f"study-manifest.{PROFILE}.{version}.json"
    if version_file.exists():
        archived = json.loads(version_file.read_text(encoding="utf-8"))
        request("GET", f"/studies/{archived['study_id']}", key)
        manifest_file.write_text(json.dumps(archived, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Restored {PROFILE} study: {archived['study_id']} version {version}")
        return
    if manifest_file.exists():
        old = json.loads(manifest_file.read_text(encoding="utf-8"))
        if old.get("version") == version:
            request("GET", f"/studies/{old['study_id']}", key)
            version_file.write_text(json.dumps(old, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"Existing {PROFILE} study: {old['study_id']} version {version}")
            return
    study = request("POST", "/studies", key, {
        "name": f"{config['study_name']} [{PROFILE}:{version}]",
        "description": "Word multiarrangement; source code bundled in online experiment package",
        "paradigm": "adaptive", "language": "en",
        "config": config["ma_config"], "instructions": config["ma_instructions"],
    })
    stimuli = [{"ordinal": i, "filename": word, "media_type": "image",
                "media_url": "/stimuli/" + images[word] if word in images else None,
                "thumbnail_url": "/stimuli/" + images[word] if word in images else None}
               for i, word in enumerate(words)]
    request("POST", f"/studies/{study['id']}/stimuli", key, {"stimuli": stimuli})
    manifest = {"profile": PROFILE, "version": version, "study_id": study["id"], "words": words}
    manifest_file.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    version_file.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Created {PROFILE} study: {study['id']} version {version}; {len(words)} words")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Study setup failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
