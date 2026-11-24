const params = new URLSearchParams(location.search);
const status = document.getElementById("entry-status");

function pilotId() {
  const key = "arrangement_pilot_id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = `PILOT${Array.from(crypto.getRandomValues(new Uint8Array(12)),
      (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    sessionStorage.setItem(key, id);
  }
  return id;
}

async function begin() {
  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || "Could not load study");
    if (!config.materials_ready) throw new Error("The formal word list is not ready");

    const prolificId = params.get("PROLIFIC_PID") || "";
    const studyId = params.get("STUDY_ID") || "";
    const sessionId = params.get("SESSION_ID") || "";
    if (config.production && (!prolificId || !studyId || !sessionId)) {
      throw new Error("Please open the complete study link from Prolific.");
    }
    const participantId = prolificId || params.get("participant_id") || pilotId();
    status.textContent = "Creating or restoring your session…";
    const startResponse = await fetch("/api/participant/start", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ participant_id: participantId,
        prolific_study_id: studyId, prolific_session_id: sessionId }),
    });
    const data = await startResponse.json();
    if (!startResponse.ok) throw new Error(data.error || `HTTP ${startResponse.status}`);

    const next = new URLSearchParams({ invite: data.invite, participant_id: participantId,
      profile: data.profile, version: data.version });
    for (const name of ["PROLIFIC_PID", "STUDY_ID", "SESSION_ID"]) {
      if (params.has(name)) next.set(name, params.get(name));
    }
    location.replace(`/arrange?${next}`);
  } catch (error) {
    status.textContent = `Could not start: ${error.message}`;
  }
}

void begin();
