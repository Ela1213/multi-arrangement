import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile as readAsync, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MATERIALS = process.env.STUDY_MATERIALS_ROOT || ROOT;
const DATA = process.env.STUDY_DATA_ROOT || path.join(ROOT, "data");
const PROFILE = process.env.STUDY_PROFILE || "demo";
const WORD_FILE = { demo: "words.demo.txt", bi90: "words.bi90-reference.txt", formal: "words.txt" }[PROFILE];
if (!WORD_FILE) throw new Error("STUDY_PROFILE must be demo, bi90 or formal");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3100);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${PORT}`;
if (process.env.APP_ENV === "production" && !PUBLIC_BASE_URL.startsWith("https://")) throw new Error("PUBLIC_BASE_URL must be HTTPS in production");
const MA_ORIGIN = process.env.MA_API_ORIGIN || "http://127.0.0.1:8000";
const MA_KEY = process.env.MA_EXPERIMENTER_KEY ||
  (process.env.MA_EXPERIMENTER_KEY_FILE ? readFileSync(process.env.MA_EXPERIMENTER_KEY_FILE, "utf8").trim() : "");
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const RESEARCHER_ADMIN_KEY = process.env.RESEARCHER_ADMIN_KEY || "";
if (process.env.APP_ENV === "production" && !RESEARCHER_ADMIN_KEY) throw new Error("RESEARCHER_ADMIN_KEY is required in production");
const attempts = new Map();
await mkdir(DATA, { recursive: true });
const db = new DatabaseSync(path.join(DATA, "participants.sqlite3"));
db.exec(`CREATE TABLE IF NOT EXISTS participants (
  profile TEXT NOT NULL, version TEXT NOT NULL, participant_id TEXT NOT NULL,
  prolific_study_id TEXT NOT NULL, prolific_session_id TEXT NOT NULL,
  invite_token TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(profile, version, participant_id)
)`);

function equal(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && timingSafeEqual(x, y);
}
function researcherAllowed(req) {
  if (RESEARCHER_ADMIN_KEY) return equal(req.headers["x-researcher-key"], RESEARCHER_ADMIN_KEY);
  return /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || "");
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  res.writeHead(status, { "content-type": type, "content-length": data.length,
    "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" });
  res.end(data);
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 15000000) throw new Error("Request body too large");
  }
  return JSON.parse(body || "{}");
}

async function material() {
  const wordsText = await readAsync(path.join(MATERIALS, WORD_FILE), "utf8");
  const configText = await readAsync(path.join(MATERIALS, "arrangement.config.json"), "utf8");
  const overrideText = PROFILE === "bi90" ? await readAsync(path.join(MATERIALS, "arrangement.bi90.config.json"), "utf8") : "";
  const imagesText = await readAsync(path.join(MATERIALS, "word-images.json"), "utf8");
  const words = wordsText.split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith("#"));
  if (words.length && (words.length < 3 || new Set(words.map((x) => x.toLowerCase())).size !== words.length)) {
    throw new Error("Word list needs at least three unique words");
  }
  if (PROFILE === "bi90" && words.length !== 90) throw new Error("bi90 reference requires exactly 90 words");
  const base = JSON.parse(configText);
  const override = overrideText ? JSON.parse(overrideText) : {};
  const wordImages = JSON.parse(imagesText);
  const hash = createHash("sha256").update(PROFILE + "\n" + wordsText + "\n" + configText +
    (overrideText ? "\n" + overrideText : "") + (imagesText ? "\n" + imagesText : ""));
  for (const [word, filename] of Object.entries(wordImages).sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(`\n${word}\0${filename}\0`);
    hash.update(await readAsync(path.join(MATERIALS, "public", "stimuli", filename)));
  }
  const instructionImage = override.instruction_image ?? base.instruction_image;
  if (instructionImage) hash.update(await readAsync(path.join(MATERIALS, "public", path.basename(instructionImage))));
  // v2 prevents a legacy manifest from reusing this material hash with the wrong stimuli.
  hash.update("material-binding-v2");
  const version = hash.digest("hex").slice(0, 16);
  return { ...base, ...override, ma_config: { ...base.ma_config, ...(override.ma_config || {}) },
    profile: PROFILE, version, words, word_images: wordImages, materials_ready: words.length >= 3 };
}

async function manifest(version) {
  const value = JSON.parse(await readAsync(path.join(DATA, `study-manifest.${PROFILE}.json`), "utf8"));
  const current = await material();
  if (value.version !== version || value.profile !== PROFILE ||
      JSON.stringify(value.words) !== JSON.stringify(current.words)) {
    throw new Error("Study version is not prepared for the current word list");
  }
  return value;
}

function participant(pid, version) {
  return db.prepare("SELECT * FROM participants WHERE profile=? AND version=? AND participant_id=?")
    .get(PROFILE, version, pid);
}

function participantForToken(token, version) {
  return db.prepare("SELECT * FROM participants WHERE profile=? AND version=? AND invite_token=?")
    .get(PROFILE, version, token);
}

async function ma(route, { method = "GET", body, admin = false } = {}) {
  let response;
  try {
    response = await fetch(`${MA_ORIGIN}/api/v1${route}`, {
      method, headers: { ...(body ? { "content-type": "application/json" } : {}),
        ...(admin && MA_KEY ? { "x-experimenter-key": MA_KEY } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Arrangement backend unavailable; contact the researcher");
  }
  const data = await response.json();
  if (!response.ok) throw new Error(`Arrangement API ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

function tooManyStarts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((time) => now - time < 3600000);
  list.push(now);
  attempts.set(ip, list);
  return list.length > 40;
}

function validResearcherConfig(body) {
  const words = String(body.words || "").split(/\r?\n/).map((w) => w.trim()).filter(Boolean);
  if (words.length < 3 || words.length > 150 || new Set(words.map((w) => w.toLowerCase())).size !== words.length) {
    throw new Error("Enter 3–150 unique words, one per line");
  }
  if (words.some((w) => w.length > 45 || /[<>]/.test(w))) throw new Error("Each word must be at most 45 characters, without angle brackets");
  const min = Number(body.min_subset_size), max = Number(body.max_subset_size);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 3 || max < min || max > words.length) {
    throw new Error("Subset size must be 3 to the word count, with minimum ≤ maximum");
  }
  const minutes = Number(body.time_limit_minutes), threshold = Number(body.evidence_threshold);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 240 || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("Time must be 0–240 minutes and threshold must be 0–1");
  }
  const stopMode = String(body.stop_mode);
  if (!["time", "threshold", "either"].includes(stopMode)) throw new Error("Unknown stopping rule");
  const method = String(body.rdm_method);
  if (!["weighted", "weighted_imds"].includes(method)) throw new Error("Unknown RDM method");
  if (!["lift_weakest", "lift_weakest_unbounded"].includes(body.subset_method)) throw new Error("Unknown subset method");
  const maxTrials = body.max_trials === "" || body.max_trials == null ? null : Number(body.max_trials);
  if (maxTrials !== null && (!Number.isInteger(maxTrials) || maxTrials < 1 || maxTrials > 500)) throw new Error("Maximum rounds must be 1–500 or blank");
  const url = String(body.completion_url || "").trim();
  if (url) {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol) || (parsed.protocol === "http:" && !["localhost", "127.0.0.1"].includes(parsed.hostname))) {
      throw new Error("Completion URL must be HTTPS, or a local HTTP URL for testing");
    }
  }
  const instructions = String(body.instructions || "").trim();
  if (instructions.length < 20 || instructions.length > 10000) throw new Error("Instructions must contain 20–10000 characters");
  const imageData = body.instruction_image_data || "";
  if (imageData && !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(imageData)) throw new Error("Use a PNG or JPEG instruction image");
  if (body.instruction_image && !/^\/(instruction-reference\.png|instruction-[a-f0-9]{16}\.(png|jpg))$/.test(String(body.instruction_image))) {
    throw new Error("Instruction image must come from this study");
  }
  return { words, min, max, minutes, threshold, stopMode, method, maxTrials, url, instructions, imageData };
}

async function saveResearcherConfig(body) {
  const v = validResearcherConfig(body);
  const oldWords = await readAsync(path.join(MATERIALS, WORD_FILE), "utf8");
  const oldConfig = await readAsync(path.join(MATERIALS, "arrangement.config.json"), "utf8");
  const oldImages = await readAsync(path.join(MATERIALS, "word-images.json"), "utf8");
  const config = JSON.parse(oldConfig);
  const nextImages = body.clear_word_images ? {} : Object.fromEntries(Object.entries(JSON.parse(oldImages)).filter(([word]) => v.words.includes(word)));
  const uploads = body.word_images_uploads || [];
  if (!Array.isArray(uploads) || uploads.length > v.words.length) throw new Error("Too many word images");
  const uploaded = new Set();
  for (const item of uploads) {
    const stem = path.parse(String(item.name || "")).name.toLowerCase();
    const word = v.words.find((w) => w.toLowerCase() === stem);
    if (!word || uploaded.has(word)) throw new Error(`Image name does not match one unique word: ${item.name}`);
    uploaded.add(word);
    const matched = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(item.data || ""));
    if (!matched) throw new Error(`Use PNG, JPEG or WebP for ${word}`);
    const bytes = Buffer.from(matched[2], "base64");
    if (!bytes.length || bytes.length > 1500000) throw new Error(`Image for ${word} must be at most 1.5 MB`);
    const ext = matched[1] === "jpeg" ? "jpg" : matched[1];
    const filename = createHash("sha256").update(word + "\0").update(bytes).digest("hex").slice(0, 20) + "." + ext;
    await mkdir(path.join(MATERIALS, "public", "stimuli"), { recursive: true });
    await writeFile(path.join(MATERIALS, "public", "stimuli", filename), bytes);
    nextImages[word] = filename;
  }
  config.study_name = String(body.study_name || "Word meaning arrangement").trim().slice(0, 120);
  config.ma_instructions = v.instructions.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  config.completion_url = v.url;
  config.instruction_image = String(body.instruction_image || "");
  if (v.imageData) {
    const bytes = Buffer.from(v.imageData.split(",")[1], "base64");
    if (bytes.length > 1500000) throw new Error("Instruction image exceeds 1.5 MB");
    const extension = v.imageData.startsWith("data:image/png") ? "png" : "jpg";
    const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const filename = `instruction-${digest}.${extension}`;
    await writeFile(path.join(MATERIALS, "public", filename), bytes);
    config.instruction_image = `/${filename}`;
  }
  config.ma_config = { ...config.ma_config,
    time_limit_minutes: v.stopMode === "threshold" ? null : v.minutes,
    evidence_threshold: v.threshold, stop_mode: v.stopMode,
    min_subset_size: v.min, max_subset_size: body.subset_method === "lift_weakest_unbounded" ? v.words.length : v.max,
    subset_method: body.subset_method,
    skip_initial: false, use_inverse_mds: v.method === "weighted_imds",
    max_trials: v.maxTrials,
  };
  await writeFile(path.join(MATERIALS, WORD_FILE), v.words.join("\n") + "\n");
  await writeFile(path.join(MATERIALS, "arrangement.config.json"), JSON.stringify(config, null, 2) + "\n");
  await writeFile(path.join(MATERIALS, "word-images.json"), JSON.stringify(nextImages, null, 2) + "\n");
  try {
    execFileSync(process.env.PYTHON_BIN || "python3", [path.join(ROOT, "prepare_study.py")],
      { cwd: ROOT, env: process.env, timeout: 120000, encoding: "utf8" });
  } catch (error) {
    await writeFile(path.join(MATERIALS, WORD_FILE), oldWords);
    await writeFile(path.join(MATERIALS, "arrangement.config.json"), oldConfig);
    await writeFile(path.join(MATERIALS, "word-images.json"), oldImages);
    throw new Error(`Could not create study: ${String(error.stderr || error.message).slice(0, 500)}`);
  }
  const current = await material();
  return { version: current.version, word_count: current.words.length,
    participant_url: process.env.APP_ENV === "production" ? `${PUBLIC_BASE_URL}/` : `${PUBLIC_BASE_URL}/?participant_id=PILOT001` };
}

async function start(body) {
  const pid = String(body.participant_id || "");
  const studyId = String(body.prolific_study_id || "");
  const sessionId = String(body.prolific_session_id || "");
  if (!ID.test(pid) || (studyId && !ID.test(studyId)) || (sessionId && !ID.test(sessionId))) throw new Error("Invalid participant identifiers");
  if (process.env.APP_ENV === "production" && (!/^[a-f0-9]{24}$/i.test(pid) || !studyId || !sessionId)) {
    throw new Error("Open the complete link from Qualtrics or Prolific");
  }
  const current = await material();
  if (!current.materials_ready) throw new Error("Word list is not ready");
  if (process.env.APP_ENV === "production" && !current.completion_url) {
    throw new Error("Researcher must configure the completion URL before recruitment");
  }
  const info = await manifest(current.version);
  let row = participant(pid, current.version);
  if (row && (row.prolific_study_id !== studyId || row.prolific_session_id !== sessionId)) {
    throw new Error("This participant ID belongs to a different Prolific session");
  }
  if (!row) {
    const invites = await ma(`/admin/studies/${info.study_id}/invites`, {
      method: "POST", body: { participant_id: pid, count: 1 }, admin: true,
    });
    db.prepare(`INSERT OR IGNORE INTO participants
      (profile, version, participant_id, prolific_study_id, prolific_session_id, invite_token, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(PROFILE, current.version, pid, studyId, sessionId,
        invites[0].token, new Date().toISOString());
    row = participant(pid, current.version);
  }
  return { participant_id: pid, profile: PROFILE, version: current.version, invite: row.invite_token };
}

const assets = {
  "/": ["public/entry.html", "text/html; charset=utf-8"],
  "/entry.js": ["public/entry.js", "text/javascript; charset=utf-8"],
  "/arrange": ["public/arrange.html", "text/html; charset=utf-8"],
  "/arrange.js": ["public/arrange.js", "text/javascript; charset=utf-8"],
  "/style.css": ["public/style.css", "text/css; charset=utf-8"],
  "/setup": ["public/setup.html", "text/html; charset=utf-8"],
  "/setup.js": ["public/setup.js", "text/javascript; charset=utf-8"],
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (req.method === "GET" && url.pathname === "/api/health") {
      try {
        const backend = await fetch(`${MA_ORIGIN}/health/db`, { signal: AbortSignal.timeout(3000) });
        if (!backend.ok) throw new Error("Backend database unavailable");
        return send(res, 200, { status: "ok", profile: PROFILE, backend: "ok" });
      } catch {
        return send(res, 503, { status: "error", profile: PROFILE, backend: "unavailable" });
      }
    }
    if (req.method === "GET" && url.pathname === "/api/config") {
      const current = await material();
      return send(res, 200, { study_name: current.study_name, profile: PROFILE,
        version: current.version, words: current.words, instructions: current.ma_instructions,
        instruction_image: current.instruction_image || "", completion_url: current.completion_url || "",
        ma_config: current.ma_config, production: process.env.APP_ENV === "production",
        materials_ready: current.materials_ready });
    }
    if (req.method === "POST" && url.pathname === "/api/researcher/config") {
      if (!researcherAllowed(req)) return send(res, 403, { error: "Researcher authentication required" });
      try { return send(res, 200, await saveResearcherConfig(await readBody(req))); }
      catch (error) { return send(res, 400, { error: error.message }); }
    }
    if (req.method === "GET" && url.pathname === "/api/researcher/export") {
      if (!researcherAllowed(req)) return send(res, 403, { error: "Researcher authentication required" });
      const current = await material();
      const info = await manifest(current.version);
      const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
      const response = await fetch(`${MA_ORIGIN}/api/v1/studies/${info.study_id}/export?format=${format}`,
        { headers: { "x-experimenter-key": MA_KEY } });
      if (!response.ok) throw new Error(`Export failed: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      res.setHeader("content-disposition", `attachment; filename=arrangement-${current.version}.${format}`);
      return send(res, 200, bytes, format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8");
    }
    if (req.method === "POST" && url.pathname === "/api/participant/start") {
      if (tooManyStarts(req.socket.remoteAddress || "unknown")) return send(res, 429, { error: "Too many start attempts" });
      try { return send(res, 200, await start(await readBody(req))); }
      catch (error) { return send(res, 400, { error: error.message }); }
    }
    if (url.pathname.startsWith("/api/ma/")) {
      const route = url.pathname.slice("/api/ma".length);
      const permitted = [
        ["POST", /^\/public\/invites\/[A-Za-z0-9_-]+\/start$/],
        ["GET", /^\/sessions\/[0-9a-f-]+\/next$/],
        ["POST", /^\/sessions\/[0-9a-f-]+\/trials$/],
        ["GET", /^\/studies\/[0-9a-f-]+$/],
      ].some(([method, expression]) => req.method === method && expression.test(route));
      if (!permitted) return send(res, 404, { error: "Unknown arrangement route" });
      const token = String(req.headers["x-participant-invite"] || "");
      const current = await material();
      const row = participantForToken(token, current.version);
      if (!row) return send(res, 403, { error: "Invalid invitation" });
      if (route.includes("/invites/") && route !== `/public/invites/${token}/start`) return send(res, 403, { error: "Wrong invitation" });
      if (route.includes("/sessions/")) {
        const session = await ma(`/public/invites/${token}/start`, { method: "POST" });
        if (!route.startsWith(`/sessions/${session.session_id}/`)) return send(res, 403, { error: "Wrong session" });
      }
      if (route.startsWith("/studies/")) {
        const info = await manifest(current.version);
        if (route !== `/studies/${info.study_id}`) return send(res, 403, { error: "Wrong study" });
      }
      const body = req.method === "POST" && route.endsWith("/trials") ? await readBody(req) : undefined;
      const data = await ma(route, { method: req.method, body });
      return send(res, 200, data);
    }
    if (req.method === "POST" && url.pathname === "/api/finish") {
      const body = await readBody(req);
      const pid = String(body.participant_id || "");
      const current = await material();
      const row = participant(pid, current.version);
      const token = String(req.headers["x-participant-invite"] || "");
      if (!row || !equal(token, row.invite_token)) return send(res, 403, { error: "Invalid invitation" });
      const session = await ma(`/public/invites/${token}/start`, { method: "POST" });
      const next = await ma(`/sessions/${session.session_id}/next`);
      if (!next.is_final) return send(res, 409, { error: "Please complete the arrangement task first" });
      await ma(`/sessions/${session.session_id}/complete`, { method: "POST" });
      return send(res, 200, { completed: true, completion_url: current.completion_url || "" });
    }
    if (req.method === "GET" && assets[url.pathname]) {
      const [name, type] = assets[url.pathname];
      return send(res, 200, await readAsync(path.join(ROOT, name)), type);
    }
    if (req.method === "GET" && /^\/instruction-[a-f0-9]{16}\.(png|jpg)$/.test(url.pathname)) {
      return send(res, 200, await readAsync(path.join(MATERIALS, "public", path.basename(url.pathname))),
        url.pathname.endsWith(".png") ? "image/png" : "image/jpeg");
    }
    if (req.method === "GET" && url.pathname === "/instruction-reference.png") {
      return send(res, 200, await readAsync(path.join(MATERIALS, "public", "instruction-reference.png")), "image/png");
    }
    if (req.method === "GET" && /^\/stimuli\/[A-Za-z0-9_.-]+\.(png|jpe?g|webp)$/i.test(url.pathname)) {
      const name = path.basename(url.pathname);
      const ext = path.extname(name).toLowerCase();
      const type = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      return send(res, 200, await readAsync(path.join(MATERIALS, "public", "stimuli", name)), type);
    }
    return send(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: "The study server encountered an error" });
  }
});

server.listen(PORT, HOST, () => console.log(`Arrangement study: http://${HOST}:${PORT}`));
