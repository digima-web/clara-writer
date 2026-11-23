# -*- coding: utf-8 -*-
"""
Clara Writer - local server

A large-print writing app for people with low vision, with Claude Code built in.

Started by "Clara Writer.bat" (pythonw server.py).
Listens on 127.0.0.1 only, so it cannot be reached from other computers.
Uses the Python standard library only.

Copyright (C) 2026 Francesco Bonomelli
This program is free software: you can redistribute it and/or modify it under the terms
of the GNU General Public License version 3. See the LICENSE file.
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

APP_DIR = Path(__file__).resolve().parent
WEB_DIR = APP_DIR / "web"
LANG_DIR = APP_DIR / "lang"
TEMPLATES = APP_DIR / "templates"
LOG_FILE = APP_DIR / "clara-writer.log"
VERSION_FILE = APP_DIR / "VERSION"

ON_WINDOWS = os.name == "nt"
NO_WINDOW = 0x08000000 if ON_WINDOWS else 0  # CREATE_NO_WINDOW
DEFAULT_LANG = "en"

# What Claude Code may and may not do (passed on every call, see run_claude)
ALLOWED_TOOLS = ["Read", "Edit", "Write", "MultiEdit", "Glob", "Grep", "LS", "WebSearch", "WebFetch",
                 "Bash(mkdir:*)", "Bash(mv:*)", "Bash(ls:*)", "Bash(wc:*)"]
DENIED_TOOLS = ["Bash(rm:*)", "Bash(rmdir:*)", "Bash(del:*)", "Bash(curl:*)", "Bash(wget:*)",
                "Bash(powershell:*)", "Bash(pwsh:*)", "Bash(cmd:*)", "Bash(npm:*)", "Bash(pip:*)", "Bash(git:*)"]


# ---------------------------------------------------------------- logging and configuration

def log(msg):
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S}  {msg}\n")
    except OSError:
        pass


def documents_folder():
    """The real Windows Documents folder (also when it has been moved to OneDrive)."""
    if ON_WINDOWS:
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
                path = ptr.value
                ctypes.windll.ole32.CoTaskMemFree(ptr)
                return Path(path)
        except Exception as e:  # noqa: BLE001
            log(f"Documents folder not found through the Windows API: {e}")
    return Path.home() / "Documents"


def load_languages():
    packs = {}
    for f in sorted(LANG_DIR.glob("*.json")):
        try:
            packs[f.stem] = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            log(f"Language file {f.name} is not valid: {e}")
    if DEFAULT_LANG not in packs:
        raise SystemExit("lang/en.json is missing")
    return packs


LANGS = load_languages()


def system_language():
    """Two-letter code of the Windows display language, if Clara Writer has it."""
    code = ""
    if ON_WINDOWS:
        try:
            import ctypes
            primary = ctypes.windll.kernel32.GetUserDefaultUILanguage() & 0x3FF
            code = {0x09: "en", 0x10: "it", 0x0A: "es", 0x0C: "fr", 0x07: "de", 0x16: "pt",
                    0x13: "nl", 0x15: "pl", 0x05: "cs", 0x1D: "sv", 0x06: "da", 0x14: "no"}.get(primary, "")
        except Exception:  # noqa: BLE001
            pass
    if not code:
        code = (os.environ.get("LANG") or os.environ.get("LANGUAGE") or "")[:2].lower()
    return code if code in LANGS else DEFAULT_LANG


def read_config():
    cfg = {"folder": "", "port": 8765, "claude_timeout": 180, "idle_shutdown": 90}
    f = APP_DIR / "config.json"
    if f.exists():
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            if "cartella" in data and "folder" not in data:  # old Italian key
                data["folder"] = data["cartella"]
            cfg.update(data)
        except (OSError, ValueError) as e:
            log(f"config.json is not valid: {e}")
    if cfg["folder"]:
        cfg["folder"] = Path(cfg["folder"])
    else:
        docs = documents_folder()
        legacy = docs / "Scrittura"  # first Italian versions used this folder
        cfg["folder"] = legacy if legacy.exists() else docs / "Clara Writer"
    return cfg


CFG = read_config()
ROOT = CFG["folder"]
WORKSPACE_FILE = ".clara.json"
WS = {"language": DEFAULT_LANG, "folders": dict(LANGS[DEFAULT_LANG]["folders"])}


def pack(code=None):
    return LANGS.get(code or WS["language"], LANGS[DEFAULT_LANG])


def T(key, **kw):
    """A server message in the current language (falls back to English)."""
    text = pack()["server"].get(key) or LANGS[DEFAULT_LANG]["server"].get(key, key)
    for k, v in kw.items():
        text = text.replace("{" + k + "}", str(v))
    return text


def folder(key):
    return ROOT / WS["folders"][key]


def service_folders():
    return {WS["folders"][k] for k in ("exports", "trash", "versions")} | {".claude", ".git"}


def save_workspace():
    write_text(ROOT / WORKSPACE_FILE, json.dumps(WS, ensure_ascii=False, indent=2))


def prepare_workspace():
    """Creates the writing folder the first time and loads its settings."""
    global ROOT
    ROOT.mkdir(parents=True, exist_ok=True)
    ROOT = ROOT.resolve()
    f = ROOT / WORKSPACE_FILE
    if f.exists():
        try:
            WS.update(json.loads(f.read_text(encoding="utf-8")))
        except (OSError, ValueError) as e:
            log(f"{WORKSPACE_FILE} is not valid: {e}")
    else:
        WS["language"] = system_language()
        # folders created by an earlier version keep their names
        chosen = None
        for code, p in LANGS.items():
            if (ROOT / p["folders"]["articles"]).exists():
                chosen = code
                if code == WS["language"]:
                    break
        WS["folders"] = dict(LANGS[chosen or WS["language"]]["folders"])
        save_workspace()
    for key in ("articles", "books", "exports", "trash", "versions"):
        folder(key).mkdir(exist_ok=True)
    claude_md = ROOT / "CLAUDE.md"
    template = TEMPLATES / f"CLAUDE.{WS['language']}.md"
    if not template.exists():
        template = TEMPLATES / "CLAUDE.en.md"
    if not claude_md.exists() and template.exists():
        text = template.read_text(encoding="utf-8")
        for k, v in WS["folders"].items():
            text = text.replace("{" + k + "}", v)
        text = text.replace("{notes}", pack()["notes_file"])
        write_text(claude_md, text)
    settings = ROOT / ".claude" / "settings.json"
    if not settings.exists() and (TEMPLATES / "settings.json").exists():
        settings.parent.mkdir(exist_ok=True)
        shutil.copy(TEMPLATES / "settings.json", settings)


# ---------------------------------------------------------------- safe paths and files

def safe(rel):
    """Turns a relative path into an absolute one, only if it stays inside the writing folder."""
    if not rel or not isinstance(rel, str):
        raise ValueError(T("missingPath"))
    p = (ROOT / rel).resolve()
    if p != ROOT and ROOT not in p.parents:
        raise ValueError(T("outsideFolder"))
    return p


def relative(p):
    return p.relative_to(ROOT).as_posix()


def clean_name(title):
    t = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", title or "").strip().strip(".")
    return re.sub(r"\s+", " ", t)[:80]


def markdown_files():
    """All working .md files (service folders excluded)."""
    found = {}
    skip = service_folders()
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in skip]
        for f in files:
            if f.lower().endswith(".md"):
                p = Path(base) / f
                found[relative(p)] = p
    return found


def read_text(p):
    return p.read_text(encoding="utf-8", errors="replace")


def write_text(p, text):
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, p)


# ---------------------------------------------------------------- list and create texts

def list_texts():
    items = []
    art = folder("articles")
    if art.exists():
        for f in sorted(art.glob("*.md"), key=lambda x: x.stat().st_mtime, reverse=True):
            items.append({"type": "article", "path": relative(f), "name": f.stem, "book": ""})
    books = []
    lib = folder("books")
    if lib.exists():
        for d in sorted(x for x in lib.iterdir() if x.is_dir()):
            books.append(d.name)
            for f in sorted(d.glob("*.md")):
                items.append({"type": "chapter", "path": relative(f), "name": f.stem, "book": d.name})
    return {"items": items, "books": books}


def new_text(kind, title, book=""):
    title = clean_name(title)
    if not title:
        raise ValueError(T("missingTitle"))
    if kind == "article":
        p = folder("articles") / f"{datetime.now():%Y-%m} {title}.md"
        heading = title
    elif kind == "book":
        d = folder("books") / title
        if d.exists():
            raise ValueError(T("bookExists"))
        d.mkdir(parents=True)
        write_text(d / f"{pack()['notes_file']}.md", f"# {T('notesTitle', book=title)}\n\n")
        heading = pack()["chapter_default"]
        p = d / f"01 {heading}.md"
    elif kind == "chapter":
        d = folder("books") / clean_name(book)
        if not book or not d.is_dir():
            raise ValueError(T("bookNotFound"))
        numbers = [int(m.group(1)) for f in d.glob("*.md") if (m := re.match(r"(\d+)", f.name))]
        p = d / f"{(max(numbers) + 1 if numbers else 1):02d} {title}.md"
        heading = title
    else:
        raise ValueError(T("unknownType"))
    if p.exists():
        raise ValueError(T("textExists"))
    write_text(p, f"# {heading}\n\n")
    return relative(p)


# ---------------------------------------------------------------- Claude Code

STATE = {"busy": False, "session": None, "last_ping": None}
LOCK = threading.Lock()


def find_claude():
    found = shutil.which("claude")
    if found:
        return found
    for c in [Path.home() / ".local" / "bin" / "claude.exe", Path.home() / ".local" / "bin" / "claude"]:
        if c.exists():
            return str(c)
    return None


def run_claude(request, session):
    exe = find_claude()
    if not exe:
        return {"is_error": True, "result": T("claudeNotFound")}
    args = [exe, "-p", "--output-format", "json",
            "--append-system-prompt", pack()["claude_voice"],
            "--permission-mode", "acceptEdits",
            "--allowedTools", ",".join(ALLOWED_TOOLS),
            "--disallowedTools", ",".join(DENIED_TOOLS)]
    if session:
        args += ["--resume", session]
    env = dict(os.environ)
    if ON_WINDOWS and not env.get("CLAUDE_CODE_GIT_BASH_PATH"):
        for base in [os.environ.get("ProgramFiles", ""), os.environ.get("LOCALAPPDATA", "") + r"\Programs"]:
            bash = Path(base) / "Git" / "bin" / "bash.exe"
            if base and bash.exists():
                env["CLAUDE_CODE_GIT_BASH_PATH"] = str(bash)
                break
    try:
        r = subprocess.run(args, input=request, cwd=str(ROOT), capture_output=True, text=True, env=env,
                           encoding="utf-8", errors="replace", timeout=CFG["claude_timeout"],
                           creationflags=NO_WINDOW)
    except subprocess.TimeoutExpired:
        return {"is_error": True, "timeout": True, "result": T("claudeTimeout")}
    except OSError as e:
        return {"is_error": True, "result": T("claudeCannotStart", error=e)}
    for line in reversed(r.stdout.strip().splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except ValueError:
                continue
    log(f"Unreadable reply from Claude. stdout={r.stdout[-500:]!r} stderr={r.stderr[-500:]!r}")
    return {"is_error": True, "result": T("claudeBadReply")}


def ask_claude(data):
    # 1. save the editor text
    current = data.get("path") or ""
    if current and isinstance(data.get("content"), str):
        write_text(safe(current), data["content"])

    # 2. snapshot of every text before the request
    before = {rel: read_text(p) for rel, p in markdown_files().items()}

    context = []
    if current:
        context.append(T("openedFile", path=current))
        if data.get("line"):
            context.append(T("cursorLine", line=data["line"]))
        if data.get("selection"):
            context.append(T("selection") + "\n" + data["selection"][:4000])
    else:
        context.append(T("noFile"))
    request = "\n".join(context) + "\n\n" + T("authorRequest") + "\n" + data.get("request", "").strip()

    # 3. run
    result = run_claude(request, STATE["session"])
    if result.get("is_error") and STATE["session"] and not result.get("timeout"):
        log("Resuming the conversation failed, starting a new one")
        STATE["session"] = None
        result = run_claude(request, None)
    if result.get("session_id"):
        STATE["session"] = result["session_id"]
    if result.get("permission_denials"):
        log(f"Permissions denied to Claude: {json.dumps(result['permission_denials'], ensure_ascii=False)[:1500]}")

    # 4. compare: what changed
    after = {rel: read_text(p) for rel, p in markdown_files().items()}
    changed = sorted(r for r in before if r in after and before[r] != after[r])
    deleted = sorted(r for r in before if r not in after)
    created = sorted(r for r in after if r not in before)

    undoable = False
    if changed or deleted or created:
        stamp = datetime.now().strftime("%Y-%m-%d %H-%M-%S")
        d, n = folder("versions") / stamp, 2
        while d.exists():  # two requests in the same second
            d, n = folder("versions") / f"{stamp} ({n})", n + 1
        for rel in changed + deleted:
            write_text(d / rel, before[rel])
        write_text(d / "manifest.json", json.dumps({
            "request": data.get("request", ""), "changed": changed,
            "deleted": deleted, "created": created, "undone": False,
        }, ensure_ascii=False, indent=2))
        undoable = True
        log(f"Claude changed: changed={changed} deleted={deleted} created={created}")

    text = result.get("result") or ""
    if result.get("is_error") and not text:
        text = T("genericError")
    return {"reply": text.strip(), "error": bool(result.get("is_error")),
            "changed": changed, "deleted": deleted, "created": created, "undoable": undoable}


def undo_last():
    versions = folder("versions")
    candidates = sorted((d for d in versions.iterdir() if (d / "manifest.json").exists()), reverse=True) \
        if versions.exists() else []
    for d in candidates:
        m = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
        # manifests written by the first Italian version
        m.setdefault("changed", m.get("modificati", []))
        m.setdefault("deleted", m.get("eliminati", []))
        m.setdefault("created", m.get("creati", []))
        if m.get("undone") or m.get("annullato"):
            continue
        for rel in m["changed"] + m["deleted"]:
            write_text(safe(rel), read_text(d / rel))
        for rel in m["created"]:
            p = safe(rel)
            if p.exists():
                dest = folder("trash") / f"{p.stem} {T('undoneSuffix', stamp=d.name)}{p.suffix}"
                shutil.move(str(p), str(dest))
        m["undone"] = True
        write_text(d / "manifest.json", json.dumps(m, ensure_ascii=False, indent=2))
        n = len(m["changed"]) + len(m["deleted"]) + len(m["created"])
        return {"ok": True, "message": T("undone", n=n), "files": m["changed"] + m["deleted"]}
    return {"ok": False, "message": T("nothingToUndo")}


# ---------------------------------------------------------------- export to Word

def find_pandoc():
    found = shutil.which("pandoc")
    if found:
        return found
    for base in [os.environ.get("LOCALAPPDATA", ""), os.environ.get("ProgramFiles", ""),
                 os.environ.get("ProgramFiles(x86)", "")]:
        c = Path(base) / "Pandoc" / "pandoc.exe"
        if base and c.exists():
            return str(c)
    return None


def export_word(rel):
    pandoc = find_pandoc()
    if not pandoc:
        raise ValueError(T("pandocMissing"))
    p = safe(rel)
    parts = p.relative_to(ROOT).parts
    page_break = '\n\n```{=openxml}\n<w:p><w:r><w:br w:type="page"/></w:r></w:p>\n```\n\n'
    meta = []
    out_folder = WS["folders"]["exports"]
    if len(parts) >= 3 and parts[0] == WS["folders"]["books"]:
        book = folder("books") / parts[1]
        chapters = [f for f in sorted(book.glob("*.md")) if not f.name.startswith("00")]
        text = page_break.join(read_text(f).strip() for f in chapters)
        name = parts[1]
        meta = ["-M", f"title={parts[1]}"]
        message = T("exportedBook", name=name, n=len(chapters), folder=out_folder)
    else:
        text = read_text(p)
        name = p.stem
        message = T("exportedArticle", name=name, folder=out_folder)
    output = folder("exports") / f"{name}.docx"
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as t:
        t.write(text)
        source = t.name
    args = [pandoc, "-f", "markdown", "-t", "docx", "-o", str(output), *meta, source]
    reference = TEMPLATES / "reference.docx"
    if reference.exists():
        args[1:1] = ["--reference-doc", str(reference)]
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=120, creationflags=NO_WINDOW)
    finally:
        os.unlink(source)
    if r.returncode != 0:
        log(f"Pandoc: {r.stderr}")
        raise ValueError(T("pandocFailed"))
    if ON_WINDOWS:
        try:
            os.startfile(str(output.parent))  # opens the exports folder
        except OSError:
            pass
    return {"ok": True, "message": message, "file": relative(output)}


# ---------------------------------------------------------------- HTTP

CONTENT_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon",
                 ".woff2": "font/woff2", ".ttf": "font/ttf", ".json": "application/json; charset=utf-8",
                 ".png": "image/png"}


def language_info():
    return {"code": WS["language"], "pack": pack(), "folders": WS["folders"],
            "available": [{"code": c, "name": p["name"]} for c, p in LANGS.items()]}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}

    def same_origin(self):
        # only requests coming from the Clara Writer page itself
        origin = self.headers.get("Origin")
        return origin in (None, f"http://127.0.0.1:{CFG['port']}", f"http://localhost:{CFG['port']}")

    def do_GET(self):
        url = urlparse(self.path)
        q = parse_qs(url.query)
        try:
            if url.path == "/api/ping":
                STATE["last_ping"] = time.time()
                return self.reply(200, {"ok": True, "busy": STATE["busy"]})
            if url.path == "/api/status":
                version = VERSION_FILE.read_text().strip() if VERSION_FILE.exists() else "dev"
                return self.reply(200, {"folder": str(ROOT), "claude": bool(find_claude()),
                                        "pandoc": bool(find_pandoc()), "version": version})
            if url.path == "/api/lang":
                return self.reply(200, language_info())
            if url.path == "/api/list":
                return self.reply(200, list_texts())
            if url.path == "/api/file":
                p = safe(q.get("path", [""])[0])
                if not p.is_file():
                    return self.reply(404, {"error": T("fileNotFound")})
                return self.reply(200, {"path": relative(p), "content": read_text(p)})
            return self.static(url.path)
        except ValueError as e:
            return self.reply(400, {"error": str(e)})

    def static(self, path):
        name = "index.html" if path in ("/", "") else path.lstrip("/")
        p = (WEB_DIR / name).resolve()
        if WEB_DIR.resolve() not in p.parents or not p.is_file():
            self.send_error(404)
            return
        data = p.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(p.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if not self.same_origin():
            return self.reply(403, {"error": T("notAllowed")})
        url = urlparse(self.path)
        try:
            data = self.body()
            if url.path == "/api/save":
                p = safe(data["path"])
                if p.suffix.lower() != ".md":
                    raise ValueError(T("onlyMd"))
                write_text(p, data.get("content", ""))
                return self.reply(200, {"ok": True})
            if url.path == "/api/new":
                return self.reply(200, {"ok": True, "path": new_text(
                    data.get("type"), data.get("title"), data.get("book", ""))})
            if url.path == "/api/claude":
                if not LOCK.acquire(blocking=False):
                    return self.reply(409, {"error": T("busy")})
                STATE["busy"] = True
                try:
                    return self.reply(200, ask_claude(data))
                finally:
                    STATE["busy"] = False
                    LOCK.release()
            if url.path == "/api/new-conversation":
                STATE["session"] = None
                return self.reply(200, {"ok": True})
            if url.path == "/api/undo":
                return self.reply(200, undo_last())
            if url.path == "/api/export":
                return self.reply(200, export_word(data["path"]))
            if url.path == "/api/lang":
                code = data.get("code")
                if code not in LANGS:
                    raise ValueError(T("unknownType"))
                WS["language"] = code
                save_workspace()
                return self.reply(200, language_info())
            if url.path == "/api/log":
                log("editor: " + str(data.get("msg", ""))[:300])
                return self.reply(200, {"ok": True})
            return self.reply(404, {"error": T("unknownCommand")})
        except (ValueError, KeyError, OSError) as e:
            log(f"Error {url.path}: {e}")
            return self.reply(400, {"error": str(e)})


def watchdog():
    """Shuts the server down when the editor window has been closed."""
    while True:
        time.sleep(10)
        last = STATE["last_ping"]
        if last and not STATE["busy"] and time.time() - last > CFG["idle_shutdown"]:
            log("Window closed, shutting down")
            os._exit(0)


def main():
    prepare_workspace()
    try:
        server = ThreadingHTTPServer(("127.0.0.1", int(CFG["port"])), Handler)
    except OSError:
        log("Server already running, exiting")
        sys.exit(0)
    log(f"Start. Folder: {ROOT}  Language: {WS['language']}  Claude: {find_claude()}  Pandoc: {find_pandoc()}")
    threading.Thread(target=watchdog, daemon=True).start()
    server.serve_forever()


if __name__ == "__main__":
    main()
