"""Export local multiple-arrangement trials and reconstructed RDMs from SQLite."""

import csv
import json
import math
import os
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
DB = Path(os.getenv("MA_SQLITE_PATH", Path(os.getenv("STUDY_DATA_ROOT", HERE / "data")) / "ma.sqlite3"))
PARTICIPANTS_DB = Path(os.getenv("PARTICIPANTS_SQLITE_PATH", DB.parent / "participants.sqlite3"))


def parse_json(value, default):
    return json.loads(value) if value else default


def write_csv(path, headers, rows):
    with path.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def finite(value):
    number = float(value)
    return number if math.isfinite(number) else 0.0


def point_for(positions, ordinal):
    position = positions.get(str(ordinal), {})
    if isinstance(position, dict) and "x" in position and "y" in position:
        return finite(position["x"]), finite(position["y"])
    if isinstance(position, list) and len(position) == 2:
        return finite(position[0]), finite(position[1])
    return None


def main():
    if not DB.exists():
        raise FileNotFoundError(f"No multiple-arrangement database: {DB}")
    output = Path(sys.argv[1]).expanduser().resolve() if len(sys.argv) > 1 else (
        HERE / "data/exports" / datetime.now().strftime("%Y%m%d-%H%M%S")
    )
    output.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    studies = {row["id"]: dict(row) for row in conn.execute("SELECT * FROM studies")}
    stimuli = {}
    for row in conn.execute("SELECT study_id, ordinal, filename FROM stimuli ORDER BY study_id, ordinal"):
        stimuli.setdefault(row["study_id"], []).append(row["filename"])
    trial_rows = []
    position_rows = []
    trial_distance_rows = []
    trial_matrices = []
    rdm_rows = []
    session_rows = []
    export = {"studies": studies, "stimuli": stimuli, "sessions": []}
    for row in conn.execute("SELECT * FROM sessions ORDER BY started_at, id"):
        session = dict(row)
        state = parse_json(session.pop("state_json"), {})
        study_id = session["study_id"]
        profile_match = re.search(r"\[(demo|bi90|formal):[0-9a-f]+\]$", studies[study_id]["name"])
        profile = profile_match.group(1) if profile_match else "unknown"
        labels = stimuli.get(study_id, [])
        trials = []
        for raw in conn.execute("SELECT * FROM trials WHERE session_id = ? ORDER BY trial_index", (session["id"],)):
            trial = dict(raw)
            indices = parse_json(trial.pop("subset_indices_json"), [])
            positions = parse_json(trial.pop("positions_json"), {})
            movement = parse_json(trial.pop("movement_trace_json"), None)
            trial.update(subset_indices=indices, positions=positions, movement_trace=movement)
            trials.append(trial)
            trial_rows.append({
                "profile": profile, "study_id": study_id, "session_id": session["id"],
                "participant_id": session["participant_id"], "status": session["status"],
                "trial_index": trial["trial_index"],
                "words": json.dumps([labels[i] for i in indices], ensure_ascii=False),
                "subset_indices": json.dumps(indices),
                "positions": json.dumps(positions, ensure_ascii=False),
                "duration_seconds": trial["duration_seconds"],
                "arena_size": trial["arena_size"],
                "started_at": trial["started_at"], "completed_at": trial["completed_at"],
            })
            arena_size = finite(trial["arena_size"]) if trial["arena_size"] is not None else 0.0
            for ordinal in indices:
                point = point_for(positions, ordinal)
                if point is None:
                    continue
                x, y = point
                position_rows.append({
                    "profile": profile, "study_id": study_id, "session_id": session["id"],
                    "participant_id": session["participant_id"], "status": session["status"],
                    "trial_index": trial["trial_index"], "ordinal": ordinal,
                    "word": labels[ordinal], "x_px": x, "y_px": y,
                    "x_0_1": x / arena_size if arena_size > 0 else "",
                    "y_0_1": y / arena_size if arena_size > 0 else "",
                    "arena_size": arena_size,
                })
            if positions and all(point_for(positions, ordinal) is not None for ordinal in indices):
                points = [point_for(positions, ordinal) for ordinal in indices]
                matrix = [[math.hypot(x1 - x2, y1 - y2) for x2, y2 in points] for x1, y1 in points]
                trial_matrices.append({
                    "profile": profile, "study_id": study_id, "session_id": session["id"],
                    "participant_id": session["participant_id"], "status": session["status"],
                    "trial_index": trial["trial_index"],
                    "subset_indices": indices, "words": [labels[i] for i in indices],
                    "arena_size": arena_size, "distance_px": matrix,
                    "distance_arena_radius_units": [[2 * value / arena_size if arena_size > 0 else None for value in line] for line in matrix],
                })
                for i, left in enumerate(indices):
                    for j in range(i + 1, len(indices)):
                        right = indices[j]
                        trial_distance_rows.append({
                            "profile": profile, "study_id": study_id, "session_id": session["id"],
                            "participant_id": session["participant_id"], "status": session["status"],
                            "trial_index": trial["trial_index"],
                            "subset_size": len(indices), "word_i": labels[left], "word_j": labels[right],
                            "distance_px": matrix[i][j],
                            "distance_arena_radius_units": 2 * matrix[i][j] / arena_size if arena_size > 0 else "",
                        })
        session_rows.append({
            "profile": profile, "study_id": study_id, "study_name": studies[study_id]["name"],
            "session_id": session["id"], "participant_id": session["participant_id"],
            "status": session["status"], "n_trials": len(trials),
            "started_at": session["started_at"], "completed_at": session["completed_at"],
        })
        matrix = state.get("D") or []
        if trials and len(matrix) == len(labels):
            pairs = {
                (i, j): (finite(matrix[i][j]) + finite(matrix[j][i])) / 2
                for i in range(len(labels)) for j in range(i + 1, len(labels))
            }
            divisor = max(pairs.values(), default=0)
            for i in range(len(labels)):
                for j in range(i + 1, len(labels)):
                    raw = pairs[i, j]
                    rdm_rows.append({
                        "profile": profile, "study_id": study_id, "session_id": session["id"],
                        "participant_id": session["participant_id"], "status": session["status"],
                        "n_trials": len(trials), "word_i": labels[i], "word_j": labels[j],
                        "dissimilarity_raw": raw,
                        "dissimilarity_0_1": min(1.0, max(0.0, raw / divisor)) if divisor > 1e-12 else 0.0,
                        "evidence_raw": (state.get("W_raw") or [[0] * len(labels) for _ in labels])[i][j],
                    })
        export["sessions"].append({**session, "profile": profile, "state": state, "trials": trials})
    conn.close()
    write_csv(output / "ma_sessions.csv", ["profile", "study_id", "study_name", "session_id", "participant_id", "status", "n_trials", "started_at", "completed_at"], session_rows)
    write_csv(output / "ma_trials.csv", ["profile", "study_id", "session_id", "participant_id", "status", "trial_index", "words", "subset_indices", "positions", "duration_seconds", "arena_size", "started_at", "completed_at"], trial_rows)
    write_csv(output / "ma_positions_long.csv", ["profile", "study_id", "session_id", "participant_id", "status", "trial_index", "ordinal", "word", "x_px", "y_px", "x_0_1", "y_0_1", "arena_size"], position_rows)
    write_csv(output / "ma_rdms.csv", ["profile", "study_id", "session_id", "participant_id", "status", "n_trials", "word_i", "word_j", "dissimilarity_raw", "dissimilarity_0_1", "evidence_raw"], rdm_rows)
    write_csv(output / "ma_trial_distances.csv", ["profile", "study_id", "session_id", "participant_id", "status", "trial_index", "subset_size", "word_i", "word_j", "distance_px", "distance_arena_radius_units"], trial_distance_rows)
    participant_links = []
    if PARTICIPANTS_DB.exists():
        with sqlite3.connect(f"file:{PARTICIPANTS_DB}?mode=ro", uri=True) as links_db:
            links_db.row_factory = sqlite3.Row
            participant_links = [dict(row) for row in links_db.execute(
                "SELECT profile, version, participant_id, prolific_study_id, prolific_session_id, created_at "
                "FROM participants ORDER BY created_at")]
    write_csv(output / "ma_participant_links.csv", ["profile", "version", "participant_id",
        "prolific_study_id", "prolific_session_id", "created_at"], participant_links)
    (output / "ma_trial_distance_matrices.json").write_text(json.dumps(trial_matrices, ensure_ascii=False, indent=2), encoding="utf-8")
    (output / "ma_full.json").write_text(json.dumps(export, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Exported {len(session_rows)} sessions, {len(trial_rows)} trials, {len(position_rows)} positions, {len(trial_distance_rows)} trial distances, {len(rdm_rows)} RDM pairs to {output}")


if __name__ == "__main__":
    main()
