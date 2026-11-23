/* Clara Writer: logica dell'editor */
"use strict";

const $ = (id) => document.getElementById(id);
const testo = $("testo"), sfondo = $("sfondo"), domanda = $("domanda"), risposta = $("risposta");
const barra = $("claude"), velo = $("velo"), lista = $("lista"), campo = $("campo");

/* ------------------------------------------------------------ impostazioni */

const PREDEFINITE = { fs: 36, lh: 1.8, font: 0, tema: 0, velocita: 1, autolettura: true, barra: true, ultimo: "" };
const FONT = ['"Clara Atkinson", Verdana, sans-serif', "Verdana, sans-serif", "Arial, sans-serif"];
const NOMI_FONT = ["Atkinson", "Verdana", "Arial"];
const TEMI = ["tema-giallo", "tema-bianco", "tema-crema"];
const NOMI_TEMI = ["giallo su nero", "bianco su nero", "nero su crema"];
const VELOCITA = [0.8, 1, 1.2, 1.4, 1.6];

let imp = { ...PREDEFINITE };
try { imp = { ...PREDEFINITE, ...JSON.parse(localStorage.getItem("scrittoio") || "{}") }; } catch (e) { /* niente */ }
function salvaImpostazioni() { try { localStorage.setItem("scrittoio", JSON.stringify(imp)); } catch (e) { /* niente */ } }

function applicaImpostazioni() {
  const r = document.documentElement.style;
  r.setProperty("--fs", imp.fs + "px");
  r.setProperty("--lh", imp.lh);
  r.setProperty("--font", FONT[imp.font]);
  document.body.className = TEMI[imp.tema];
  barra.classList.toggle("nascosta", !imp.barra);
  disegna();
}

/* ------------------------------------------------------------ stato */

let aperto = "";            // percorso relativo del file aperto
let modificato = false;
let occupato = false;
let cambiate = new Set();   // righe cambiate da Claude
let timerSalva = null;

const etichetta = (p) => {
  if (!p) return "Nessun testo aperto";
  const parti = p.split("/");
  const nome = parti.at(-1).replace(/\.md$/, "");
  if (parti[0] === "Libri" && parti.length >= 3) return `Libro: ${parti[1]} › ${nome}`;
  if (parti[0] === "Articoli") return `Articolo: ${nome}`;
  return nome;
};
const libroDi = (p) => { const s = (p || "").split("/"); return s[0] === "Libri" && s.length >= 3 ? s[1] : ""; };

/* ------------------------------------------------------------ server */

async function api(percorso, dati) {
  const opz = dati === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dati) };
  const r = await fetch(percorso, opz);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.errore || "Errore del programma");
  return j;
}

/* ------------------------------------------------------------ voce: lettura */

let voce = null;
function scegliVoce() {
  const it = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith("it"));
  voce = it.find((v) => /natural/i.test(v.name) && /isabella|elsa/i.test(v.name))
      || it.find((v) => /natural|online/i.test(v.name)) || it[0] || null;
}
if ("speechSynthesis" in window) { scegliVoce(); speechSynthesis.onvoiceschanged = scegliVoce; }

const pulisci = (t) => t
  .replace(/```[\s\S]*?```/g, " ")
  .replace(/^#{1,6}\s*/gm, "")
  .replace(/[*_`>|~]+/g, "")
  .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/^\s*[-•]\s+/gm, "")
  .replace(/[ \t]+/g, " ")
  .trim();

function parla(t, poi) {
  if (!("speechSynthesis" in window) || !t) { if (poi) poi(); return; }
  speechSynthesis.cancel();
  const pezzi = pulisci(t).match(/[^.!?;\n]+[.!?;]*|\n+/g) || [];
  const frasi = pezzi.map((s) => s.trim()).filter(Boolean);
  frasi.forEach((f, i) => {
    const u = new SpeechSynthesisUtterance(f);
    u.lang = "it-IT"; if (voce) u.voice = voce; u.rate = imp.velocita;
    if (i === frasi.length - 1 && poi) u.onend = poi;
    speechSynthesis.speak(u);
  });
}
function zitto() { if ("speechSynthesis" in window) speechSynthesis.cancel(); lettura = null; }

/* lettura del testo dal cursore in poi, frase per frase, con la frase selezionata */
let lettura = null;
function leggiDalCursore() {
  if (lettura) { zitto(); suono("stop"); return; }
  const t = testo.value;
  let pos = testo.selectionStart;
  const frasi = [];
  const re = /[^.!?\n]+[.!?]*["»”]?/g;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(t))) {
    if (m.index + m[0].length <= pos) continue;
    const da = Math.max(m.index, pos);
    const parte = t.slice(da, m.index + m[0].length);
    if (pulisci(parte)) frasi.push({ da, a: m.index + m[0].length, testo: pulisci(parte) });
  }
  if (!frasi.length) { avviso("Non c'è niente da leggere dopo il cursore.", true); return; }
  speechSynthesis.cancel();
  lettura = { frasi };
  frasi.forEach((f, i) => {
    const u = new SpeechSynthesisUtterance(f.testo);
    u.lang = "it-IT"; if (voce) u.voice = voce; u.rate = imp.velocita;
    u.onstart = () => { if (lettura) { testo.focus(); testo.setSelectionRange(f.da, f.a); centra(); disegna(); } };
    if (i === frasi.length - 1) u.onend = () => { lettura = null; };
    speechSynthesis.speak(u);
  });
}

/* ------------------------------------------------------------ voce: dettatura */

const Riconoscimento = window.SpeechRecognition || window.webkitSpeechRecognition;
let ascolto = null, bersaglio = null;

const PUNTEGGIATURA = [
  [/\bpunto e a capo\b/gi, ".\n"], [/\bnuovo paragrafo\b/gi, "\n\n"], [/\ba capo\b/gi, "\n"],
  [/\bpunto interrogativo\b/gi, "?"], [/\bpunto esclamativo\b/gi, "!"], [/\bpunto e virgola\b/gi, ";"],
  [/\bdue punti\b/gi, ":"], [/\bvirgola\b/gi, ","], [/\bpunto\b/gi, "."],
  [/\bapri virgolette\b/gi, "«"], [/\bchiudi virgolette\b/gi, "»"],
];
function sistemaDettato(t) {
  for (const [re, s] of PUNTEGGIATURA) t = t.replace(re, s);
  return t.replace(/\s+([,.;:?!»])/g, "$1").replace(/«\s+/g, "«").replace(/[ \t]*\n[ \t]*/g, "\n").trim();
}

function inserisci(el, frammento) {
  const s = el.selectionStart, e = el.selectionEnd, v = el.value;
  const prima = v.slice(0, s);
  let f = frammento;
  if (!/^[,.;:?!»\n]/.test(f) && prima && !/[\s«(]$/.test(prima)) f = " " + f;
  if (!prima.trim() || /[.!?]\s*$/.test(prima) || /\n\s*$/.test(prima)) f = f.replace(/^(\s*)(\p{L})/u, (_, a, b) => a + b.toUpperCase());
  el.setRangeText(f, s, e, "end");
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/* registro: manda al server cosa succede, per capire i problemi */
function registra(msg) {
  try { fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ msg }) }); } catch (e) { /* niente */ }
}

let dettaturaAttiva = false, ripartenze = 0, haSentito = false;

function nuovoAscolto() {
  const r = new Riconoscimento();
  r.lang = "it-IT"; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
  r.onstart = () => registra("dettatura: avviata");
  r.onaudiostart = () => registra("dettatura: microfono attivo");
  r.onspeechstart = () => { haSentito = true; registra("dettatura: voce rilevata"); };
  r.onresult = (ev) => {
    let provvisorio = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const ris = ev.results[i];
      if (ris.isFinal) {
        const t = sistemaDettato(ris[0].transcript);
        registra("dettatura: testo ricevuto (" + t.length + " caratteri)");
        if (t) inserisci(bersaglio, t);
      } else provvisorio += ris[0].transcript;
    }
    mostraAvviso("🎤 " + (provvisorio || "Ti ascolto… (F5 per finire)"));
  };
  r.onerror = (ev) => {
    registra("dettatura: errore " + ev.error + (ev.message ? " " + ev.message : ""));
    if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
      dettaturaAttiva = false;
      avviso("Il microfono non è permesso. Serve dare il permesso a Edge.", true, 6000);
    } else if (ev.error === "network") {
      dettaturaAttiva = false;
      avviso("La dettatura di Edge non risponde. Prova con Windows più H.", true, 6000);
    } else if (ev.error === "audio-capture") {
      dettaturaAttiva = false;
      avviso("Non trovo il microfono. Controlla che sia collegato.", true, 6000);
    }
  };
  r.onend = () => {
    registra("dettatura: fermata");
    if (dettaturaAttiva && ripartenze < 30) {      // pausa lunga: riparte da sola
      ripartenze++;
      try { ascolto = nuovoAscolto(); ascolto.start(); return; } catch (e) { registra("dettatura: ripartenza fallita " + e); }
    }
    ascolto = null; dettaturaAttiva = false; nascondiAvviso();
  };
  return r;
}

function iniziaDettatura() {
  if (!Riconoscimento) { registra("dettatura: non disponibile in questo browser"); avviso("La dettatura non è disponibile. Usa Windows più H.", true); return; }
  if (dettaturaAttiva) return;
  zitto();
  bersaglio = document.activeElement === domanda ? domanda : testo;
  if (bersaglio === testo && (testo.readOnly || !aperto)) { avviso("Apri prima un testo.", true); return; }
  dettaturaAttiva = true; ripartenze = 0; haSentito = false;
  suono("via");
  mostraAvviso("🎤 Ti ascolto… (F5 per finire)");
  // aspetta che finisca il suono, cosi' il microfono non lo sente
  setTimeout(() => {
    if (!dettaturaAttiva) return;
    try { ascolto = nuovoAscolto(); ascolto.start(); }
    catch (e) { registra("dettatura: avvio fallito " + e); dettaturaAttiva = false; avviso("Non riesco ad avviare la dettatura.", true); }
  }, 250);
}
function fermaDettatura() {
  if (!dettaturaAttiva) return;
  dettaturaAttiva = false;
  if (ascolto) ascolto.stop();
  suono("fine");
  if (!haSentito) registra("dettatura: finita senza sentire la voce");
  setTimeout(nascondiAvviso, 800);
}

/* ------------------------------------------------------------ suoni */

let audio = null;
function suono(tipo) {
  try {
    audio = audio || new AudioContext();
    const note = { via: [660], fine: [520], ok: [520, 780], errore: [220], lavoro: [440], stop: [380] }[tipo] || [500];
    note.forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = f; o.type = "sine";
      const t0 = audio.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
      o.connect(g).connect(audio.destination); o.start(t0); o.stop(t0 + 0.15);
    });
  } catch (e) { /* senza audio si continua */ }
}

/* ------------------------------------------------------------ avvisi */

let timerAvviso = null;
function mostraAvviso(t) { const a = $("avviso"); a.textContent = t; a.hidden = false; clearTimeout(timerAvviso); }
function nascondiAvviso() { $("avviso").hidden = true; }
function avviso(t, aVoce = true, durata = 4000) {
  mostraAvviso(t);
  timerAvviso = setTimeout(nascondiAvviso, durata);
  if (aVoce) parla(t);
}

/* ------------------------------------------------------------ disegno dell'editor */

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function rigaDelCursore() { return testo.value.slice(0, testo.selectionStart).split("\n").length - 1; }

function disegna() {
  const righe = testo.value.split("\n");
  const corrente = document.activeElement === testo || lettura ? rigaDelCursore() : -1;
  let html = "";
  righe.forEach((r, i) => {
    const cls = "r" + (i === corrente ? " corrente" : "") + (cambiate.has(i) ? " cambiato" : "");
    html += `<div class="${cls}">${r ? esc(r) : "​"}</div>`;
  });
  sfondo.innerHTML = html;
  sfondo.scrollTop = testo.scrollTop;
  aggiornaInfo();
}

/* porta la riga del cursore a meta' schermo */
function centra() {
  const prima = testo.value.slice(0, testo.selectionStart);
  const r = prima.split("\n").length - 1;
  const div = sfondo.children[r];
  if (!div) return;
  // posizione approssimata dentro il paragrafo: proporzione dei caratteri
  const riga = testo.value.split("\n")[r] || "";
  const colonna = prima.length - prima.lastIndexOf("\n") - 1;
  const frazione = riga.length ? colonna / riga.length : 0;
  const y = div.offsetTop + div.offsetHeight * frazione;
  testo.scrollTop = Math.max(0, y - testo.clientHeight * 0.45);
  sfondo.scrollTop = testo.scrollTop;
}

function aggiornaInfo() {
  $("dove").textContent = etichetta(aperto);
  if (!aperto) { $("info").textContent = ""; return; }
  const parole = (testo.value.match(/\p{L}+/gu) || []).length;
  $("info").textContent = `riga ${rigaDelCursore() + 1} · ${parole} parole`;
}

let inAttesa = false;
function ridisegna(centrare) {
  if (inAttesa) return;
  inAttesa = true;
  requestAnimationFrame(() => { inAttesa = false; disegna(); if (centrare) centra(); });
}

/* ------------------------------------------------------------ apertura e salvataggio */

async function apri(percorso, quiet) {
  await salvaOra();
  try {
    const f = await api("/api/file?percorso=" + encodeURIComponent(percorso));
    aperto = f.percorso;
    testo.value = f.contenuto;
    testo.readOnly = false;
    cambiate.clear();
    modificato = false;
    imp.ultimo = aperto; salvaImpostazioni();
    statoSalvataggio("Salvato");
    testo.focus();
    const fine = testo.value.length;
    testo.setSelectionRange(fine, fine);
    disegna(); centra();
    if (!quiet) avviso("Aperto. " + etichetta(aperto).replace("›", ","), true, 2500);
  } catch (e) {
    avviso("Non riesco ad aprire il testo. " + e.message, true);
  }
}

function statoSalvataggio(t) { $("salvataggio").textContent = t; }

async function salvaOra() {
  clearTimeout(timerSalva);
  if (!aperto || !modificato) return;
  const contenuto = testo.value;
  try {
    await api("/api/salva", { percorso: aperto, contenuto });
    if (testo.value === contenuto) { modificato = false; statoSalvataggio("Salvato"); }
  } catch (e) {
    statoSalvataggio("NON SALVATO");
    avviso("Attenzione: non riesco a salvare. " + e.message, true);
  }
}

testo.addEventListener("input", () => {
  modificato = true;
  statoSalvataggio("…");
  if (cambiate.size) cambiate.clear();
  clearTimeout(timerSalva);
  timerSalva = setTimeout(salvaOra, 2000);
  ridisegna(true);
});
testo.addEventListener("scroll", () => { sfondo.scrollTop = testo.scrollTop; });
testo.addEventListener("keyup", (e) => {
  if (/^(Arrow|Page|Home|End)/.test(e.key)) ridisegna(true);
});
testo.addEventListener("click", () => ridisegna(false));
testo.addEventListener("focus", () => ridisegna(false));
testo.addEventListener("blur", () => ridisegna(false));
window.addEventListener("resize", () => ridisegna(true));
window.addEventListener("beforeunload", () => {
  if (aperto && modificato) {
    navigator.sendBeacon("/api/salva", new Blob([JSON.stringify({ percorso: aperto, contenuto: testo.value })], { type: "application/json" }));
  }
});

/* ------------------------------------------------------------ Claude */

let timerLavoro = null;
function blocca(si) {
  occupato = si;
  testo.readOnly = si || !aperto;
  testo.classList.toggle("occupato", si);
  domanda.readOnly = si;
  $("lavoro").hidden = !si;
  clearInterval(timerLavoro);
  if (si) timerLavoro = setInterval(() => suono("lavoro"), 2500);
}

/* righe nuove o cambiate rispetto al testo precedente (confronto per righe) */
function righeCambiate(vecchio, nuovo) {
  const a = vecchio.split("\n"), b = nuovo.split("\n");
  const n = a.length, m = b.length;
  if (n * m > 4e6) return new Set(b.map((r, i) => (a.includes(r) ? -1 : i)).filter((i) => i >= 0));
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const uguali = new Set();
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { uguali.add(j); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  const out = new Set();
  b.forEach((r, k) => { if (!uguali.has(k) && r.trim()) out.add(k); });
  return out;
}

async function chiediAClaude() {
  const richiesta = domanda.value.trim();
  if (!richiesta || occupato) return;
  zitto();
  clearTimeout(timerSalva);
  const vecchio = testo.value;
  const sel = testo.value.slice(testo.selectionStart, testo.selectionEnd);
  blocca(true);
  risposta.classList.remove("errore");
  risposta.textContent = "Richiesta: " + richiesta;
  try {
    const r = await api("/api/claude", {
      richiesta, percorso: aperto, contenuto: aperto ? testo.value : undefined,
      riga: aperto ? rigaDelCursore() + 1 : 0, selezione: sel,
    });
    modificato = false; statoSalvataggio("Salvato");
    domanda.value = "";
    risposta.textContent = r.risposta;
    risposta.classList.toggle("errore", r.errore);
    risposta.scrollTop = 0;
    blocca(false);
    suono(r.errore ? "errore" : "ok");

    if (aperto && r.eliminati.includes(aperto)) {
      aperto = ""; testo.value = ""; testo.readOnly = true; disegna();
    } else if (aperto && r.modificati.includes(aperto)) {
      const f = await api("/api/file?percorso=" + encodeURIComponent(aperto));
      testo.value = f.contenuto;
      cambiate = righeCambiate(vecchio, f.contenuto);
      const prima = Math.min(...cambiate);
      if (Number.isFinite(prima)) {
        const pos = f.contenuto.split("\n").slice(0, prima).join("\n").length + (prima ? 1 : 0);
        testo.setSelectionRange(pos, pos);
      }
      testo.focus(); disegna(); centra();
      setTimeout(() => { if (cambiate.size) { cambiate.clear(); disegna(); } }, 60000);
    } else if (r.creati.length === 1 && r.creati[0].endsWith(".md")) {
      await apri(r.creati[0], true);
    }
    if (imp.autolettura) parla(r.risposta);
    if (r.annullabile) mostraAvviso("Per annullare le modifiche di Claude premi F8");
    if (r.annullabile) timerAvviso = setTimeout(nascondiAvviso, 5000);
  } catch (e) {
    blocca(false);
    suono("errore");
    risposta.classList.add("errore");
    risposta.textContent = "Errore: " + e.message;
    parla("C'è stato un errore. " + e.message);
  }
}

$("invia").addEventListener("click", chiediAClaude);
domanda.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chiediAClaude(); }
});

async function annullaClaude() {
  if (occupato) return;
  await salvaOra();
  try {
    const r = await api("/api/annulla", {});
    if (r.ok && aperto) {
      const f = await api("/api/file?percorso=" + encodeURIComponent(aperto)).catch(() => null);
      if (f) { testo.value = f.contenuto; cambiate.clear(); disegna(); centra(); }
    }
    suono(r.ok ? "ok" : "errore");
    avviso(r.messaggio, true);
  } catch (e) { avviso("Non riesco ad annullare. " + e.message, true); }
}

async function nuovaConversazione() {
  await api("/api/nuova-conversazione", {}).catch(() => null);
  risposta.textContent = "Nuova conversazione con Claude.";
  avviso("Ho iniziato una nuova conversazione con Claude.", true);
}

/* ------------------------------------------------------------ esporta in Word */

async function esportaWord() {
  if (!aperto) { avviso("Apri prima un testo da esportare.", true); return; }
  await salvaOra();
  mostraAvviso("Sto creando il file Word…");
  try {
    const r = await api("/api/esporta", { percorso: aperto });
    suono("ok"); avviso(r.messaggio, true, 6000);
  } catch (e) { suono("errore"); avviso(e.message, true, 6000); }
}

/* ------------------------------------------------------------ pannelli: apri e nuovo */

let voci = [], scelta = 0, alScegliere = null, alConfermaCampo = null, focusPrima = null;

function apriPannello(titolo, elementi, quandoScelto, aiuto) {
  zitto();
  focusPrima = document.activeElement;
  $("pannello-titolo").textContent = titolo;
  $("pannello-aiuto").textContent = aiuto || "Frecce su e giù per scegliere, Invio per confermare, Esc per uscire.";
  voci = elementi; scelta = 0; alScegliere = quandoScelto; alConfermaCampo = null;
  campo.hidden = true;
  lista.innerHTML = "";
  elementi.forEach((v, i) => {
    const li = document.createElement("li");
    li.innerHTML = v.gruppo ? `<span class="gruppo">${esc(v.gruppo)} › </span>${esc(v.testo)}` : esc(v.testo);
    li.addEventListener("click", () => { scelta = i; conferma(); });
    lista.appendChild(li);
  });
  velo.hidden = false;
  evidenzia(true, titolo);
}
function chiediTitolo(titolo, quandoScritto) {
  zitto();
  focusPrima = focusPrima || document.activeElement;
  $("pannello-titolo").textContent = titolo;
  $("pannello-aiuto").textContent = "Scrivi e premi Invio. Esc per uscire.";
  lista.innerHTML = ""; voci = [];
  campo.hidden = false; campo.value = "";
  alConfermaCampo = quandoScritto;
  velo.hidden = false;
  campo.focus();
  parla(titolo + ". Scrivi e premi Invio.");
}
function chiudiPannello() {
  velo.hidden = true; campo.hidden = true; alConfermaCampo = null; zitto();
  if (focusPrima) focusPrima.focus(); focusPrima = null;
}
function evidenzia(annuncia, premessa) {
  [...lista.children].forEach((li, i) => li.classList.toggle("scelto", i === scelta));
  const li = lista.children[scelta];
  if (li) li.scrollIntoView({ block: "nearest" });
  const v = voci[scelta];
  if (annuncia && v) parla((premessa ? premessa + ". " : "") + (v.gruppo ? v.gruppo + ", " : "") + v.testo);
}
function conferma() {
  const v = voci[scelta], f = alScegliere;
  if (!v) return;
  velo.hidden = true;
  f(v);
}

campo.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const t = campo.value.trim(), f = alConfermaCampo;
    if (!t) { parla("Il titolo è vuoto."); return; }
    chiudiPannello();
    f(t);
  }
});

async function pannelloApri() {
  await salvaOra();
  let el;
  try { el = await api("/api/elenco"); } catch (e) { avviso("Non riesco a leggere i testi.", true); return; }
  if (!el.voci.length) { avviso("Non ci sono ancora testi. Premi F7 per crearne uno.", true); return; }
  const elementi = el.voci.map((v) => ({
    percorso: v.percorso,
    gruppo: v.tipo === "articolo" ? "Articolo" : "Libro " + v.libro,
    testo: v.nome,
  }));
  apriPannello("Apri un testo", elementi, (v) => { focusPrima = null; apri(v.percorso); });
  const i = elementi.findIndex((v) => v.percorso === aperto);
  if (i >= 0) { scelta = i; evidenzia(false); }
}

function pannelloNuovo() {
  const libro = libroDi(aperto);
  const scelte = [{ tipo: "articolo", testo: "Nuovo articolo" }, { tipo: "libro", testo: "Nuovo libro" }];
  if (libro) scelte.push({ tipo: "capitolo", testo: `Nuovo capitolo nel libro ${libro}` });
  apriPannello("Cosa vuoi creare?", scelte, (v) => {
    const domandaTitolo = { articolo: "Titolo del nuovo articolo", libro: "Titolo del nuovo libro", capitolo: "Titolo del nuovo capitolo" }[v.tipo];
    chiediTitolo(domandaTitolo, async (titolo) => {
      try {
        const r = await api("/api/nuovo", { tipo: v.tipo, titolo, libro });
        await apri(r.percorso);
      } catch (e) { avviso("Non riesco a crearlo. " + e.message, true); }
    });
  });
}

/* ------------------------------------------------------------ tasti */

function doveSono() {
  if (!aperto) { avviso("Nessun testo aperto. Premi F6 per aprirne uno.", true); return; }
  const tot = testo.value.split("\n").length, r = rigaDelCursore() + 1;
  const parole = (testo.value.match(/\p{L}+/gu) || []).length;
  const pos = r === 1 ? "all'inizio" : r >= tot ? "alla fine" : `alla riga ${r} di ${tot}`;
  avviso(`${etichetta(aperto).replace("›", ",")}. Sei ${pos}. Il testo ha ${parole} parole.`, true, 5000);
}

const AIUTO = "F1, dove sono. F2, mostra o nasconde Claude. F3, leggi dal cursore. F4, chiedi a Claude. " +
  "F5, inizia e finisce la dettatura. F6, apri. F7, nuovo. F8, annulla le modifiche di Claude. " +
  "F9, carattere. F10, colori. F12, esporta in Word. Control più e meno, grandezza del testo. Esc, ferma la lettura.";

function zoom(delta) {
  imp.fs = Math.min(96, Math.max(20, imp.fs + delta));
  salvaImpostazioni(); applicaImpostazioni(); centra();
  mostraAvviso(`Testo ${imp.fs}`); timerAvviso = setTimeout(nascondiAvviso, 1200);
}

document.addEventListener("keydown", (e) => {
  const k = e.key;
  // pannello aperto: frecce, invio, esc
  if (!velo.hidden) {
    if (k === "Escape") { e.preventDefault(); chiudiPannello(); return; }
    if (campo.hidden) {
      if (k === "ArrowDown") { e.preventDefault(); scelta = Math.min(voci.length - 1, scelta + 1); evidenzia(true); return; }
      if (k === "ArrowUp") { e.preventDefault(); scelta = Math.max(0, scelta - 1); evidenzia(true); return; }
      if (k === "Enter") { e.preventDefault(); conferma(); return; }
    }
    if (/^F\d+$/.test(k)) e.preventDefault();
    return;
  }

  // grandezza del testo e interlinea
  if (e.ctrlKey && !e.altKey) {
    const piu = k === "+" || k === "=" || k === "*" || e.code === "NumpadAdd";
    const meno = k === "-" || k === "_" || e.code === "NumpadSubtract";
    if (piu || meno) {
      e.preventDefault();
      if (e.shiftKey) {
        imp.lh = Math.round(Math.min(2.6, Math.max(1.2, imp.lh + (piu ? 0.1 : -0.1))) * 10) / 10;
        salvaImpostazioni(); applicaImpostazioni();
        mostraAvviso(`Interlinea ${imp.lh}`); timerAvviso = setTimeout(nascondiAvviso, 1200);
      } else zoom(piu ? 4 : -4);
      return;
    }
    if (k === "0") { e.preventDefault(); imp.fs = PREDEFINITE.fs; salvaImpostazioni(); applicaImpostazioni(); return; }
  }

  if (k === "Escape") {
    if (dettaturaAttiva) fermaDettatura();
    if (lettura || ("speechSynthesis" in window && speechSynthesis.speaking)) { zitto(); suono("stop"); }
    if (cambiate.size) { cambiate.clear(); disegna(); }
    if (document.activeElement === domanda && aperto) testo.focus();
    nascondiAvviso();
    return;
  }

  if (!/^F\d+$/.test(k) || k === "F11") return;
  e.preventDefault();
  if (e.repeat) return;   // tasto tenuto premuto: conta una volta sola

  switch (k) {
    case "F1": if (e.shiftKey) parla(AIUTO); else doveSono(); break;
    case "F2":
      imp.barra = !imp.barra; salvaImpostazioni(); applicaImpostazioni();
      if (imp.barra) { domanda.focus(); parla("Claude visibile."); } else { testo.focus(); parla("Solo testo."); }
      break;
    case "F3":
      if (e.shiftKey) {
        const i = (VELOCITA.indexOf(imp.velocita) + 1) % VELOCITA.length;
        imp.velocita = VELOCITA[i]; salvaImpostazioni(); parla(`Velocità ${String(imp.velocita).replace(".", " virgola ")}`);
      } else if (e.ctrlKey) {
        imp.autolettura = !imp.autolettura; salvaImpostazioni();
        parla(imp.autolettura ? "Leggo le risposte di Claude." : "Non leggo più le risposte di Claude.");
      } else if (document.activeElement === domanda || !aperto) parla(risposta.textContent);
      else leggiDalCursore();
      break;
    case "F4":
      if (e.shiftKey) { nuovaConversazione(); break; }
      if (!imp.barra) { imp.barra = true; salvaImpostazioni(); applicaImpostazioni(); }
      zitto(); domanda.focus(); suono("via");
      break;
    case "F5": if (dettaturaAttiva) fermaDettatura(); else iniziaDettatura(); break;
    case "F6": pannelloApri(); break;
    case "F7": pannelloNuovo(); break;
    case "F8": annullaClaude(); break;
    case "F9":
      imp.font = (imp.font + 1) % FONT.length; salvaImpostazioni(); applicaImpostazioni();
      parla("Carattere " + NOMI_FONT[imp.font]); break;
    case "F10":
      imp.tema = (imp.tema + 1) % TEMI.length; salvaImpostazioni(); applicaImpostazioni();
      parla("Colori: " + NOMI_TEMI[imp.tema]); break;
    case "F12": esportaWord(); break;
  }
}, true);

document.addEventListener("keyup", (e) => { if (e.key === "F5") e.preventDefault(); }, true);

document.addEventListener("wheel", (e) => {
  if (e.ctrlKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 2 : -2); }
}, { passive: false });

/* ------------------------------------------------------------ avvio */

setInterval(() => fetch("/api/ping").catch(() => statoSalvataggio("Programma chiuso?")), 20000);
fetch("/api/ping").catch(() => null);

(async function avvio() {
  applicaImpostazioni();
  try {
    const s = await api("/api/stato");
    if (!s.claude) risposta.textContent = "Attenzione: Claude Code non è installato o non è raggiungibile. L'editor funziona lo stesso.";
  } catch (e) { /* niente */ }
  if (imp.ultimo) {
    try { await api("/api/file?percorso=" + encodeURIComponent(imp.ultimo)); await apri(imp.ultimo, true); }
    catch (e) { imp.ultimo = ""; salvaImpostazioni(); }
  }
  setTimeout(() => parla(aperto ? "Clara Writer è pronto. " + etichetta(aperto).replace("›", ",") : "Clara Writer è pronto. Premi F6 per aprire un testo, F7 per crearne uno nuovo."), 600);
})();
