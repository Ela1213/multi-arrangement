const params = new URLSearchParams(location.search);
const input = document.getElementById("participant-id");
const button = document.getElementById("start");
const status = document.getElementById("entry-status");
input.value = params.get("PROLIFIC_PID") || params.get("participant_id") || "";
if (params.has("PROLIFIC_PID")) input.readOnly = true;

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || "Could not load study");
    document.getElementById("study-name").textContent = config.study_name;
    if (!config.materials_ready) {
      status.textContent = "The formal word list has not been added yet.";
      return;
    }
    button.disabled = false;
    if (params.has("PROLIFIC_PID") || params.has("participant_id")) void begin();
  } catch (error) { status.textContent = error.message; }
}

async function begin() {
  const participantId = input.value.trim();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(participantId)) {
    status.textContent = "Enter a valid participant ID.";
    return;
  }
  button.disabled = true;
  status.textContent = "Creating or restoring your session…";
  try {
    const response = await fetch("/api/participant/start", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ participant_id: participantId,
        prolific_study_id: params.get("STUDY_ID") || "",
        prolific_session_id: params.get("SESSION_ID") || "" }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const next = new URLSearchParams({ invite: data.invite, participant_id: participantId,
      profile: data.profile, version: data.version });
    for (const name of ["PROLIFIC_PID", "STUDY_ID", "SESSION_ID"]) {
      if (params.has(name)) next.set(name, params.get(name));
    }
    location.assign(`/arrange?${next}`);
  } catch (error) {
    status.textContent = `Could not start: ${error.message}`;
    button.disabled = false;
  }
}

button.addEventListener("click", begin);

void loadConfig();
