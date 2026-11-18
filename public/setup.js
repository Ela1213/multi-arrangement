const $ = (id) => document.getElementById(id);
let existingImage = "";
$("researcher-key").value = sessionStorage.getItem("researcher_key") || "";
$("researcher-key").addEventListener("input", () => sessionStorage.setItem("researcher_key", $("researcher-key").value));
function researcherHeaders() { return { "x-researcher-key": $("researcher-key").value.trim() }; }

function setPreset(inputId, value) {
  const input = $(inputId);
  input.value = value ?? "";
  const select = document.querySelector(`select[data-target="${inputId}"]`);
  select.value = [...select.options].some((o) => o.value === String(input.value)) ? String(input.value) : "custom";
}
for (const select of document.querySelectorAll("select[data-target]")) {
  const input = $(select.dataset.target);
  select.addEventListener("change", () => { if (select.value !== "custom") input.value = select.value; else input.focus(); });
  input.addEventListener("input", () => { select.value = [...select.options].some((o) => o.value === input.value) ? input.value : "custom"; });
}
function countWords() { $("word-count").textContent = `${$("words-input").value.split(/\r?\n/).map((w) => w.trim()).filter(Boolean).length} 个词`; }
$("words-input").addEventListener("input", countWords);
$("instruction-file").addEventListener("change", () => { if ($("instruction-file").files.length) $("show-image").checked = true; });
$("words-file").addEventListener("change", async (event) => {
  const file = event.target.files[0]; if (!file) return;
  const contents = await file.text();
  $("words-input").value = file.name.toLowerCase().endsWith(".csv") ? contents.split(/\r?\n/).map((line) => line.split(",")[0]).join("\n") : contents;
  countWords();
});

async function load() {
  const response = await fetch("/api/config");
  const config = await response.json();
  $("study-name-input").value = config.study_name;
  $("words-input").value = config.words.join("\n"); countWords();
  $("instructions-input").value = config.instructions.join("\n\n");
  existingImage = config.instruction_image || "";
  $("show-image").checked = Boolean(existingImage);
  $("image-note").textContent = existingImage ? `当前图片：${existingImage}` : "尚未添加图片";
  $("rdm-method").value = config.ma_config.use_inverse_mds ? "weighted_imds" : "weighted";
  $("subset-method").value = config.ma_config.subset_method || "lift_weakest";
  $("stop-mode").value = config.ma_config.stop_mode || "either";
  setPreset("time-limit", config.ma_config.time_limit_minutes ?? 60);
  setPreset("threshold", config.ma_config.evidence_threshold ?? 0.5);
  setPreset("min-size", config.ma_config.min_subset_size ?? 4);
  setPreset("max-size", config.ma_config.max_subset_size ?? 6);
  setPreset("max-trials", config.ma_config.max_trials ?? "");
  $("completion-url").value = config.completion_url || "";
}

$("setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("save-setup").disabled = true; $("setup-status").textContent = "正在保存材料并创建版本…";
  try {
    const file = $("instruction-file").files[0];
    let imageData = "";
    if (file) imageData = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    const wordImages = await Promise.all([...$("word-images-files").files].map((file) => new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, data: reader.result }); reader.onerror = reject; reader.readAsDataURL(file);
    })));
    const body = {
      study_name: $("study-name-input").value, words: $("words-input").value,
      instructions: $("instructions-input").value,
      instruction_image: $("show-image").checked ? existingImage : "",
      instruction_image_data: $("show-image").checked ? imageData : "",
      word_images_uploads: wordImages,
      clear_word_images: $("clear-word-images").checked,
      rdm_method: $("rdm-method").value, subset_method: $("subset-method").value,
      stop_mode: $("stop-mode").value, time_limit_minutes: $("time-limit").value,
      evidence_threshold: $("threshold").value,
      min_subset_size: $("min-size").value, max_subset_size: $("max-size").value,
      max_trials: $("max-trials").value, completion_url: $("completion-url").value,
    };
    const response = await fetch("/api/researcher/config", { method: "POST", headers: { "content-type": "application/json", ...researcherHeaders() }, body: JSON.stringify(body) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    $("setup-status").textContent = `已保存：${result.word_count} 个词，版本 ${result.version}`;
    const link = $("participant-link"); link.href = result.participant_url; link.textContent = result.participant_url;
    $("setup-result").hidden = false;
    await load();
    $("clear-word-images").checked = false;
  } catch (error) { $("setup-status").textContent = `保存失败：${error.message}`; }
  finally { $("save-setup").disabled = false; }
});

for (const link of document.querySelectorAll(".researcher-export")) link.addEventListener("click", async (event) => {
  event.preventDefault();
  try {
    const response = await fetch(link.href, { headers: researcherHeaders() });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const objectUrl = URL.createObjectURL(await response.blob());
    const download = document.createElement("a");
    download.href = objectUrl; download.download = `arrangement-${link.dataset.format}.${link.dataset.format}`;
    document.body.append(download); download.click(); download.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) { $("setup-status").textContent = `导出失败：${error.message}`; }
});

load().catch((error) => { $("setup-status").textContent = `读取设置失败：${error.message}`; });
