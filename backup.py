"""Create a consistent archive of the arrangement database and study manifests."""

import os
import shutil
import sqlite3
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = Path(os.getenv("STUDY_DATA_ROOT", ROOT / "data"))
TARGET = Path(os.getenv("BACKUP_ROOT", DATA / "backups"))


def main():
    TARGET.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination = TARGET / f"study3-{stamp}.tar.gz"
    with tempfile.TemporaryDirectory() as temp:
        stage = Path(temp) / "study_data"
        stage.mkdir()
        for name in ("ma.sqlite3", "participants.sqlite3"):
            source = DATA / name
            if source.exists():
                with sqlite3.connect(source) as live, sqlite3.connect(stage / name) as copy:
                    live.backup(copy)
        for source in DATA.glob("study-manifest.*.json"):
            shutil.copy2(source, stage / source.name)
        key = DATA / "experimenter-key.txt"
        if key.exists():
            shutil.copy2(key, stage / key.name)
        with tarfile.open(destination, "w:gz") as archive:
            archive.add(stage, arcname="study_data")
    destination.chmod(0o600)
    print(destination)


if __name__ == "__main__":
    main()
