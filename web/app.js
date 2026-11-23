/* Clara Writer: editor logic
 * Copyright (C) 2026 Francesco Bonomelli. GNU GPL v3, see LICENSE.
 * Every text the user sees or hears comes from lang/<code>.json (see t()).
 */
"use strict";

const $ = (id) => document.getElementById(id);
const editor = $("editor"), backdrop = $("backdrop"), ask = $("ask"), answer = $("answer");
const claudeBar = $("claude"), overlay = $("overlay"), list = $("list"), field = $("field");

/* ------------------------------------------------------------ language */

let L = { ui: {}, dictation: { rules: [] }, speech: "en-US" };
let languages = [];
let langCode = "en";
let FOLDERS = { articles: "Articles", books: "Books" };   // names of the folders in this workspace

function t(key, vars) {
  let s = (L.ui && L.ui[key]) || key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split("{" + k + "}").join(String(v));
  return s;
}

function applyLanguage(info) {
  L = info.pack; languages = info.available; langCode = info.code; FOLDERS = info.folders || FOLDERS;
  document.documentElement.lang = langCode;
  editor.lang = ask.lang = field.lang = langCode;
  editor.placeholder = t("placeholderEditor");
  ask.placeholder = t("placeholderAsk");
  $("send").textContent = t("send");
  $("working").textContent = t("working");
  $("keys").innerHTML = (L.ui.buttons || []).map((b) =>
    `<button type="button" data-action="${esc(b.id)}" title="${esc(b.key)}">${esc(b.label)}<small>${esc(b.key)}</small></button>`).join("");
  pickVoice();
  updateInfo();
}

/* ------------------------------------------------------------ settings */

const DEFAULTS = { fs: 36, lh: 1.8, font: 0, theme: 0, rate: 1, autoRead: true, bar: true, keys: true, last: "" };
const FONTS = ['"Clara Atkinson", Verdana, sans-serif', "Verdana, sans-serif", "Arial, sans-serif"];
const FONT_NAMES = ["Atkinson", "Verdana", "Arial"];
const THEMES = ["theme-yellow", "theme-white", "theme-cream"];
const RATES = [0.8, 1, 1.2, 1.4, 1.6];

let prefs = { ...DEFAULTS };
try {
  const old = localStorage.getItem("scrittoio");          // settings of the first Italian version
  prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem("clarawriter") || old || "{}") };
  if (prefs.tema !== undefined && prefs.theme === undefined) prefs.theme = prefs.tema;
  if (prefs.velocita !== undefined) prefs.rate = prefs.velocita;
  if (prefs.ultimo !== undefined && !prefs.last) prefs.last = prefs.ultimo;
} catch (e) { /* nothing */ }
function savePrefs() { try { localStorage.setItem("clarawriter", JSON.stringify(prefs)); } catch (e) { /* nothing */ } }

function applyPrefs() {
  const r = document.documentElement.style;
  r.setProperty("--fs", prefs.fs + "px");
  r.setProperty("--lh", prefs.lh);
  r.setProperty("--font", FONTS[prefs.font] || FONTS[0]);
  document.body.className = THEMES[prefs.theme] || THEMES[0];
  claudeBar.classList.toggle("hidden", !prefs.bar);
  $("keys").classList.toggle("hidden", !prefs.keys);
  draw();
}

/* ------------------------------------------------------------ state */

let current = "";            // relative path of the open file
let dirty = false;
let busy = false;
let changedLines = new Set(); // lines changed by Claude
let saveTimer = null;

function label(p) {
  if (!p) return t("noTextOpen");
  const parts = p.split("/");
  const name = parts.at(-1).replace(/\.md$/, "");
  if (parts.length >= 3 && parts[0] === FOLDERS.books) return t("labelBook", { book: parts[1], name });
  if (parts[0] === FOLDERS.articles) return t("labelArticle", { name });
  return name;
}
const spokenLabel = (p) => label(p).replace("›", ",");
const bookOf = (p) => { const s = (p || "").split("/"); return s.length >= 3 && s[0] === FOLDERS.books ? s[1] : ""; };

/* ------------------------------------------------------------ server */

async function api(path, data) {
  const opts = data === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || t("genericError"));
  return j;
}
function logToServer(msg) {
  try { fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ msg }) }); } catch (e) { /* nothing */ }
}

/* ------------------------------------------------------------ voice: reading */

let voice = null;
function pickVoice() {
  if (!("speechSynthesis" in window)) return;
  const lang = (L.speech || "en-US").toLowerCase(), base = lang.slice(0, 2);
  const all = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith(base));
  const preferred = (L.preferredVoices || []).map((n) => n.toLowerCase());
  voice = all.find((v) => /natural/i.test(v.name) && preferred.some((n) => v.name.toLowerCase().includes(n)))
       || all.find((v) => /natural|online/i.test(v.name) && v.lang.toLowerCase() === lang)
       || all.find((v) => /natural|online/i.test(v.name)) || all[0] || null;
}
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = pickVoice;

const plain = (s) => s
  .replace(/```[\s\S]*?```/g, " ")
  .replace(/^#{1,6}\s*/gm, "")
  .replace(/[*_`>|~]+/g, "")
  .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/^\s*[-•]\s+/gm, "")
  .replace(/[ \t]+/g, " ")
  .trim();

function utterance(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = L.speech || "en-US"; if (voice) u.voice = voice; u.rate = prefs.rate;
  return u;
}

function speak(text, then) {
  if (!("speechSynthesis" in window) || !text) { if (then) then(); return; }
  speechSynthesis.cancel();
  const parts = (plain(text).match(/[^.!?;\n]+[.!?;]*|\n+/g) || []).map((s) => s.trim()).filter(Boolean);
  parts.forEach((p, i) => {
    const u = utterance(p);
    if (i === parts.length - 1 && then) u.onend = then;
    speechSynthesis.speak(u);
  });
}
function hush() { if ("speechSynthesis" in window) speechSynthesis.cancel(); reading = null; }

/* reads the text from the cursor on, sentence by sentence, selecting each sentence */
let reading = null;
function readFromCursor() {
  if (reading) { hush(); beep("stop"); return; }
  const text = editor.value, pos = editor.selectionStart, sentences = [];
  const re = /[^.!?\n]+[.!?]*["»”]?/g;
  let m;
  while ((m = re.exec(text))) {
    if (m.index + m[0].length <= pos) continue;
    const from = Math.max(m.index, pos), to = m.index + m[0].length;
    const s = plain(text.slice(from, to));
    if (s) sentences.push({ from, to, s });
  }
  if (!sentences.length) { notice(t("nothingToRead")); return; }
  speechSynthesis.cancel();
  reading = { sentences };
  sentences.forEach((x, i) => {
    const u = utterance(x.s);
    u.onstart = () => { if (reading) { editor.focus(); editor.setSelectionRange(x.from, x.to); centre(); draw(); } };
    if (i === sentences.length - 1) u.onend = () => { reading = null; };
    speechSynthesis.speak(u);
  });
}

/* ------------------------------------------------------------ voice: dictation */

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null, target = null, dictating = false, restarts = 0, heard = false;

function fixDictation(s) {
  for (const [pattern, replacement] of (L.dictation.rules || [])) {
    s = s.replace(new RegExp("\\b(" + pattern + ")\\b", "giu"), replacement.replace(/\\n/g, "\n"));
  }
  const q = L.dictation.quotes || ["“", "”"];
  return s.replace(/\s+([,.;:?!])/g, "$1")
    .split(q[0] + " ").join(q[0]).split(" " + q[1]).join(q[1])
    .replace(/[ \t]*\n[ \t]*/g, "\n").trim();
}

function insertText(el, fragment) {
  const s = el.selectionStart, e = el.selectionEnd, before = el.value.slice(0, s);
  let f = fragment;
  if (!/^[,.;:?!\n]/.test(f) && before && !/[\s«“(]$/.test(before)) f = " " + f;
  if (!before.trim() || /[.!?]\s*$/.test(before) || /\n\s*$/.test(before)) f = f.replace(/^(\s*)(\p{L})/u, (_, a, b) => a + b.toUpperCase());
  el.setRangeText(f, s, e, "end");
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function newRecognizer() {
  const r = new Recognition();
  r.lang = L.speech || "en-US"; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
  r.onstart = () => logToServer("dictation: started (" + r.lang + ")");
  r.onaudiostart = () => logToServer("dictation: microphone on");
  r.onspeechstart = () => { heard = true; logToServer("dictation: voice detected"); };
  r.onresult = (ev) => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const res = ev.results[i];
      if (res.isFinal) {
        const s = fixDictation(res[0].transcript);
        logToServer("dictation: text received (" + s.length + " characters)");
        if (s) insertText(target, s);
      } else interim += res[0].transcript;
    }
    showNotice("🎤 " + (interim || t("listening")));
  };
  r.onerror = (ev) => {
    logToServer("dictation: error " + ev.error + (ev.message ? " " + ev.message : ""));
    const stopWith = { "not-allowed": "micNotAllowed", "service-not-allowed": "micNotAllowed", network: "dictNoService", "audio-capture": "noMic" }[ev.error];
    if (stopWith) { dictating = false; notice(t(stopWith), true, 6000); }
  };
  r.onend = () => {
    logToServer("dictation: stopped");
    if (dictating && restarts < 30) {          // long pause: start again by itself
      restarts++;
      try { recognizer = newRecognizer(); recognizer.start(); return; } catch (e) { logToServer("dictation: restart failed " + e); }
    }
    recognizer = null; dictating = false; hideNotice();
  };
  return r;
}

function startDictation() {
  if (!Recognition) { logToServer("dictation: not available"); notice(t("dictUnavailable")); return; }
  if (dictating) return;
  hush();
  target = document.activeElement === ask ? ask : editor;
  if (target === editor && (editor.readOnly || !current)) { notice(t("openFirst")); return; }
  dictating = true; restarts = 0; heard = false;
  beep("start");
  showNotice("🎤 " + t("listening"));
  setTimeout(() => {           // wait for the beep, so the microphone does not hear it
    if (!dictating) return;
    try { recognizer = newRecognizer(); recognizer.start(); }
    catch (e) { logToServer("dictation: start failed " + e); dictating = false; notice(t("dictStartFailed")); }
  }, 250);
}
function stopDictation() {
  if (!dictating) return;
  dictating = false;
  if (recognizer) recognizer.stop();
  beep("end");
  if (!heard) logToServer("dictation: finished without hearing a voice");
  setTimeout(hideNotice, 800);
}

/* ------------------------------------------------------------ sounds */

let audio = null;
function beep(kind) {
  try {
    audio = audio || new AudioContext();
    const notes = { start: [660], end: [520], ok: [520, 780], error: [220], working: [440], stop: [380] }[kind] || [500];
    notes.forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = f; o.type = "sine";
      const t0 = audio.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
      o.connect(g).connect(audio.destination); o.start(t0); o.stop(t0 + 0.15);
    });
  } catch (e) { /* no audio: carry on */ }
}

/* ------------------------------------------------------------ notices */

let noticeTimer = null;
function showNotice(s) { const a = $("notice"); a.textContent = s; a.hidden = false; clearTimeout(noticeTimer); }
function hideNotice() { $("notice").hidden = true; }
function notice(s, aloud = true, ms = 4000) {
  showNotice(s);
  noticeTimer = setTimeout(hideNotice, ms);
  if (aloud) speak(s);
}

/* ------------------------------------------------------------ drawing the editor */

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function cursorLine() { return editor.value.slice(0, editor.selectionStart).split("\n").length - 1; }

function draw() {
  const lines = editor.value.split("\n");
  const focused = document.activeElement === editor;
  const cur = focused || reading ? cursorLine() : -1;
  // our own thick caret: only when the editor has the focus and nothing is selected
  const ownCaret = focused && !editor.readOnly && editor.selectionStart === editor.selectionEnd;
  editor.classList.toggle("own-caret", ownCaret);
  const col = ownCaret ? editor.selectionStart - (editor.value.lastIndexOf("\n", editor.selectionStart - 1) + 1) : -1;
  let html = "";
  lines.forEach((line, i) => {
    const cls = "r" + (i === cur ? " current" : "") + (changedLines.has(i) ? " changed" : "");
    const body = ownCaret && i === cur
      ? esc(line.slice(0, col)) + '<span class="caret"></span>' + (esc(line.slice(col)) || "\u200b")
      : (line ? esc(line) : "\u200b");
    html += `<div class="${cls}">${body}</div>`;
  });
  backdrop.innerHTML = html;
  backdrop.scrollTop = editor.scrollTop;
  updateInfo();
}

/* keeps the cursor line in the middle of the screen */
function centre() {
  const before = editor.value.slice(0, editor.selectionStart);
  const r = before.split("\n").length - 1;
  const div = backdrop.children[r];
  if (!div) return;
  const line = editor.value.split("\n")[r] || "";
  const col = before.length - before.lastIndexOf("\n") - 1;
  const y = div.offsetTop + div.offsetHeight * (line.length ? col / line.length : 0);
  editor.scrollTop = Math.max(0, y - editor.clientHeight * 0.45);
  backdrop.scrollTop = editor.scrollTop;
}

const wordCount = () => (editor.value.match(/\p{L}+/gu) || []).length;

function updateInfo() {
  $("where").textContent = label(current);
  if (!current) { $("info").textContent = ""; return; }
  $("info").textContent = t("statusLine", {
    line: cursorLine() + 1, words: wordCount(), chars: editor.value.length.toLocaleString(langCode),
  });
}

let pending = false;
function redraw(centreToo) {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; draw(); if (centreToo) centre(); });
}

/* ------------------------------------------------------------ opening and saving */

async function open(path, quiet) {
  await saveNow();
  try {
    const f = await api("/api/file?path=" + encodeURIComponent(path));
    current = f.path;
    editor.value = f.content;
    editor.readOnly = false;
    changedLines.clear();
    dirty = false;
    prefs.last = current; savePrefs();
    saveState(t("saved"));
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
    draw(); centre();
    if (!quiet) notice(t("opened", { label: spokenLabel(current) }), true, 2500);
  } catch (e) {
    notice(t("cannotOpen", { error: e.message }));
  }
}

function saveState(s) { $("save").textContent = s; }

async function saveNow() {
  clearTimeout(saveTimer);
  if (!current || !dirty) return;
  const content = editor.value;
  try {
    await api("/api/save", { path: current, content });
    if (editor.value === content) { dirty = false; saveState(t("saved")); }
  } catch (e) {
    saveState(t("notSaved"));
    notice(t("cannotSave", { error: e.message }));
  }
}

editor.addEventListener("input", () => {
  dirty = true;
  saveState("…");
  if (changedLines.size) changedLines.clear();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 2000);
  redraw(true);
});
editor.addEventListener("scroll", () => { backdrop.scrollTop = editor.scrollTop; });
editor.addEventListener("keyup", (e) => { if (/^(Arrow|Page|Home|End)/.test(e.key)) redraw(true); });
editor.addEventListener("click", () => redraw(false));
editor.addEventListener("selectionchange", () => redraw(false));
document.addEventListener("selectionchange", () => { if (document.activeElement === editor) redraw(false); });
editor.addEventListener("focus", () => redraw(false));
editor.addEventListener("blur", () => redraw(false));
window.addEventListener("resize", () => redraw(true));
window.addEventListener("beforeunload", () => {
  if (current && dirty) {
    navigator.sendBeacon("/api/save", new Blob([JSON.stringify({ path: current, content: editor.value })], { type: "application/json" }));
  }
});

/* ------------------------------------------------------------ Claude */

let workingTimer = null;
function lock(on) {
  busy = on;
  editor.readOnly = on || !current;
  editor.classList.toggle("busy", on);
  ask.readOnly = on;
  $("working").hidden = !on;
  clearInterval(workingTimer);
  if (on) workingTimer = setInterval(() => beep("working"), 2500);
}

/* lines that are new or changed compared with the previous text (line-based diff) */
function diffLines(oldText, newText) {
  const a = oldText.split("\n"), b = newText.split("\n");
  const n = a.length, m = b.length;
  if (n * m > 4e6) return new Set(b.map((r, i) => (a.includes(r) ? -1 : i)).filter((i) => i >= 0));
  const T = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    T[i][j] = a[i] === b[j] ? T[i + 1][j + 1] + 1 : Math.max(T[i + 1][j], T[i][j + 1]);
  const same = new Set();
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { same.add(j); i++; j++; }
    else if (T[i + 1][j] >= T[i][j + 1]) i++; else j++;
  }
  const out = new Set();
  b.forEach((r, k) => { if (!same.has(k) && r.trim()) out.add(k); });
  return out;
}

async function askClaude() {
  const request = ask.value.trim();
  if (!request || busy) return;
  hush();
  clearTimeout(saveTimer);
  const oldText = editor.value;
  const selection = editor.value.slice(editor.selectionStart, editor.selectionEnd);
  lock(true);
  answer.classList.remove("error");
  answer.textContent = t("request", { text: request });
  try {
    const r = await api("/api/claude", {
      request, path: current, content: current ? editor.value : undefined,
      line: current ? cursorLine() + 1 : 0, selection,
    });
    dirty = false; saveState(t("saved"));
    ask.value = "";
    answer.textContent = r.reply;
    answer.classList.toggle("error", r.error);
    answer.scrollTop = 0;
    lock(false);
    beep(r.error ? "error" : "ok");

    if (current && r.deleted.includes(current)) {
      current = ""; editor.value = ""; editor.readOnly = true; draw();
    } else if (current && r.changed.includes(current)) {
      const f = await api("/api/file?path=" + encodeURIComponent(current));
      editor.value = f.content;
      changedLines = diffLines(oldText, f.content);
      const first = Math.min(...changedLines);
      if (Number.isFinite(first)) {
        const pos = f.content.split("\n").slice(0, first).join("\n").length + (first ? 1 : 0);
        editor.setSelectionRange(pos, pos);
      }
      editor.focus(); draw(); centre();
      setTimeout(() => { if (changedLines.size) { changedLines.clear(); draw(); } }, 60000);
    } else if (r.created.length === 1 && r.created[0].endsWith(".md")) {
      await open(r.created[0], true);
    }
    if (prefs.autoRead) speak(r.reply);
    if (r.undoable) { showNotice(t("undoHint")); noticeTimer = setTimeout(hideNotice, 5000); }
  } catch (e) {
    lock(false);
    beep("error");
    answer.classList.add("error");
    answer.textContent = t("error", { error: e.message });
    speak(t("errorSpoken", { error: e.message }));
  }
}

$("send").addEventListener("click", askClaude);
ask.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askClaude(); } });

async function undoClaude() {
  if (busy) return;
  await saveNow();
  try {
    const r = await api("/api/undo", {});
    if (r.ok && current) {
      const f = await api("/api/file?path=" + encodeURIComponent(current)).catch(() => null);
      if (f) { editor.value = f.content; changedLines.clear(); draw(); centre(); }
    }
    beep(r.ok ? "ok" : "error");
    notice(r.message);
  } catch (e) { notice(t("cannotUndo", { error: e.message })); }
}

async function newConversation() {
  await api("/api/new-conversation", {}).catch(() => null);
  answer.textContent = t("newConversation");
  notice(t("newConversationSpoken"));
}

/* ------------------------------------------------------------ export to Word */

async function exportWord() {
  if (!current) { notice(t("openToExport")); return; }
  await saveNow();
  showNotice(t("exporting"));
  try {
    const r = await api("/api/export", { path: current });
    beep("ok"); notice(r.message, true, 6000);
  } catch (e) { beep("error"); notice(e.message, true, 6000); }
}

/* ------------------------------------------------------------ import Word files */

async function importWord() {
  await saveNow();
  showNotice(t("importing"));
  try {
    const r = await api("/api/import", {});
    if (!r.imported.length && !(r.failed || []).length) { notice(t("importEmpty", { folder: r.folder }), true, 9000); return; }
    let msg = r.imported.length ? t("imported", { n: r.imported.length }) : "";
    if ((r.failed || []).length) msg += " " + t("importFailed", { files: r.failed.join(", ") });
    beep(r.imported.length ? "ok" : "error");
    if (r.imported.length) await open(r.imported[0], true);
    notice(msg.trim(), true, 7000);
  } catch (e) { beep("error"); notice(e.message); }
}

/* ------------------------------------------------------------ panels: open, new, language */

let items = [], choice = 0, onChoose = null, onField = null, focusBefore = null;

function openPanel(title, entries, chosen, help) {
  hush();
  focusBefore = document.activeElement;
  $("panel-title").textContent = title;
  $("panel-help").textContent = help || t("panelHelp");
  items = entries; choice = 0; onChoose = chosen; onField = null;
  field.hidden = true;
  list.innerHTML = "";
  entries.forEach((v, i) => {
    const li = document.createElement("li");
    li.innerHTML = v.group ? `<span class="group">${esc(v.group)} › </span>${esc(v.text)}` : esc(v.text);
    li.addEventListener("click", () => { choice = i; confirmChoice(); });
    list.appendChild(li);
  });
  overlay.hidden = false;
  highlight(true, title);
}
function askTitle(title, done, initial = "") {
  hush();
  focusBefore = focusBefore || document.activeElement;
  $("panel-title").textContent = title;
  $("panel-help").textContent = t("typeHelp");
  list.innerHTML = ""; items = [];
  field.hidden = false; field.value = initial; field.select();
  onField = done;
  overlay.hidden = false;
  field.focus();
  speak(t("typeAndEnter", { title }));
}
function closePanel() {
  overlay.hidden = true; field.hidden = true; onField = null; hush();
  if (focusBefore) focusBefore.focus(); focusBefore = null;
}
function highlight(aloud, intro) {
  [...list.children].forEach((li, i) => li.classList.toggle("chosen", i === choice));
  const li = list.children[choice];
  if (li) li.scrollIntoView({ block: "nearest" });
  const v = items[choice];
  if (aloud && v) speak((intro ? intro + ". " : "") + (v.group ? v.group + ", " : "") + v.text);
}
function confirmChoice() {
  const v = items[choice], f = onChoose;
  if (!v) return;
  overlay.hidden = true;
  f(v);
}

field.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const s = field.value.trim(), f = onField;
    if (!s) { speak(t("emptyTitle")); return; }
    closePanel();
    f(s);
  }
});

async function openPanelTexts() {
  await saveNow();
  let res;
  try { res = await api("/api/list"); } catch (e) { notice(t("cannotList")); return; }
  if (!res.items.length) { notice(t("noTexts")); return; }
  const entries = res.items.map((v) => ({
    path: v.path, group: v.type === "article" ? t("article") : t("book") + " " + v.book, text: v.name,
  }));
  openPanel(t("openTitle"), entries, (v) => { focusBefore = null; open(v.path); });
  const i = entries.findIndex((v) => v.path === current);
  if (i >= 0) { choice = i; highlight(false); }
}

function openPanelNew() {
  const book = bookOf(current);
  const choices = [{ type: "article", text: t("newArticle") }, { type: "book", text: t("newBook") }];
  if (book) choices.push({ type: "chapter", text: t("newChapterIn", { book }) });
  choices.push({ type: "import", text: t("importWord") });
  openPanel(t("whatCreate"), choices, (v) => {
    if (v.type === "import") { focusBefore = null; importWord(); return; }
    const prompt = { article: t("titleArticle"), book: t("titleBook"), chapter: t("titleChapter") }[v.type];
    askTitle(prompt, async (title) => {
      try {
        const r = await api("/api/new", { type: v.type, title, book });
        await open(r.path);
      } catch (e) { notice(t("cannotCreate", { error: e.message })); }
    });
  });
}

function openPanelLanguage() {
  const entries = languages.map((l) => ({ code: l.code, text: l.name }));
  openPanel(t("chooseLanguage"), entries, async (v) => {
    try {
      applyLanguage(await api("/api/lang", { code: v.code }));
      focusBefore = null;
      if (current) editor.focus();
      notice(t("languageSet", { name: v.text }));
    } catch (e) { notice(e.message); }
  });
  const i = entries.findIndex((v) => v.code === langCode);
  if (i >= 0) { choice = i; highlight(false); }
}

/* ------------------------------------------------------------ read the paragraph, find, quick requests */

function readParagraph() {
  // a paragraph is one line of the editor; on an empty line, read the one before
  const lines = editor.value.split("\n");
  let r = cursorLine();
  while (r > 0 && !lines[r].trim()) r--;
  const text = plain(lines[r] || "");
  if (!text) { notice(t("nothingToRead")); return; }
  speak(text);
}

let lastFind = "";
function findNext(term) {
  if (!term) return;
  const v = editor.value.toLocaleLowerCase(langCode), q = term.toLocaleLowerCase(langCode);
  let i = v.indexOf(q, editor.selectionEnd), wrapped = false;
  if (i < 0) { i = v.indexOf(q); wrapped = i >= 0; }
  if (i < 0) { beep("error"); notice(t("notFound", { text: term })); return; }
  editor.focus();
  editor.setSelectionRange(i, i + term.length);
  centre(); draw();
  const from = editor.value.lastIndexOf("\n", i - 1) + 1, end = editor.value.indexOf("\n", i);
  const line = plain(editor.value.slice(from, end < 0 ? editor.value.length : end)).slice(0, 220);
  speak((wrapped ? t("findWrapped") + " " : "") + line);
}
function openFind() {
  if (!current) { notice(t("openFirst")); return; }
  askTitle(t("findPrompt"), (term) => { lastFind = term; focusBefore = null; findNext(term); }, lastFind);
}

function quickRequest(n) {
  const q = (L.ui.quick || [])[n];
  if (!q || busy) return;
  if (!current) { notice(t("openFirst")); return; }
  if (!prefs.bar) { prefs.bar = true; savePrefs(); applyPrefs(); }
  ask.value = q.prompt;
  speak(q.name);
  askClaude();
}

/* ------------------------------------------------------------ keys */

function whereAmI() {
  if (!current) { notice(t("whereNone")); return; }
  const total = editor.value.split("\n").length, r = cursorLine() + 1;
  const pos = r === 1 ? t("posStart") : r >= total ? t("posEnd") : t("posLine", { line: r, total });
  notice(t("whereAmI", { label: spokenLabel(current), pos, words: wordCount(), chars: editor.value.length }), true, 5000);
}

function zoom(delta) {
  prefs.fs = Math.min(96, Math.max(20, prefs.fs + delta));
  savePrefs(); applyPrefs(); centre();
  showNotice(t("textSize", { size: prefs.fs })); noticeTimer = setTimeout(hideNotice, 1200);
}

document.addEventListener("keydown", (e) => {
  const k = e.key;
  // a panel is open: arrows, Enter, Esc
  if (!overlay.hidden) {
    if (k === "Escape") { e.preventDefault(); closePanel(); return; }
    if (field.hidden) {
      if (k === "ArrowDown") { e.preventDefault(); choice = Math.min(items.length - 1, choice + 1); highlight(true); return; }
      if (k === "ArrowUp") { e.preventDefault(); choice = Math.max(0, choice - 1); highlight(true); return; }
      if (k === "Enter") { e.preventDefault(); confirmChoice(); return; }
    }
    if (/^F\d+$/.test(k)) e.preventDefault();
    return;
  }

  // quick requests (Ctrl + 1..4), find (Ctrl + F) and find next (Ctrl + G)
  if (e.ctrlKey && !e.altKey && !e.shiftKey) {
    const digit = /^Digit([1-4])$/.exec(e.code) || /^Numpad([1-4])$/.exec(e.code);
    if (digit) { e.preventDefault(); quickRequest(Number(digit[1]) - 1); return; }
    if (e.code === "KeyF") { e.preventDefault(); openFind(); return; }
    if (e.code === "KeyG") { e.preventDefault(); if (lastFind) findNext(lastFind); else openFind(); return; }
  }

  // text size and line spacing
  if (e.ctrlKey && !e.altKey) {
    const plus = k === "+" || k === "=" || k === "*" || e.code === "NumpadAdd";
    const minus = k === "-" || k === "_" || e.code === "NumpadSubtract";
    if (plus || minus) {
      e.preventDefault();
      if (e.shiftKey) {
        prefs.lh = Math.round(Math.min(2.6, Math.max(1.2, prefs.lh + (plus ? 0.1 : -0.1))) * 10) / 10;
        savePrefs(); applyPrefs();
        showNotice(t("lineSpacing", { value: prefs.lh })); noticeTimer = setTimeout(hideNotice, 1200);
      } else zoom(plus ? 4 : -4);
      return;
    }
    if (k === "0") { e.preventDefault(); prefs.fs = DEFAULTS.fs; savePrefs(); applyPrefs(); return; }
  }

  if (k === "Escape") {
    if (dictating) stopDictation();
    if (reading || ("speechSynthesis" in window && speechSynthesis.speaking)) { hush(); beep("stop"); }
    if (changedLines.size) { changedLines.clear(); draw(); }
    if (document.activeElement === ask && current) editor.focus();
    hideNotice();
    return;
  }

  if (!/^F\d+$/.test(k) || k === "F11") return;
  e.preventDefault();
  if (e.repeat) return;   // a key held down counts once

  switch (k) {
    case "F1": if (e.shiftKey) speak(t("help")); else whereAmI(); break;
    case "F2":
      if (e.shiftKey) {
        prefs.keys = !prefs.keys; savePrefs(); applyPrefs();
        speak(prefs.keys ? t("keysOn") : t("keysOff")); break;
      }
      prefs.bar = !prefs.bar; savePrefs(); applyPrefs();
      if (prefs.bar) { ask.focus(); speak(t("claudeVisible")); } else { editor.focus(); speak(t("textOnly")); }
      break;
    case "F3":
      if (e.shiftKey && e.ctrlKey) {
        prefs.rate = RATES[(RATES.indexOf(prefs.rate) + 1) % RATES.length]; savePrefs();
        speak(t("speed", { value: String(prefs.rate).replace(".", t("decimalSpoken")) }));
      } else if (e.shiftKey) {
        if (current) readParagraph(); else speak(answer.textContent);
      } else if (e.ctrlKey) {
        prefs.autoRead = !prefs.autoRead; savePrefs();
        speak(prefs.autoRead ? t("autoReadOn") : t("autoReadOff"));
      } else if (document.activeElement === ask || !current) speak(answer.textContent);
      else readFromCursor();
      break;
    case "F4":
      if (e.shiftKey) { newConversation(); break; }
      if (!prefs.bar) { prefs.bar = true; savePrefs(); applyPrefs(); }
      hush(); ask.focus(); beep("start");
      break;
    case "F5": if (dictating) stopDictation(); else startDictation(); break;
    case "F6": openPanelTexts(); break;
    case "F7": openPanelNew(); break;
    case "F8": undoClaude(); break;
    case "F9":
      prefs.font = (prefs.font + 1) % FONTS.length; savePrefs(); applyPrefs();
      speak(t("font", { name: FONT_NAMES[prefs.font] })); break;
    case "F10":
      if (e.shiftKey) { openPanelLanguage(); break; }
      prefs.theme = (prefs.theme + 1) % THEMES.length; savePrefs(); applyPrefs();
      speak(t("theme", { name: (L.ui.themes || [])[prefs.theme] || "" })); break;
    case "F12": exportWord(); break;
  }
}, true);

document.addEventListener("keyup", (e) => { if (e.key === "F5") e.preventDefault(); }, true);
document.addEventListener("wheel", (e) => { if (e.ctrlKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 2 : -2); } }, { passive: false });

/* ------------------------------------------------------------ big buttons */

const ACTIONS = {
  open: () => openPanelTexts(),
  new: () => openPanelNew(),
  read: () => { if (current) readFromCursor(); else speak(answer.textContent); },
  dictate: () => { if (dictating) stopDictation(); else startDictation(); },
  ask: () => { if (!prefs.bar) { prefs.bar = true; savePrefs(); applyPrefs(); } hush(); ask.focus(); beep("start"); },
  undo: () => undoClaude(),
  find: () => openFind(),
  word: () => exportWord(),
  bigger: () => zoom(4),
  smaller: () => zoom(-4),
  where: () => whereAmI(),
  help: () => speak(t("help")),
};
// mousedown is cancelled so the text keeps the focus (and the cursor stays where it was)
$("keys").addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); });
$("keys").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b && ACTIONS[b.dataset.action] && overlay.hidden) ACTIONS[b.dataset.action]();
});
// the Dictate button shows when dictation is on
setInterval(() => {
  const d = document.querySelector('#keys button[data-action="dictate"]');
  if (d) d.classList.toggle("on", dictating);
}, 300);

/* ------------------------------------------------------------ start */

setInterval(() => fetch("/api/ping").catch(() => saveState(t("programClosed"))), 20000);
fetch("/api/ping").catch(() => null);

(async function start() {
  try { applyLanguage(await api("/api/lang")); } catch (e) { /* English keys stay */ }
  applyPrefs();
  answer.textContent = t("welcome");
  try {
    const s = await api("/api/status");
    if (!s.claude) answer.textContent = t("claudeMissing");
  } catch (e) { /* nothing */ }
  if (prefs.last) {
    try { await api("/api/file?path=" + encodeURIComponent(prefs.last)); await open(prefs.last, true); }
    catch (e) { prefs.last = ""; savePrefs(); }
  }
  setTimeout(() => speak(current ? t("ready") + " " + spokenLabel(current) : t("ready") + " " + t("readyHint")), 600);
})();
