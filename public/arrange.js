const statusLine = document.getElementById("arrange-status");
const token = new URLSearchParams(location.search).get("invite");
const linkParams = new URLSearchParams(location.search);
const W = 1920, H = 900, CW = 120, CH = 38;
let session, currentTrial, trialStart, topCard = 1, zoom = 1, timeLimitMinutes = 60, sessionStart = 0;

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
  // Evenly spaced staggered slots in a narrow band around the circle.
  const candidates = [];
  for (let row = 0, y = 12; y <= 864; row++, y += 38) {
    for (let x = 10 + (row % 2) * 55; x <= 1810; x += 110) {
      const dx = Math.max(Math.abs(x + 54 - W / 2) - 54, 0);
      const dy = Math.max(Math.abs(y + 13 - H / 2) - 13, 0);
      const distance = Math.hypot(dx, dy);
      if (distance >= 435 && distance <= 630) candidates.push({ x, y, score: distance + random() * 12 });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  if (candidates.length < count) throw new Error(`Only ${candidates.length} starting positions for ${count} words`);
  return shuffle(candidates.slice(0, count), random);
}
function placeSubsetCards(cards, arena, seed) {
  const items = [...cards.children];
  const offset = seededRandom(seed)() * Math.PI * 2;
  const cx = arena.offsetLeft + arena.offsetWidth / 2;
  const cy = arena.offsetTop + arena.offsetHeight / 2;
  // The smaller subset arena leaves room above and below for complete cards.
  const rx = 475, ry = 420;
  items.forEach((card, i) => {
    const angle = offset + 2 * Math.PI * i / items.length;
    card.style.left = `${Math.round(cx + rx * Math.cos(angle) - card.offsetWidth / 2)}px`;
    card.style.top = `${Math.round(cy + ry * Math.sin(angle) - card.offsetHeight / 2)}px`;
  });
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
  const scale = Math.min(frame.clientWidth / W, frame.clientHeight / H) * zoom;
  frame.style.overflow = zoom > 1.001 ? "auto" : "hidden";
  workspace.style.transform = `scale(${scale})`;
  workspace.style.marginLeft = `${Math.max(0, (frame.clientWidth - W * scale) / 2)}px`;

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
const selectedCards = new Set();
function setSelection(cards) {
  selectedCards.clear();
  for (const card of cards) selectedCards.add(card);
  for (const card of document.querySelectorAll(".word-card")) card.classList.toggle("selected", selectedCards.has(card));

}
function makeDraggable(card, workspace) {
  let startX, startY, starts, scale;
  card.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    if (!selectedCards.has(card)) setSelection([card]);
    const bounds = workspace.getBoundingClientRect(); scale = bounds.width / workspace.offsetWidth;
    startX = event.clientX; startY = event.clientY;
    starts = [...selectedCards].map(c => ({ card: c, x: c.offsetLeft, y: c.offsetTop }));
    for (const item of starts) { item.card.classList.add("dragging"); item.card.style.zIndex = String(++topCard); }
    card.setPointerCapture(event.pointerId); drawRays(card);
  });
  card.addEventListener("pointermove", (event) => {
    if (!card.hasPointerCapture(event.pointerId) || !starts) return;
    const dx = (event.clientX - startX) / scale, dy = (event.clientY - startY) / scale;
    const minX = Math.max(...starts.map(item => -item.x));
    const maxX = Math.min(...starts.map(item => workspace.clientWidth - item.card.offsetWidth - item.x));
    const minY = Math.max(...starts.map(item => -item.y));
    const maxY = Math.min(...starts.map(item => workspace.clientHeight - item.card.offsetHeight - item.y));
    for (const item of starts) {
      item.card.style.left = `${item.x + Math.max(minX, Math.min(maxX, dx))}px`;
      item.card.style.top = `${item.y + Math.max(minY, Math.min(maxY, dy))}px`;
    }
    drawRays(card); updatePlacementProgress();
  });
  for (const name of ["pointerup", "pointercancel"]) card.addEventListener(name, () => {
    if (!starts) return;
    for (const item of starts) item.card.classList.remove("dragging");
    starts = null; drawRays(null); updatePlacementProgress();
  });
}
function enableMarquee(workspace) {
  const box = document.getElementById("selection-box");
  let origin = null;
  workspace.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".word-card")) return;
    event.preventDefault();
    const bounds = workspace.getBoundingClientRect(), scale = bounds.width / workspace.offsetWidth;
    origin = { x: (event.clientX - bounds.left) / scale, y: (event.clientY - bounds.top) / scale };
    workspace.setPointerCapture(event.pointerId);
    box.hidden = false; box.style.left = `${origin.x}px`; box.style.top = `${origin.y}px`;
    box.style.width = "0px"; box.style.height = "0px";
    setSelection([]);
  });
  workspace.addEventListener("pointermove", (event) => {
    if (!origin || !workspace.hasPointerCapture(event.pointerId)) return;
    const bounds = workspace.getBoundingClientRect(), scale = bounds.width / workspace.offsetWidth;
    const x = (event.clientX - bounds.left) / scale, y = (event.clientY - bounds.top) / scale;
    const left = Math.max(0, Math.min(origin.x, x)), top = Math.max(0, Math.min(origin.y, y));
    const right = Math.min(W, Math.max(origin.x, x)), bottom = Math.min(H, Math.max(origin.y, y));
    Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${right-left}px`, height: `${bottom-top}px` });
    setSelection([...document.querySelectorAll(".word-card")].filter(c => c.offsetLeft < right && c.offsetLeft+c.offsetWidth > left && c.offsetTop < bottom && c.offsetTop+c.offsetHeight > top));
  });
  for (const name of ["pointerup", "pointercancel"]) workspace.addEventListener(name, () => { origin = null; box.hidden = true; });
}
function renderTrial(trial) {
  currentTrial = trial;
  if (trial.is_final) { void completeTask(); return; }
  const workspace = document.getElementById("workspace"), arena = document.getElementById("arena"), cards = document.getElementById("cards");
  cards.replaceChildren(); drawRays(null); topCard = 1; setSelection([]);
  const count = trial.subset_indices.length;
  arena.classList.toggle("subset-arena", count <= 25);
  document.getElementById("trial-label").textContent = `Round ${trial.trial_index + 1}`;
  const random = seededRandom(`${session.session_id}:${trial.trial_index}:labels`);
  const displayOrder = shuffle(trial.subset_indices, random);
  const slots = count > 25 ? spreadSlots(count, `${session.session_id}:${trial.trial_index}:slots`) : null;
  displayOrder.forEach((ordinal, place) => {
    const stimulus = session.stimuli.find((item) => item.ordinal === ordinal);
    const card = document.createElement("button"); card.type = "button"; card.className = count > 50 ? "word-card dense" : "word-card";
    card.dataset.ordinal = String(ordinal); card.title = stimulus?.filename || `Word ${ordinal + 1}`;
    if (stimulus?.media_url?.startsWith("/stimuli/")) {
      const image = document.createElement("img"); image.src = stimulus.media_url; image.alt = card.title; image.className = "word-image"; card.append(image);
    } else card.textContent = card.title;
    if (slots) { card.style.left = `${slots[place].x}px`; card.style.top = `${slots[place].y}px`; }
    makeDraggable(card, workspace); cards.append(card);
  });
  if (!slots) placeSubsetCards(cards, arena, `${session.session_id}:${trial.trial_index}:slots`);
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
    document.getElementById("study-name").textContent = "Similarity Arrangement Experiment";
    timeLimitMinutes = active.ma_config?.time_limit_minutes || 60;
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
    sessionStart = session.created_at ? new Date(session.created_at).getTime() : Date.now();
    if (!Number.isFinite(sessionStart)) sessionStart = Date.now();
    updateTimer();
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
function updateTimer() {
  if (!sessionStart) return;
  const seconds = Math.max(0, Math.ceil(timeLimitMinutes * 60 - (Date.now() - sessionStart) / 1000));
  document.getElementById("remaining-time").textContent = `${String(Math.floor(seconds / 60)).padStart(2,"0")}:${String(seconds % 60).padStart(2,"0")} remaining`;
}
setInterval(updateTimer, 1000);
enableMarquee(document.getElementById("workspace"));
void initialise();
