const statusLine = document.getElementById("arrange-status");
const token = new URLSearchParams(location.search).get("invite");
const linkParams = new URLSearchParams(location.search);
const W = 1920, H = 900, CW = 120, CH = 38;
let session, currentTrial, trialStart, topCard = 1, zoom = 1;

function seededRandom(text) {
  let seed = 2166136261;
  for (const char of text) { seed ^= char.charCodeAt(0); seed = Math.imul(seed, 16777619); }
  return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
}
function shuffle(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
function spreadSlots(count, seed) {
  const random = seededRandom(seed);
  if (count <= 20) {
    const offset = random() * Math.PI * 2;
    return Array.from({ length: count }, (_, i) => {
      const a = offset + 2 * Math.PI * i / count;
      return { x: W / 2 + 495 * Math.cos(a) - CW / 2, y: H / 2 + 397 * Math.sin(a) - CH / 2 };
    });
  }
  const candidates = [];
  for (let row = 0, y = 47; y < H - 30; row++, y += 48) {
    for (let x = 75 + (row % 2) * 66; x < W - 45; x += 132) {
      const dx = Math.max(Math.abs(x - W / 2) - CW / 2, 0);
      const dy = Math.max(Math.abs(y - H / 2) - CH / 2, 0);
      if (Math.hypot(dx, dy) >= 370) candidates.push({ x: x - CW / 2, y: y - CH / 2 });
    }
  }
  const pool = shuffle(candidates, random), chosen = [pool.pop()];
  while (chosen.length < count && pool.length) {
    let best = 0, bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      let nearest = Infinity;
      for (const q of chosen) nearest = Math.min(nearest, Math.hypot((p.x - q.x) / 1.15, p.y - q.y));
      const score = nearest + random() * 7;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    chosen.push(pool.splice(best, 1)[0]);
  }
  if (chosen.length !== count) throw new Error(`Only ${chosen.length} safe starting positions for ${count} words`);
  return shuffle(chosen, random);
}
async function api(route, options = {}) {
  const response = await fetch(`/api/ma${route}`, { ...options, headers: { ...(options.headers || {}), "x-participant-invite": token } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || data.error || `HTTP ${response.status}`);
  return data;
}
function setStatus(message) { statusLine.textContent = message; document.getElementById("task-status").textContent = message; }
function insideArena(card, arena) {
  const x = card.offsetLeft + card.offsetWidth / 2 - arena.offsetLeft;
  const y = card.offsetTop + card.offsetHeight / 2 - arena.offsetTop;
  const radius = arena.offsetWidth / 2;
  return Math.hypot(Math.abs(x - radius) + card.offsetWidth / 2,
    Math.abs(y - radius) + card.offsetHeight / 2) <= radius - 3;
}
function updatePlacementProgress() {
  const arena = document.getElementById("arena");
  const cards = [...document.querySelectorAll(".word-card")];
  const placed = cards.filter((card) => insideArena(card, arena)).length;
  document.getElementById("placement-status").textContent = `${placed}/${cards.length} inside`;
  document.getElementById("submit").disabled = placed !== cards.length;
}
function fitWorkspace() {
  if (!currentTrial || currentTrial.is_final) return;
  const frame = document.getElementById("workspace-frame");
  const workspace = document.getElementById("workspace");
  const availableHeight = Math.max(350, window.innerHeight - document.querySelector(".experiment-toolbar").offsetHeight - 42);
  const scale = Math.min(frame.clientWidth / W, availableHeight / H) * zoom;
  frame.style.overflow = zoom > 1.001 ? "auto" : "hidden";
  workspace.style.transform = `scale(${scale})`;
  workspace.style.marginLeft = `${Math.max(0, (frame.clientWidth - W * scale) / 2)}px`;
  frame.style.height = `${Math.ceil(H * scale)}px`;
  document.getElementById("zoom-value").textContent = `${Math.round(zoom * 100)}%`;
}
function drawRays(active) {
  const svg = document.getElementById("distance-rays"), arena = document.getElementById("arena");
  svg.replaceChildren();
  if (!active) return;
  const x1 = active.offsetLeft + active.offsetWidth / 2, y1 = active.offsetTop + active.offsetHeight / 2;
  for (const card of document.querySelectorAll(".word-card")) {
    if (card === active || !insideArena(card, arena)) continue;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1);
    line.setAttribute("x2", card.offsetLeft + card.offsetWidth / 2);
    line.setAttribute("y2", card.offsetTop + card.offsetHeight / 2);
    line.setAttribute("stroke", "#ff956b"); line.setAttribute("stroke-opacity", "0.45"); line.setAttribute("stroke-width", "2");
    svg.append(line);
  }
}
function makeDraggable(card, workspace) {
  let offsetX = 0, offsetY = 0;
  card.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const rect = card.getBoundingClientRect(), scale = rect.width / card.offsetWidth;
    offsetX = (event.clientX - rect.left) / scale; offsetY = (event.clientY - rect.top) / scale;
    card.style.zIndex = String(++topCard); card.setPointerCapture(event.pointerId); card.classList.add("dragging"); drawRays(card);
  });
  card.addEventListener("pointermove", (event) => {
    if (!card.hasPointerCapture(event.pointerId)) return;
    const bounds = workspace.getBoundingClientRect(), scale = bounds.width / workspace.offsetWidth;
    card.style.left = `${Math.max(0, Math.min(workspace.clientWidth - card.offsetWidth, (event.clientX - bounds.left) / scale - offsetX))}px`;
    card.style.top = `${Math.max(0, Math.min(workspace.clientHeight - card.offsetHeight, (event.clientY - bounds.top) / scale - offsetY))}px`;
    drawRays(card);
  });
  for (const eventName of ["pointerup", "pointercancel"]) card.addEventListener(eventName, () => { card.classList.remove("dragging"); drawRays(null); updatePlacementProgress(); });
}
function renderTrial(trial) {
  currentTrial = trial;
  if (trial.is_final) { void completeTask(); return; }
  const workspace = document.getElementById("workspace"), arena = document.getElementById("arena"), cards = document.getElementById("cards");
  cards.replaceChildren(); drawRays(null); topCard = 1;
  const count = trial.subset_indices.length;
  document.getElementById("trial-label").textContent = `Trial ${trial.trial_index + 1} · ${count} words`;
  const random = seededRandom(`${session.session_id}:${trial.trial_index}:labels`);
  const displayOrder = shuffle(trial.subset_indices, random);
  const slots = spreadSlots(count, `${session.session_id}:${trial.trial_index}:slots`);
  displayOrder.forEach((ordinal, place) => {
    const stimulus = session.stimuli.find((item) => item.ordinal === ordinal);
    const card = document.createElement("button"); card.type = "button"; card.className = count > 50 ? "word-card dense" : "word-card";
    card.dataset.ordinal = String(ordinal); card.title = stimulus?.filename || `Word ${ordinal + 1}`;
    if (stimulus?.media_url?.startsWith("/stimuli/")) {
      const image = document.createElement("img"); image.src = stimulus.media_url; image.alt = card.title; image.className = "word-image"; card.append(image);
    } else card.textContent = card.title;
    card.style.left = `${slots[place].x}px`; card.style.top = `${slots[place].y}px`;
    makeDraggable(card, workspace); cards.append(card);
  });
  trialStart = performance.now(); zoom = 1; fitWorkspace(); updatePlacementProgress(); setStatus("");
}
async function completeTask() {
  try {
    const response = await fetch("/api/finish", { method: "POST", headers: { "content-type": "application/json", "x-participant-invite": token },
      body: JSON.stringify({ participant_id: linkParams.get("PROLIFIC_PID") || linkParams.get("participant_id") || "" }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    document.getElementById("task").hidden = true; document.getElementById("done").hidden = false;
    if (result.completion_url) { const link = document.getElementById("prolific-link"); link.href = result.completion_url; link.hidden = false; setTimeout(() => location.assign(result.completion_url), 3000); }
    setStatus("");
  } catch (error) { setStatus(`Could not finish: ${error.message}. Reload to retry.`); }
}
async function initialise() {
  if (!token || !/^[A-Za-z0-9_-]+$/.test(token)) { setStatus("This task needs an individual invitation link."); return; }
  try {
    const response = await fetch("/api/config"), active = await response.json();
    if (!response.ok || !active.materials_ready || linkParams.get("profile") !== active.profile || linkParams.get("version") !== active.version) throw new Error("This link belongs to a different material version. Ask the researcher for a current link.");
    document.getElementById("study-name").textContent = active.study_name;
    const list = document.getElementById("instructions");
    for (const line of active.instructions || []) { const p = document.createElement("p"); p.textContent = line; list.append(p); }
    if (active.instruction_image) {
      const image = document.getElementById("instruction-image");
      image.src = active.instruction_image;
      image.hidden = false;
      document.getElementById("intro").classList.add("has-image");
    }
    document.getElementById("begin").disabled = false; setStatus("");
  } catch (error) { setStatus(`Could not start: ${error.message}`); }
}
document.getElementById("begin").addEventListener("click", async () => {
  document.getElementById("begin").disabled = true;
  try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); } catch { /* Browsers may refuse; task remains usable. */ }
  try {
    session = await api(`/public/invites/${token}/start`, { method: "POST" });
    const trial = await api(`/sessions/${session.session_id}/next`);
    document.getElementById("intro").hidden = true; document.getElementById("task").hidden = false; renderTrial(trial);
  } catch (error) { setStatus(`Could not load arrangement: ${error.message}`); document.getElementById("begin").disabled = false; }
});
document.getElementById("submit").addEventListener("click", async () => {
  const button = document.getElementById("submit"), arena = document.getElementById("arena"), cards = [...document.querySelectorAll(".word-card")];
  if (!cards.every((card) => insideArena(card, arena))) { setStatus("Place every word inside the circle."); return; }
  const positions = Object.fromEntries(cards.map((card) => [card.dataset.ordinal, { x: card.offsetLeft + card.offsetWidth / 2 - arena.offsetLeft, y: card.offsetTop + card.offsetHeight / 2 - arena.offsetTop }]));
  button.disabled = true; setStatus("Saving arrangement…");
  try {
    const result = await api(`/sessions/${session.session_id}/trials`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trial_index: currentTrial.trial_index, subset_indices: currentTrial.subset_indices, positions, arena_size: arena.offsetWidth, duration_seconds: (performance.now() - trialStart) / 1000 }) });
    renderTrial(result.next_trial || await api(`/sessions/${session.session_id}/next`));
  } catch (error) { setStatus(`Could not save: ${error.message}`); }
  finally { if (!document.getElementById("task").hidden) updatePlacementProgress(); }
});
document.getElementById("fullscreen").addEventListener("click", async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch (error) { setStatus(`Full screen unavailable: ${error.message}`); }
});
document.addEventListener("fullscreenchange", fitWorkspace);
for (const [id, change] of [["zoom-out", -0.1], ["zoom-in", 0.1]]) document.getElementById(id).addEventListener("click", () => { zoom = Math.max(0.6, Math.min(1.5, zoom + change)); fitWorkspace(); });
document.getElementById("workspace-frame").addEventListener("wheel", (event) => { event.preventDefault(); zoom = Math.max(0.6, Math.min(1.5, zoom + (event.deltaY > 0 ? -0.05 : 0.05))); fitWorkspace(); }, { passive: false });
window.addEventListener("resize", fitWorkspace);
void initialise();
