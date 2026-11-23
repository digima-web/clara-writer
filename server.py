# -*- coding: utf-8 -*-
"""
Clara Writer - server locale
Editor per scrittori ipovedenti con Claude Code integrato.

Avvio: pythonw server.py  (lo fa Clara Writer.bat)
Ascolta solo su 127.0.0.1, quindi non e' raggiungibile da altri computer.
Usa solo la libreria standard di Python.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PROGRAMMA = Path(__file__).resolve().parent
WEB = PROGRAMMA / "web"
MODELLI = PROGRAMMA / "modelli"
LOG = PROGRAMMA / "scrittoio.log"

SOTTOCARTELLE = ["Articoli", "Libri", "Esportati", "Cestino", "Versioni"]
ESCLUSE = {"Esportati", "Cestino", "Versioni", ".claude", ".git"}
SU_WINDOWS = os.name == "nt"
SENZA_FINESTRA = 0x08000000 if SU_WINDOWS else 0  # CREATE_NO_WINDOW

PERMESSI = ["Read", "Edit", "Write", "MultiEdit", "Glob", "Grep", "LS", "WebSearch", "WebFetch",
            "Bash(mkdir:*)", "Bash(mv:*)", "Bash(ls:*)", "Bash(wc:*)"]
VIETATI = ["Bash(rm:*)", "Bash(rmdir:*)", "Bash(del:*)", "Bash(curl:*)", "Bash(wget:*)",
           "Bash(powershell:*)", "Bash(pwsh:*)", "Bash(cmd:*)", "Bash(npm:*)", "Bash(pip:*)", "Bash(git:*)"]

ISTRUZIONI_VOCE = (
    "Le tue risposte vengono mostrate in grande e lette a voce a un autore che vede molto poco. "
    "Rispondi in italiano, con frasi brevi e semplici, in testo normale: niente markdown, "
    "niente tabelle, niente elenchi lunghi, niente simboli. Inizia dicendo cosa hai fatto o trovato. "
    "Non modificare mai il testo se non te lo chiede esplicitamente. Segui le regole di CLAUDE.md."
)


# ---------------------------------------------------------------- configurazione

def log(msg):
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S}  {msg}\n")
    except OSError:
        pass


def cartella_documenti():
    """Cartella Documenti vera di Windows (anche se spostata su OneDrive)."""
    if SU_WINDOWS:
        try:
            import ctypes
            from ctypes import wintypes

            class GUID(ctypes.Structure):
                _fields_ = [("Data1", wintypes.DWORD), ("Data2", wintypes.WORD),
                            ("Data3", wintypes.WORD), ("Data4", wintypes.BYTE * 8)]

            fid = GUID(0xFDD39AD0, 0x238F, 0x46AF,
                       (wintypes.BYTE * 8)(0xAD, 0xB4, 0x6C, 0x85, 0x48, 0x03, 0x69, 0xC7))
            ptr = ctypes.c_wchar_p()
            if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(fid), 0, None, ctypes.byref(ptr)) == 0:
                percorso = ptr.value
                ctypes.windll.ole32.CoTaskMemFree(ptr)
                return Path(percorso)
        except Exception as e:  # noqa: BLE001
            log(f"Documenti non trovati con l'API di Windows: {e}")
    return Path.home() / "Documents"


def leggi_config():
    cfg = {"cartella": "", "porta": 8765, "timeout_claude": 180, "chiusura_dopo_secondi": 90}
    file = PROGRAMMA / "config.json"
    if file.exists():
        try:
            cfg.update(json.loads(file.read_text(encoding="utf-8")))
        except (OSError, ValueError) as e:
            log(f"config.json non valido: {e}")
    cfg["cartella"] = Path(cfg["cartella"]) if cfg["cartella"] else cartella_documenti() / "Scrittura"
    return cfg


CFG = leggi_config()
RADICE = CFG["cartella"].resolve() if CFG["cartella"].exists() else CFG["cartella"]


def prepara_cartella():
    RADICE.mkdir(parents=True, exist_ok=True)
    for nome in SOTTOCARTELLE:
        (RADICE / nome).mkdir(exist_ok=True)
    claude_md = RADICE / "CLAUDE.md"
    if not claude_md.exists() and (MODELLI / "CLAUDE.md").exists():
        shutil.copy(MODELLI / "CLAUDE.md", claude_md)
    impostazioni = RADICE / ".claude" / "settings.json"
    if not impostazioni.exists() and (MODELLI / "settings.json").exists():
        impostazioni.parent.mkdir(exist_ok=True)
        shutil.copy(MODELLI / "settings.json", impostazioni)


# ---------------------------------------------------------------- percorsi sicuri

def sicuro(rel):
    """Trasforma un percorso relativo in assoluto, solo se resta dentro la cartella."""
    if not rel or not isinstance(rel, str):
        raise ValueError("Percorso mancante")
    p = (RADICE / rel).resolve()
    if p != RADICE and RADICE not in p.parents:
        raise ValueError("Percorso fuori dalla cartella di scrittura")
    return p


def relativo(p):
    return p.relative_to(RADICE).as_posix()


def nome_pulito(titolo):
    t = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", titolo or "").strip().strip(".")
    return re.sub(r"\s+", " ", t)[:80]


def file_md():
    """Tutti i file .md di lavoro (escluse le cartelle di servizio)."""
    trovati = {}
    for radice, cartelle, files in os.walk(RADICE):
        cartelle[:] = [c for c in cartelle if c not in ESCLUSE]
        for f in files:
            if f.lower().endswith(".md"):
                p = Path(radice) / f
                trovati[relativo(p)] = p
    return trovati


def leggi(p):
    return p.read_text(encoding="utf-8", errors="replace")


def scrivi(p, testo):
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(testo, encoding="utf-8", newline="\n")
    os.replace(tmp, p)


# ---------------------------------------------------------------- elenco dei testi

def elenco():
    voci = []
    art = RADICE / "Articoli"
    if art.exists():
        for f in sorted(art.glob("*.md"), key=lambda x: x.stat().st_mtime, reverse=True):
            voci.append({"tipo": "articolo", "percorso": relativo(f), "nome": f.stem, "libro": ""})
    libri = []
    lib = RADICE / "Libri"
    if lib.exists():
        for d in sorted(x for x in lib.iterdir() if x.is_dir()):
            libri.append(d.name)
            for f in sorted(d.glob("*.md")):
                voci.append({"tipo": "capitolo", "percorso": relativo(f), "nome": f.stem, "libro": d.name})
    return {"voci": voci, "libri": libri}


def nuovo(tipo, titolo, libro=""):
    titolo = nome_pulito(titolo)
    if not titolo:
        raise ValueError("Manca il titolo")
    if tipo == "articolo":
        p = RADICE / "Articoli" / f"{datetime.now():%Y-%m} {titolo}.md"
        intestazione = titolo
    elif tipo == "libro":
        d = RADICE / "Libri" / titolo
        if d.exists():
            raise ValueError("Esiste gia' un libro con questo titolo")
        d.mkdir(parents=True)
        scrivi(d / "00 Indice e note.md", f"# {titolo}: indice e note\n\n")
        p = d / "01 Capitolo 1.md"
        intestazione = "Capitolo 1"
    elif tipo == "capitolo":
        d = RADICE / "Libri" / nome_pulito(libro)
        if not libro or not d.is_dir():
            raise ValueError("Libro non trovato")
        numeri = [int(m.group(1)) for f in d.glob("*.md") if (m := re.match(r"(\d+)", f.name))]
        p = d / f"{(max(numeri) + 1 if numeri else 1):02d} {titolo}.md"
        intestazione = titolo
    else:
        raise ValueError("Tipo sconosciuto")
    if p.exists():
        raise ValueError("Esiste gia' un testo con questo nome")
    scrivi(p, f"# {intestazione}\n\n")
    return relativo(p)


# ---------------------------------------------------------------- Claude Code

STATO = {"occupato": False, "sessione": None, "ultimo_ping": None}
BLOCCO = threading.Lock()


def trova_claude():
    trovato = shutil.which("claude")
    if trovato:
        return trovato
    for c in [Path.home() / ".local" / "bin" / "claude.exe", Path.home() / ".local" / "bin" / "claude"]:
        if c.exists():
            return str(c)
    return None


def esegui_claude(richiesta, sessione):
    exe = trova_claude()
    if not exe:
        return {"is_error": True, "result": "Non trovo Claude Code su questo computer."}
    args = [exe, "-p", "--output-format", "json", "--append-system-prompt", ISTRUZIONI_VOCE,
            "--permission-mode", "acceptEdits",
            "--allowedTools", ",".join(PERMESSI),
            "--disallowedTools", ",".join(VIETATI)]
    if sessione:
        args += ["--resume", sessione]
    ambiente = dict(os.environ)
    if SU_WINDOWS and not ambiente.get("CLAUDE_CODE_GIT_BASH_PATH"):
        for base in [os.environ.get("ProgramFiles", ""), os.environ.get("LOCALAPPDATA", "") + r"\Programs"]:
            bash = Path(base) / "Git" / "bin" / "bash.exe"
            if base and bash.exists():
                ambiente["CLAUDE_CODE_GIT_BASH_PATH"] = str(bash)
                break
    try:
        r = subprocess.run(args, input=richiesta, cwd=str(RADICE), capture_output=True, text=True, env=ambiente,
                           encoding="utf-8", errors="replace", timeout=CFG["timeout_claude"],
                           creationflags=SENZA_FINESTRA)
    except subprocess.TimeoutExpired:
        return {"is_error": True, "timeout": True,
                "result": "Claude ci ha messo troppo tempo e l'ho fermato. Il testo non e' cambiato."}
    except OSError as e:
        return {"is_error": True, "result": f"Non riesco ad avviare Claude Code: {e}"}
    for riga in reversed(r.stdout.strip().splitlines()):
        riga = riga.strip()
        if riga.startswith("{"):
            try:
                return json.loads(riga)
            except ValueError:
                continue
    log(f"Risposta di Claude non leggibile. stdout={r.stdout[-500:]!r} stderr={r.stderr[-500:]!r}")
    return {"is_error": True, "result": "Claude non ha risposto come previsto.", "dettaglio": r.stderr[-300:]}


def chiedi_a_claude(dati):
    # 1. salva il testo dell'editor
    aperto = dati.get("percorso") or ""
    if aperto and isinstance(dati.get("contenuto"), str):
        scrivi(sicuro(aperto), dati["contenuto"])

    # 2. fotografia di tutti i testi prima della richiesta
    prima = {rel: leggi(p) for rel, p in file_md().items()}

    contesto = []
    if aperto:
        contesto.append(f"L'autore ha aperto il file: {aperto}")
        if dati.get("riga"):
            contesto.append(f"Il cursore e' alla riga {dati['riga']}.")
        if dati.get("selezione"):
            contesto.append("Testo selezionato dall'autore:\n" + dati["selezione"][:4000])
    else:
        contesto.append("L'autore non ha nessun file aperto.")
    richiesta = "\n".join(contesto) + "\n\nRichiesta dell'autore:\n" + dati.get("richiesta", "").strip()

    # 3. esecuzione
    esito = esegui_claude(richiesta, STATO["sessione"])
    if esito.get("is_error") and STATO["sessione"] and not esito.get("timeout"):
        log("Ripresa conversazione fallita, ne apro una nuova")
        STATO["sessione"] = None
        esito = esegui_claude(richiesta, None)
    if esito.get("session_id"):
        STATO["sessione"] = esito["session_id"]
    if esito.get("permission_denials"):
        log(f"Permessi negati a Claude: {json.dumps(esito['permission_denials'], ensure_ascii=False)[:1500]}")

    # 4. confronto: cosa e' cambiato
    dopo = {rel: leggi(p) for rel, p in file_md().items()}
    modificati = sorted(r for r in prima if r in dopo and prima[r] != dopo[r])
    eliminati = sorted(r for r in prima if r not in dopo)
    creati = sorted(r for r in dopo if r not in prima)

    copia = None
    if modificati or eliminati or creati:
        copia = datetime.now().strftime("%Y-%m-%d %H-%M-%S")
        d, n = RADICE / "Versioni" / copia, 2
        while d.exists():  # due richieste nello stesso secondo
            d, n = RADICE / "Versioni" / f"{copia} ({n})", n + 1
        for rel in modificati + eliminati:
            scrivi(d / rel, prima[rel])
        scrivi(d / "manifest.json", json.dumps({
            "richiesta": dati.get("richiesta", ""), "modificati": modificati,
            "eliminati": eliminati, "creati": creati, "annullato": False,
        }, ensure_ascii=False, indent=2))
        log(f"Claude ha cambiato: mod={modificati} el={eliminati} cr={creati}")

    testo = esito.get("result") or ""
    if esito.get("is_error") and not testo:
        testo = "Si e' verificato un errore."
    return {"risposta": testo.strip(), "errore": bool(esito.get("is_error")),
            "modificati": modificati, "eliminati": eliminati, "creati": creati,
            "annullabile": copia is not None}


def annulla_ultimo():
    versioni = RADICE / "Versioni"
    candidati = sorted((d for d in versioni.iterdir() if (d / "manifest.json").exists()), reverse=True) \
        if versioni.exists() else []
    for d in candidati:
        m = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
        if m.get("annullato"):
            continue
        for rel in m["modificati"] + m["eliminati"]:
            scrivi(sicuro(rel), leggi(d / rel))
        for rel in m["creati"]:
            p = sicuro(rel)
            if p.exists():
                dest = RADICE / "Cestino" / f"{p.stem} (annullato {d.name}){p.suffix}"
                shutil.move(str(p), str(dest))
        m["annullato"] = True
        scrivi(d / "manifest.json", json.dumps(m, ensure_ascii=False, indent=2))
        n = len(m["modificati"]) + len(m["eliminati"]) + len(m["creati"])
        return {"ok": True, "messaggio": f"Ho annullato la modifica di Claude su {n} file.",
                "file": m["modificati"] + m["eliminati"]}
    return {"ok": False, "messaggio": "Non ci sono modifiche di Claude da annullare."}


# ---------------------------------------------------------------- esportazione Word

def trova_pandoc():
    trovato = shutil.which("pandoc")
    if trovato:
        return trovato
    for base in [os.environ.get("LOCALAPPDATA", ""), os.environ.get("ProgramFiles", ""),
                 os.environ.get("ProgramFiles(x86)", "")]:
        c = Path(base) / "Pandoc" / "pandoc.exe"
        if base and c.exists():
            return str(c)
    return None


def esporta(rel):
    pandoc = trova_pandoc()
    if not pandoc:
        raise ValueError("Non trovo Pandoc: serve per creare il file Word.")
    p = sicuro(rel)
    parti = p.relative_to(RADICE).parts
    salto = '\n\n```{=openxml}\n<w:p><w:r><w:br w:type="page"/></w:r></w:p>\n```\n\n'
    meta = []
    if len(parti) >= 3 and parti[0] == "Libri":
        libro = RADICE / "Libri" / parti[1]
        capitoli = [f for f in sorted(libro.glob("*.md")) if not f.name.startswith("00")]
        testo = salto.join(leggi(f).strip() for f in capitoli)
        nome = parti[1]
        meta = ["-M", f"title={parti[1]}"]
        descrizione = f"il libro {parti[1]}, {len(capitoli)} capitoli"
    else:
        testo = leggi(p)
        nome = p.stem
        descrizione = f"l'articolo {p.stem}"
    uscita = RADICE / "Esportati" / f"{nome}.docx"
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as t:
        t.write(testo)
        sorgente = t.name
    args = [pandoc, "-f", "markdown", "-t", "docx", "-o", str(uscita), *meta, sorgente]
    modello = PROGRAMMA / "modelli" / "modello.docx"
    if modello.exists():
        args[1:1] = ["--reference-doc", str(modello)]
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=120, creationflags=SENZA_FINESTRA)
    finally:
        os.unlink(sorgente)
    if r.returncode != 0:
        log(f"Pandoc: {r.stderr}")
        raise ValueError("Pandoc non e' riuscito a creare il file Word. Il file e' forse aperto in Word?")
    if SU_WINDOWS:
        try:
            os.startfile(str(uscita.parent))  # apre la cartella Esportati
        except OSError:
            pass
    return {"ok": True, "messaggio": f"Ho esportato in Word {descrizione}. Il file e' nella cartella Esportati.",
            "file": relativo(uscita)}


# ---------------------------------------------------------------- HTTP

TIPI = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon",
        ".woff2": "font/woff2", ".ttf": "font/ttf"}


class Gestore(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def rispondi(self, codice, dati):
        corpo = json.dumps(dati, ensure_ascii=False).encode("utf-8")
        self.send_response(codice)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(corpo)

    def corpo(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}

    def stesso_sito(self):
        # accetta solo richieste dalla pagina di Clara Writer stesso
        origine = self.headers.get("Origin")
        return origine in (None, f"http://127.0.0.1:{CFG['porta']}", f"http://localhost:{CFG['porta']}")

    def do_GET(self):
        url = urlparse(self.path)
        q = parse_qs(url.query)
        try:
            if url.path == "/api/ping":
                STATO["ultimo_ping"] = time.time()
                return self.rispondi(200, {"ok": True, "occupato": STATO["occupato"]})
            if url.path == "/api/stato":
                return self.rispondi(200, {"cartella": str(RADICE), "claude": bool(trova_claude()),
                                           "pandoc": bool(trova_pandoc())})
            if url.path == "/api/elenco":
                return self.rispondi(200, elenco())
            if url.path == "/api/file":
                p = sicuro(q.get("percorso", [""])[0])
                if not p.is_file():
                    return self.rispondi(404, {"errore": "File non trovato"})
                return self.rispondi(200, {"percorso": relativo(p), "contenuto": leggi(p)})
            return self.statico(url.path)
        except ValueError as e:
            return self.rispondi(400, {"errore": str(e)})

    def statico(self, percorso):
        nome = "index.html" if percorso in ("/", "") else percorso.lstrip("/")
        p = (WEB / nome).resolve()
        if WEB.resolve() not in p.parents or not p.is_file():
            self.send_error(404)
            return
        dati = p.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", TIPI.get(p.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(dati)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(dati)

    def do_POST(self):
        if not self.stesso_sito():
            return self.rispondi(403, {"errore": "Richiesta non permessa"})
        url = urlparse(self.path)
        try:
            dati = self.corpo()
            if url.path == "/api/salva":
                p = sicuro(dati["percorso"])
                if p.suffix.lower() != ".md":
                    raise ValueError("Si possono salvare solo file .md")
                scrivi(p, dati.get("contenuto", ""))
                return self.rispondi(200, {"ok": True})
            if url.path == "/api/nuovo":
                return self.rispondi(200, {"ok": True, "percorso": nuovo(
                    dati.get("tipo"), dati.get("titolo"), dati.get("libro", ""))})
            if url.path == "/api/claude":
                if not BLOCCO.acquire(blocking=False):
                    return self.rispondi(409, {"errore": "Claude sta gia' lavorando"})
                STATO["occupato"] = True
                try:
                    return self.rispondi(200, chiedi_a_claude(dati))
                finally:
                    STATO["occupato"] = False
                    BLOCCO.release()
            if url.path == "/api/log":
                log("editor: " + str(dati.get("msg", ""))[:300])
                return self.rispondi(200, {"ok": True})
            if url.path == "/api/nuova-conversazione":
                STATO["sessione"] = None
                return self.rispondi(200, {"ok": True})
            if url.path == "/api/annulla":
                return self.rispondi(200, annulla_ultimo())
            if url.path == "/api/esporta":
                return self.rispondi(200, esporta(dati["percorso"]))
            return self.rispondi(404, {"errore": "Comando sconosciuto"})
        except (ValueError, KeyError, OSError) as e:
            log(f"Errore {url.path}: {e}")
            return self.rispondi(400, {"errore": str(e)})


def sorveglianza():
    """Spegne il server quando la finestra dell'editor viene chiusa."""
    while True:
        time.sleep(10)
        ultimo = STATO["ultimo_ping"]
        if ultimo and not STATO["occupato"] and time.time() - ultimo > CFG["chiusura_dopo_secondi"]:
            log("Finestra chiusa, spengo il server")
            os._exit(0)


def main():
    global RADICE
    prepara_cartella()
    RADICE = RADICE.resolve()
    try:
        server = ThreadingHTTPServer(("127.0.0.1", int(CFG["porta"])), Gestore)
    except OSError:
        log("Server gia' avviato, esco")
        sys.exit(0)
    log(f"Avvio. Cartella: {RADICE}  Claude: {trova_claude()}  Pandoc: {trova_pandoc()}")
    threading.Thread(target=sorveglianza, daemon=True).start()
    server.serve_forever()


if __name__ == "__main__":
    main()
