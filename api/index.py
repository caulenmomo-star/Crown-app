#!/usr/bin/env python3
"""
Crown - local helper server.

Runs only on this computer (127.0.0.1). It:
  * serves the Crown app in your browser
  * saves your encrypted data to the "data" folder and keeps automatic backups
  * reads order emails from your inboxes over IMAP (read-only, never marks mail as read)
  * optionally asks EasyPost for live package tracking

Uses only the Python standard library - nothing to install.
Your data is encrypted in the browser before it ever reaches this server.
"""
import base64
import datetime
import email
import hashlib
import imaplib
import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from email import policy
from email.header import decode_header, make_header
from email.utils import getaddresses, parsedate_to_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "0.4.7"  # prerelease - stays 0.x until Crown is finished
HOST = "127.0.0.1"
BASE_PORT = int(os.environ.get("CROWN_PORT", "8787"))
ROOT = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(ROOT, "app")


def default_data_dir():
    """A fixed home for your data, separate from the app folder, so updating Crown never touches it."""
    home = os.path.expanduser("~")
    if sys.platform == "darwin":
        return os.path.join(home, "Library", "Application Support", "Crown")
    if os.name == "nt":
        return os.path.join(os.environ.get("APPDATA") or home, "Crown")
    return os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.join(home, ".local", "share"), "Crown")


DATA_DIR = os.environ.get("CROWN_DATA") or default_data_dir()
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
VAULT_PATH = os.path.join(DATA_DIR, "vault.json")
MAX_BACKUPS = 60
BACKUP_EVERY_SECONDS = 15 * 60
MAX_BODY = 25 * 1024 * 1024
MAX_MSG_BYTES = 1500000  # read at most 1.5 MB per email (skips huge attachments)
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
VAULT_LOCK = threading.Lock()
PORT = BASE_PORT


class UserError(Exception):
    """An error with a message meant for the person using the app."""


# ---------------------------------------------------------------- TLS

_ssl_ctx = None


def ssl_context():
    """Default trust store, plus the macOS system roots (python.org builds ship with none)."""
    global _ssl_ctx
    if _ssl_ctx is not None:
        return _ssl_ctx
    ctx = ssl.create_default_context()
    if sys.platform == "darwin":
        pems = []
        for kc in ("/System/Library/Keychains/SystemRootCertificates.keychain", "/Library/Keychains/System.keychain"):
            try:
                out = subprocess.run(["security", "find-certificate", "-a", "-p", kc],
                                     capture_output=True, timeout=20).stdout.decode("ascii", "ignore")
                if "BEGIN CERTIFICATE" in out:
                    pems.append(out)
            except Exception:
                pass
        for pem in pems:
            try:
                ctx.load_verify_locations(cadata=pem)
            except Exception:
                # one bad cert in a bundle shouldn't stop the rest - load individually
                for block in re.findall(r"-----BEGIN CERTIFICATE-----.+?-----END CERTIFICATE-----", pem, re.S):
                    try:
                        ctx.load_verify_locations(cadata=block)
                    except Exception:
                        pass
    try:
        import certifi  # optional
        ctx.load_verify_locations(cafile=certifi.where())
    except Exception:
        pass
    _ssl_ctx = ctx
    return ctx


# ---------------------------------------------------------------- vault storage

def read_vault():
    if not os.path.exists(VAULT_PATH):
        return None
    with open(VAULT_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def write_vault(obj):
    for k in ("salt", "iv", "ct"):
        if not isinstance(obj.get(k), str) or not obj.get(k):
            raise UserError("That doesn't look like a Crown vault.")
    os.makedirs(BACKUP_DIR, exist_ok=True)
    with VAULT_LOCK:
        if os.path.exists(VAULT_PATH):
            backups = list_backups()
            newest = backups[0]["mtime"] if backups else 0
            if time.time() - newest >= BACKUP_EVERY_SECONDS:
                stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
                shutil.copy2(VAULT_PATH, os.path.join(BACKUP_DIR, "vault-%s.json" % stamp))
                for old in list_backups()[MAX_BACKUPS:]:
                    try:
                        os.remove(os.path.join(BACKUP_DIR, old["name"]))
                    except OSError:
                        pass
        tmp = VAULT_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(obj, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, VAULT_PATH)


def vault_saved_at(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            v = json.load(f)
        if v.get("erased") or not v.get("ct"):
            return -1
        return float(v.get("savedAt") or 0) / 1000.0 or os.path.getmtime(path)
    except Exception:
        return -1


def import_old_data():
    """First run of a new version: find data from older Crown folders (which kept it in Crown/data) and bring the newest copy here."""
    if os.environ.get("CROWN_DATA") or os.path.exists(VAULT_PATH):
        return None
    import glob
    home = os.path.expanduser("~")
    places = [os.path.join(ROOT, "data")]
    for base in [os.path.dirname(ROOT), os.path.join(home, "Downloads"), os.path.join(home, "Desktop"), os.path.join(home, "Documents"),
                 os.path.join(home, "Applications"), "/Applications", home]:
        places += glob.glob(os.path.join(base, "Crown*", "data")) + glob.glob(os.path.join(base, "*", "Crown*", "data"))
    best, best_t = None, -1
    for d in dict.fromkeys(places):
        t = vault_saved_at(os.path.join(d, "vault.json"))
        if t > best_t:
            best, best_t = d, t
    if not best or best_t < 0:
        return None
    os.makedirs(BACKUP_DIR, exist_ok=True)
    shutil.copy2(os.path.join(best, "vault.json"), VAULT_PATH)
    for b in glob.glob(os.path.join(best, "backups", "vault-*.json")):
        dest = os.path.join(BACKUP_DIR, os.path.basename(b))
        if not os.path.exists(dest):
            shutil.copy2(b, dest)
    try:
        with open(os.path.join(best, "MOVED - read me.txt"), "w") as f:
            f.write("Crown %s copied the data in this folder to:\n%s\n\nThis copy is no longer used. You can delete this old Crown folder whenever you like.\n" % (VERSION, DATA_DIR))
    except Exception:
        pass
    return best


def list_backups():
    if not os.path.isdir(BACKUP_DIR):
        return []
    out = []
    for name in os.listdir(BACKUP_DIR):
        if re.fullmatch(r"vault-\d{8}-\d{6}\.json", name):
            p = os.path.join(BACKUP_DIR, name)
            st = os.stat(p)
            out.append({"name": name, "size": st.st_size, "mtime": st.st_mtime})
    out.sort(key=lambda b: b["mtime"], reverse=True)
    return out


def read_backup(name):
    if not re.fullmatch(r"vault-\d{8}-\d{6}\.json", name or ""):
        raise UserError("Unknown backup.")
    p = os.path.join(BACKUP_DIR, name)
    if not os.path.exists(p):
        raise UserError("That backup no longer exists.")
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------- IMAP

def dh(value):
    """Decode an RFC 2047 header into plain text."""
    if value is None:
        return ""
    try:
        return str(make_header(decode_header(str(value)))).strip()
    except Exception:
        return str(value).strip()


def imap_quote(name):
    return '"' + str(name).replace("\\", "\\\\").replace('"', '\\"') + '"'


def friendly_login_error(raw, host):
    msg = raw
    low = raw.lower()
    hint = ""
    if "application-specific" in low or "app password" in low or "web login required" in low or "gmail" in host:
        hint = " Gmail needs an App Password (Google Account > Security > 2-Step Verification > App passwords), not your normal password."
    elif "mail.me.com" in host:
        hint = " iCloud needs an app-specific password from account.apple.com > Sign-In and Security > App-Specific Passwords."
    elif "yahoo" in host or "aol" in host:
        hint = " Yahoo/AOL need an app password from Account Security > Generate app password."
    elif "invalid" in low or "authenticat" in low:
        hint = " Double-check the email address and password. Most providers require an app password for IMAP."
    return "Login failed (%s).%s" % (msg, hint)


def imap_open(acc):
    host = str(acc.get("host") or "").strip()
    try:
        port = int(acc.get("port") or 993)
    except (TypeError, ValueError):
        raise UserError("The port must be a number.")
    use_ssl = acc.get("ssl", True) is not False
    user = str(acc.get("user") or "").strip()
    password = str(acc.get("pass") or "")
    if not host:
        raise UserError("Missing mail server address.")
    if not user or not password:
        raise UserError("Missing email address or app password.")
    try:
        if use_ssl:
            try:
                M = imaplib.IMAP4_SSL(host, port, ssl_context=ssl_context(), timeout=40)
            except TypeError:  # Python < 3.9 has no timeout argument
                socket.setdefaulttimeout(40)
                M = imaplib.IMAP4_SSL(host, port, ssl_context=ssl_context())
        else:
            try:
                M = imaplib.IMAP4(host, port, timeout=40)
            except TypeError:
                socket.setdefaulttimeout(40)
                M = imaplib.IMAP4(host, port)
    except socket.gaierror:
        raise UserError("Couldn't find the mail server \"%s\". Check the server address and your internet connection." % host)
    except (socket.timeout, TimeoutError):
        raise UserError("Timed out connecting to %s:%s." % (host, port))
    except ConnectionRefusedError:
        raise UserError("%s refused the connection on port %s." % (host, port))
    except ssl.SSLCertVerificationError as e:
        raise UserError("Couldn't verify %s's security certificate (%s)." % (host, e.verify_message or e))
    except ssl.SSLError as e:
        raise UserError("Secure connection to %s failed: %s" % (host, e))
    except OSError as e:
        raise UserError("Couldn't connect to %s:%s (%s)." % (host, port, e))
    try:
        M.login(user, password)
    except imaplib.IMAP4.error as e:
        try:
            M.shutdown()
        except Exception:
            pass
        raw = e.args[0].decode("utf-8", "replace") if e.args and isinstance(e.args[0], bytes) else str(e)
        raise UserError(friendly_login_error(raw, host.lower()))
    return M


def imap_close(M):
    try:
        M.logout()
    except Exception:
        try:
            M.shutdown()
        except Exception:
            pass


def imap_select(M, folder):
    folder = folder or "INBOX"
    typ, data = M.select(imap_quote(folder), readonly=True)
    if typ != "OK" and folder.upper() != "INBOX":
        # e.g. Gmail's "All Mail" has a different name in other languages - use the \All folder instead
        try:
            typ2, rows = M.list()
            for row in rows or []:
                line = row.decode("utf-8", "replace") if isinstance(row, bytes) else ""
                m = LIST_RE.match(line)
                if m and "\\all" in m.group("flags").lower():
                    name = m.group("name").strip().strip('"')
                    typ, data = M.select(imap_quote(name), readonly=True)
                    break
        except Exception:
            pass
    if typ != "OK":
        detail = data[0].decode("utf-8", "replace") if data and isinstance(data[0], bytes) else ""
        raise UserError("Couldn't open the folder \"%s\". %s" % (folder, detail))
    info = {}
    for code in ("UIDVALIDITY", "UIDNEXT"):
        try:
            _, val = M.response(code)
            if val and val[-1] is not None:
                info[code.lower()] = int(val[-1])
        except Exception:
            pass
    return info


LIST_RE = re.compile(r'^\((?P<flags>[^)]*)\)\s+(?P<delim>"(?:[^"\\]|\\.)*"|NIL)\s+(?P<name>.+)$')


def imap_folders(acc):
    M = imap_open(acc)
    try:
        typ, data = M.list()
        folders = []
        for row in data or []:
            if isinstance(row, tuple):  # literal folder names
                row = row[0] + b" " + row[1]
            if not isinstance(row, bytes):
                continue
            line = row.decode("utf-8", "replace")
            m = LIST_RE.match(line)
            if not m:
                continue
            flags = m.group("flags").lower()
            if "\\noselect" in flags or "\\nonexistent" in flags:
                continue
            name = m.group("name").strip()
            if name.startswith('"') and name.endswith('"'):
                name = name[1:-1].replace('\\"', '"').replace("\\\\", "\\")
            special = ""
            for tag in ("\\all", "\\inbox", "\\sent", "\\junk", "\\trash", "\\archive", "\\drafts"):
                if tag in flags:
                    special = tag[1:]
            folders.append({"name": name, "special": special})
        folders.sort(key=lambda f: (f["name"].upper() != "INBOX", f["special"] != "all", f["name"].lower()))
        return {"ok": True, "folders": folders}
    finally:
        imap_close(M)


UID_RE = re.compile(rb"UID\s+(\d+)", re.I)


def parse_fetch(resp):
    """imaplib FETCH response -> list of (uid, literal_bytes). Handles UID before or after the literal."""
    out = []
    items = resp or []
    i = 0
    while i < len(items):
        it = items[i]
        if isinstance(it, tuple) and len(it) >= 2:
            m = UID_RE.search(it[0])
            uid = m.group(1) if m else None
            if uid is None and i + 1 < len(items) and isinstance(items[i + 1], bytes):
                m2 = UID_RE.search(items[i + 1])
                uid = m2.group(1) if m2 else None
            if uid is not None:
                out.append((uid.decode(), it[1]))
        i += 1
    return out


def body_parts(msg):
    text, html = "", ""

    def content(part):
        try:
            return part.get_content()
        except Exception:
            payload = part.get_payload(decode=True) or b""
            cs = part.get_content_charset() or "utf-8"
            try:
                return payload.decode(cs, "replace")
            except LookupError:
                return payload.decode("utf-8", "replace")

    try:
        p = msg.get_body(preferencelist=("plain",))
        if p is not None:
            text = content(p)
    except Exception:
        pass
    try:
        p = msg.get_body(preferencelist=("html",))
        if p is not None:
            html = content(p)
    except Exception:
        pass
    if not text and not html:
        for part in msg.walk():
            ctype = part.get_content_type()
            if part.is_multipart() or part.get_filename():
                continue
            if ctype == "text/plain" and not text:
                text = content(part)
            elif ctype == "text/html" and not html:
                html = content(part)
    return (text or "")[:250000], (html or "")[:400000]


SLIM_DROP = re.compile(r"<!--.*?-->|<(style|script|head|title|svg|noscript)\b[^>]*>.*?</\1\s*>", re.S | re.I)
SLIM_TAG = re.compile(r"<(/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(/?)>", re.S)


SLIM_ATTR = re.compile(r"""\s(src|alt|width|height)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""", re.I)


def _slim_tag(m):
    tag = m.group(2).lower()
    if tag == "img" and not m.group(1):
        # keep what the reader needs to find item pictures: src, alt text and size
        keep = []
        for a in SLIM_ATTR.finditer(m.group(0)):
            v = a.group(2) if a.group(2) is not None else (a.group(3) if a.group(3) is not None else a.group(4))
            name = a.group(1).lower()
            if name == "src" and not v.lower().startswith("http"):
                return " "
            keep.append('%s="%s"' % (name, v.replace('"', "&quot;")[:600]))
        return "<img %s>" % " ".join(keep) if keep else " "
    return "<%s%s%s>" % (m.group(1), tag, m.group(3))


def slim_html(html, limit=200000):
    """Strip styling/attributes the order reader never uses - typically 5-10x smaller."""
    if not html:
        return ""
    h = SLIM_DROP.sub(" ", html)
    h = SLIM_TAG.sub(_slim_tag, h)
    h = re.sub(r"[ \t\r\f\v]+", " ", h)
    h = re.sub(r"\n\s*\n+", "\n", h)
    return h[:limit]


def addresses(msg, *headers):
    out = []
    for h in headers:
        for v in msg.get_all(h, []) or []:
            for _, addr in getaddresses([dh(v)]):
                addr = addr.strip().lower()
                if addr and "@" in addr and addr not in out:
                    out.append(addr)
    return out


def imap_since(date_str):
    try:
        d = datetime.date.fromisoformat(str(date_str)[:10])
    except ValueError:
        d = datetime.date.today() - datetime.timedelta(days=30)
    return "%02d-%s-%04d" % (d.day, MONTHS[d.month - 1], d.year)


# ---- connection pool: stay logged in between requests, up to 3 connections per inbox
POOL = {}
POOL_LOCK = threading.Lock()
POOL_MAX = 3
POOL_IDLE = 120


def pool_key(acc):
    import hashlib
    return "|".join([str(acc.get("host") or "").lower(), str(acc.get("port") or 993), str(acc.get("ssl", True) is not False),
                     str(acc.get("user") or "").lower(), hashlib.sha256(str(acc.get("pass") or "").encode()).hexdigest()])


class Pooled(object):
    """with Pooled(acc) as c: c.M is a logged-in IMAP connection reserved for this thread."""

    def __init__(self, acc):
        self.acc, self.key, self.c = acc, pool_key(acc), None

    def __enter__(self):
        deadline = time.time() + 90
        while True:
            with POOL_LOCK:
                conns = POOL.setdefault(self.key, [])
                for c in conns:
                    if not c["busy"]:
                        c["busy"] = True
                        self.c = c
                        break
                if self.c is None and len(conns) < POOL_MAX:
                    self.c = {"M": None, "busy": True, "used": time.time(), "folder": None}
                    conns.append(self.c)
            if self.c is not None:
                break
            if time.time() > deadline:
                raise UserError("The mail server is busy. Try again in a minute.")
            time.sleep(0.05)
        try:
            if self.c["M"] is not None and time.time() - self.c["used"] > 20:
                try:
                    self.c["M"].noop()
                except Exception:
                    self._drop_conn()
            if self.c["M"] is None:
                self.c["M"] = imap_open(self.acc)
                self.c["folder"] = None
        except BaseException:
            self._discard()
            raise
        return self.c

    def _drop_conn(self):
        if self.c and self.c["M"] is not None:
            imap_close(self.c["M"])
        if self.c:
            self.c["M"], self.c["folder"] = None, None

    def _discard(self):
        self._drop_conn()
        with POOL_LOCK:
            conns = POOL.get(self.key, [])
            if self.c in conns:
                conns.remove(self.c)

    def __exit__(self, et, ev, tb):
        if os.environ.get("CROWN_NO_POOL"):  # testing: behave like a fresh serverless instance every time
            self._discard()
            return False
        if et is not None and not issubclass(et, UserError):
            self._discard()  # connection may be in a bad state
        else:
            with POOL_LOCK:
                self.c["busy"] = False
                self.c["used"] = time.time()
        return False


def pool_sweeper():
    while True:
        time.sleep(30)
        stale = []
        with POOL_LOCK:
            for key, conns in list(POOL.items()):
                for c in list(conns):
                    if not c["busy"] and time.time() - c["used"] > POOL_IDLE:
                        conns.remove(c)
                        stale.append(c)
        for c in stale:
            if c["M"] is not None:
                imap_close(c["M"])


def with_retry(acc, fn):
    """Run fn(conn) on a pooled connection; if the connection dropped, retry once on a fresh one."""
    try:
        with Pooled(acc) as c:
            return fn(c)
    except UserError:
        raise
    except (imaplib.IMAP4.abort, OSError, EOFError, ssl.SSLError):
        with Pooled(acc) as c:
            return fn(c)


def ensure_folder(c, folder, force=False):
    if force or c["folder"] != folder:
        c["folder"] = None
        c["info"] = imap_select(c["M"], folder)
        c["folder"] = folder
    return c.get("info") or {}


GMAIL_WORDS = ["order", "orders", "preorder", "arrive", "arrives", "arrived", "arriving", "items", "package", "canceled", "shipped", "shipping", "delivered", "delivery", "cancel", "canceled", "cancelled",
               "cancellation", "refund", "receipt", "purchase", "pickup", "tracking", "sorry", "thanks", "thank",
               "confirmation", "confirmed", "\"on its way\"", "\"on the way\"", "\"picked up\"", "\"ready for\"",
               "\"in transit\""]


def is_gmail(acc):
    h = str(acc.get("host") or "").lower()
    return bool(acc.get("gmail")) or h.endswith("gmail.com") or h.endswith("googlemail.com")


def imap_scan(req):
    """Find order-looking emails. Returns header info only (fast); bodies are fetched separately."""
    acc = req.get("account") or {}
    folder = acc.get("folder") or "INBOX"
    keywords = [str(k).lower() for k in (req.get("keywords") or []) if str(k).strip()]
    patterns = []
    for p in req.get("patterns") or []:
        try:
            patterns.append(re.compile(p, re.I))
        except re.error:
            pass
    try:
        after_uid = int(req.get("afterUid") or 0)
    except (TypeError, ValueError):
        after_uid = 0
    want_validity = str(req.get("uidValidity") or "")

    def wanted(subject):
        s = subject.lower()
        if not keywords and not patterns:
            return True
        return any(k in s for k in keywords) or any(p.search(subject) for p in patterns)

    def run(c):
        M = c["M"]
        info = ensure_folder(c, folder, force=True)  # re-select so new mail is visible
        validity = str(info.get("uidvalidity") or "")
        mode = "since"
        uids = None
        if after_uid and validity and validity == want_validity:
            mode = "new"
            typ, data = M.uid("SEARCH", None, "UID", "%d:*" % (after_uid + 1))
            if typ != "OK":
                raise UserError("The mail server rejected the search.")
            uids = [u for u in (data[0].split() if data and data[0] else []) if int(u) > after_uid]
        elif is_gmail(acc) and req.get("gmailSearch", True):
            try:
                d = datetime.date.fromisoformat(str(req.get("since"))[:10])
            except ValueError:
                d = datetime.date.today() - datetime.timedelta(days=30)
            q = "after:%04d/%02d/%02d subject:(%s)" % (d.year, d.month, d.day, " OR ".join(GMAIL_WORDS))
            try:
                M.literal = q.encode("utf-8")
                typ, data = M.uid("SEARCH", "CHARSET", "UTF-8", "X-GM-RAW")
                if typ == "OK":
                    uids = data[0].split() if data and data[0] else []
                    mode = "gmail"
            except imaplib.IMAP4.error:
                uids = None
            finally:
                M.literal = None
        if uids is None:
            typ, data = M.uid("SEARCH", None, "SINCE", imap_since(req.get("since")))
            if typ != "OK":
                raise UserError("The mail server rejected the search.")
            uids = data[0].split() if data and data[0] else []
        uids = [u.decode() if isinstance(u, bytes) else str(u) for u in uids]
        cands = []
        for i in range(0, len(uids), 600):
            chunk = uids[i:i + 600]
            typ, resp = M.uid("FETCH", ",".join(chunk), "(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE MESSAGE-ID)])")
            if typ != "OK":
                continue
            for uid, hb in parse_fetch(resp):
                h = email.message_from_bytes(hb or b"")
                subject = dh(h.get("Subject"))
                if not wanted(subject):
                    continue
                mid = (h.get("Message-ID") or "").strip() or ("uid:%s:%s:%s" % (acc.get("user", ""), folder, uid))
                cands.append({"uid": int(uid), "mid": mid, "subject": subject, "from": dh(h.get("From"))})
        cands.sort(key=lambda x: x["uid"])
        max_uid = int(info["uidnext"]) - 1 if info.get("uidnext") else 0
        if not max_uid:
            try:
                typ, resp = M.uid("FETCH", "*", "(UID)")
                for row in resp or []:
                    m = UID_RE.search(row if isinstance(row, bytes) else (row[0] if isinstance(row, tuple) else b""))
                    if m:
                        max_uid = max(max_uid, int(m.group(1)))
            except Exception:
                pass
        if uids:
            max_uid = max(max_uid, max(int(u) for u in uids))
        return {"ok": True, "mode": mode, "uidValidity": validity, "maxUid": max(max_uid, after_uid if mode == "new" else 0),
                "scanned": len(uids), "candidates": cands}

    return with_retry(acc, run)


def imap_bodies(req):
    acc = req.get("account") or {}
    folder = acc.get("folder") or "INBOX"
    try:
        uids = [int(u) for u in (req.get("uids") or [])][:60]
        max_bytes = int(req.get("maxBytes") or 3500000)
    except (TypeError, ValueError):
        raise UserError("Bad request.")
    if not uids:
        return {"ok": True, "messages": []}

    def run(c):
        M = c["M"]
        ensure_folder(c, folder)
        typ, resp = M.uid("FETCH", ",".join(str(u) for u in uids), "(BODY.PEEK[]<0.%d>)" % MAX_MSG_BYTES)
        got = dict(parse_fetch(resp)) if typ == "OK" else {}
        out = []
        deferred = []
        size = 0
        for u in uids:
            if size > max_bytes:
                deferred.append(u)
                continue
            raw = got.get(str(u))
            if raw is None:
                out.append({"uid": u, "error": "Couldn't download this email."})
                continue
            msg = email.message_from_bytes(raw or b"", policy=policy.default)
            text, html = body_parts(msg)
            try:
                date = parsedate_to_datetime(str(msg.get("Date"))).astimezone(datetime.timezone.utc).isoformat()
            except Exception:
                date = datetime.datetime.now(datetime.timezone.utc).isoformat()
            mid = (msg.get("Message-ID") or "").strip() or ("uid:%s:%s:%s" % (acc.get("user", ""), folder, u))
            text, html = text[:120000], slim_html(html)
            size += len(text) + len(html) + 500
            out.append({"uid": u, "messageId": mid, "subject": dh(msg.get("Subject")), "from": dh(msg.get("From")),
                        "to": addresses(msg, "To", "Delivered-To", "X-Original-To", "Cc"), "date": date, "text": text, "html": html})
        return {"ok": True, "messages": out, "deferred": deferred}

    return with_retry(acc, run)


def imap_test(acc):
    M = imap_open(acc)
    try:
        imap_select(M, acc.get("folder") or "INBOX")
        return {"ok": True}
    finally:
        imap_close(M)


# ---------------------------------------------------------------- live tracking (EasyPost)

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"


def _http(url, data=None, headers=None, jar=None, timeout=20):
    """Small HTTP helper with a cookie jar (carrier sites hand out session cookies first)."""
    import http.cookiejar
    jar = jar if jar is not None else http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), urllib.request.HTTPSHandler(context=ssl_context()))
    h = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", "Accept": "*/*"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method="POST" if data is not None else "GET")
    with opener.open(req, timeout=timeout) as r:
        return r.status, r.read(), jar


def ups_track(code):
    """UPS's own tracking data (the same the ups.com tracking page shows) - no API key needed."""
    import http.cookiejar
    jar = http.cookiejar.CookieJar()
    _http("https://www.ups.com/track?loc=en_US&tracknum=%s&requester=ST/trackdetails" % urllib.parse.quote(code), jar=jar,
          headers={"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"})
    tok = next((c.value for c in jar if c.name == "X-XSRF-TOKEN-ST"), "")
    body = json.dumps({"Locale": "en_US", "TrackingNumber": [code], "Requester": "st/trackdetails"}).encode()
    st, raw, _ = _http("https://webapis.ups.com/track/api/Track/GetStatus?loc=en_US", data=body, jar=jar, headers={
        "Content-Type": "application/json", "Accept": "application/json, text/plain, */*", "X-XSRF-TOKEN": tok,
        "Origin": "https://www.ups.com", "Referer": "https://www.ups.com/track?loc=en_US&tracknum=" + code})
    j = json.loads(raw.decode("utf-8"))
    d = (j.get("trackDetails") or [{}])[0] or {}
    if d.get("errorCode") and not d.get("packageStatus"):
        raise UserError("UPS: %s" % (d.get("errorText") or "tracking number not found"))
    ymd = lambda s: ("%s-%s-%s" % (s[:4], s[4:6], s[6:8])) if s and len(s) >= 8 and s[:8].isdigit() else ""
    delivered = bool(d.get("isDelivered")) or str(d.get("packageStatusType") or "").upper() == "D"
    ddd = d.get("deliveredDateDetail") or {}
    del_date = ""
    for m in d.get("milestones") or []:
        if m.get("isCompleted") and m.get("date") and re.search(r"deliver", str(m.get("nameKey") or m.get("name") or ""), re.I) and not re.search(r"out", str(m.get("name") or ""), re.I):
            mm = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", m["date"])
            if mm:
                del_date = "%s-%02d-%02d" % (mm.group(3), int(mm.group(1)), int(mm.group(2)))
    text = str(d.get("packageStatus") or "")
    status = "delivered" if delivered else "out_for_delivery" if re.search(r"out for delivery", text, re.I) or str(d.get("progressBarType") or "") == "OutForDelivery" else \
        "in_transit" if text else "unknown"
    events = []
    for m in d.get("milestones") or []:
        if m.get("isCompleted") and m.get("date"):
            mm = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", m["date"])
            iso = "%s-%02d-%02dT12:00:00" % (mm.group(3), int(mm.group(1)), int(mm.group(2))) if mm else ""
            events.append({"date": iso, "message": m.get("name") or "", "status": "", "location": m.get("location") or ""})
    return {"ok": True, "status": status, "carrier": "UPS", "est": ymd(str(d.get("sdd") or "")), "deliveredOn": del_date if delivered else "",
            "publicUrl": "https://www.ups.com/track?loc=en_US&tracknum=" + code, "events": events, "source": "ups", "statusText": text}


# ---- official carrier APIs (free developer accounts). Tokens are cached while the server stays warm.
_TOKENS = {}
UPS_BASE = os.environ.get("CROWN_UPS_URL", "https://onlinetools.ups.com")
FEDEX_BASE = os.environ.get("CROWN_FEDEX_URL", "https://apis.fedex.com")


def _api_json(url, data=None, headers=None, form=False, timeout=25):
    body = None
    h = {"Accept": "application/json"}
    if data is not None:
        body = urllib.parse.urlencode(data).encode() if form else json.dumps(data).encode()
        h["Content-Type"] = "application/x-www-form-urlencoded" if form else "application/json"
    h.update(headers or {})
    req = urllib.request.Request(url, data=body, headers=h, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl_context()) as r:
            return json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        msg = ""
        try:
            j = json.loads(raw)
            errs = (j.get("response") or {}).get("errors") or j.get("errors") or []
            if errs and isinstance(errs, list):
                msg = errs[0].get("message") or errs[0].get("code") or ""
            msg = msg or j.get("error_description") or j.get("error") or ""
        except Exception:
            msg = raw[:120]
        raise CarrierError(e.code, str(msg)[:200])


class CarrierError(Exception):
    def __init__(self, code, msg):
        Exception.__init__(self, "%s %s" % (code, msg))
        self.code, self.msg = code, msg


def _token(kind, cid, secret):
    k = (kind, cid, hashlib.sha256((secret or "").encode()).hexdigest())
    t = _TOKENS.get(k)
    if t and t[1] > time.time() + 60:
        return t[0]
    try:
        if kind == "ups":
            j = _api_json(UPS_BASE + "/security/v1/oauth/token", {"grant_type": "client_credentials"}, form=True,
                          headers={"Authorization": "Basic " + base64.b64encode(("%s:%s" % (cid, secret)).encode()).decode(), "x-merchant-id": cid})
        else:
            j = _api_json(FEDEX_BASE + "/oauth/token", {"grant_type": "client_credentials", "client_id": cid, "client_secret": secret}, form=True)
    except CarrierError as e:
        if e.code in (400, 401, 403):
            raise UserError("%s rejected the Client ID / Secret. Check them in Settings → Carrier tracking." % ("UPS" if kind == "ups" else "FedEx"))
        raise UserError("%s sign-in failed (%s)." % ("UPS" if kind == "ups" else "FedEx", e))
    tok = j.get("access_token")
    if not tok:
        raise UserError("%s didn't return an access token." % ("UPS" if kind == "ups" else "FedEx"))
    _TOKENS[k] = (tok, time.time() + int(j.get("expires_in") or 3000))
    return tok


def _ymd(s):
    s = str(s or "")
    m = re.match(r"(\d{4})-?(\d{2})-?(\d{2})", s)
    return "%s-%s-%s" % m.groups() if m else ""


def ups_api_track(code, cid, secret):
    tok = _token("ups", cid, secret)
    try:
        j = _api_json(UPS_BASE + "/api/track/v1/details/%s?locale=en_US&returnSignature=false&returnMilestones=false&returnPOD=false" % urllib.parse.quote(code),
                      headers={"Authorization": "Bearer " + tok, "transId": "crown%d" % int(time.time() * 1000), "transactionSrc": "Crown"})
    except CarrierError as e:
        if e.code == 404:
            raise UserError("UPS doesn't know this tracking number yet.")
        raise UserError("UPS tracking error (%s)." % e)
    ship = ((j.get("trackResponse") or {}).get("shipment") or [{}])[0] or {}
    if ship.get("warnings") and not ship.get("package"):
        raise UserError("UPS: %s" % ship["warnings"][0].get("message", "no information yet"))
    pkg = (ship.get("package") or [{}])[0] or {}
    dates = {d.get("type"): _ymd(d.get("date")) for d in pkg.get("deliveryDate") or []}
    cur = pkg.get("currentStatus") or {}
    desc = str(cur.get("description") or cur.get("simplifiedTextDescription") or "")
    ctype = str(cur.get("type") or "").upper()
    delivered = ctype == "D" or bool(dates.get("DEL")) or re.search(r"\bdelivered\b", desc, re.I) is not None
    status = "delivered" if delivered else "out_for_delivery" if re.search(r"out for delivery", desc, re.I) else \
        "exception" if ctype == "X" else "pre_transit" if ctype in ("M", "P") and not pkg.get("activity", [])[1:] else "in_transit"
    events = []
    for a in (pkg.get("activity") or [])[:20]:
        d, t = str(a.get("date") or ""), str(a.get("time") or "000000")
        iso = "%s-%s-%sT%s:%s:%s" % (d[:4], d[4:6], d[6:8], t[:2], t[2:4], t[4:6]) if len(d) == 8 else ""
        ad = ((a.get("location") or {}).get("address") or {})
        events.append({"date": iso, "message": (a.get("status") or {}).get("description") or "", "status": "",
                       "location": ", ".join(x for x in [ad.get("city"), ad.get("stateProvince")] if x)})
    events.reverse()
    dt = pkg.get("deliveryTime") or {}
    return {"ok": True, "status": status, "carrier": "UPS", "est": dates.get("RDD") or dates.get("SDD") or "", "deliveredOn": dates.get("DEL") or "",
            "window": [dt.get("startTime") or "", dt.get("endTime") or ""], "statusText": desc, "events": events,
            "publicUrl": "https://www.ups.com/track?loc=en_US&tracknum=" + code, "source": "ups-api"}


def fedex_api_track(code, cid, secret):
    tok = _token("fedex", cid, secret)
    try:
        j = _api_json(FEDEX_BASE + "/track/v1/trackingnumbers", {"includeDetailedScans": True, "trackingInfo": [{"trackingNumberInfo": {"trackingNumber": code}}]},
                      headers={"Authorization": "Bearer " + tok, "X-locale": "en_US"})
    except CarrierError as e:
        raise UserError("FedEx tracking error (%s)." % e)
    res = ((((j.get("output") or {}).get("completeTrackResults") or [{}])[0] or {}).get("trackResults") or [{}])[0] or {}
    if res.get("error") and not res.get("latestStatusDetail"):
        raise UserError("FedEx: %s" % (res["error"].get("message") or "no information yet"))
    lsd = res.get("latestStatusDetail") or {}
    code2 = str(lsd.get("code") or "").upper()
    desc = str(lsd.get("statusByLocale") or lsd.get("description") or "")
    dts = {d.get("type"): d.get("dateTime") for d in res.get("dateAndTimes") or []}
    est = _ymd(dts.get("ESTIMATED_DELIVERY")) or _ymd(((res.get("estimatedDeliveryTimeWindow") or {}).get("window") or {}).get("ends")) or \
        _ymd(((res.get("standardTransitTimeWindow") or {}).get("window") or {}).get("ends"))
    delivered = code2 == "DL" or bool(dts.get("ACTUAL_DELIVERY"))
    status = "delivered" if delivered else "out_for_delivery" if code2 == "OD" else "exception" if code2 in ("DE", "SE", "CA") else \
        "pre_transit" if code2 in ("OC", "IN") else "in_transit"
    events = []
    for ev in (res.get("scanEvents") or [])[:20]:
        loc = ev.get("scanLocation") or {}
        events.append({"date": ev.get("date") or "", "message": ev.get("eventDescription") or "", "status": "",
                       "location": ", ".join(x for x in [loc.get("city"), loc.get("stateOrProvinceCode")] if x)})
    events.reverse()
    w = (res.get("estimatedDeliveryTimeWindow") or {}).get("window") or {}
    return {"ok": True, "status": status, "carrier": "FedEx", "est": "" if delivered else est, "deliveredOn": _ymd(dts.get("ACTUAL_DELIVERY")),
            "window": [w.get("begins") or "", w.get("ends") or ""], "statusText": desc, "events": events,
            "publicUrl": "https://www.fedex.com/fedextrack/?trknbr=" + code, "source": "fedex-api"}


def carrier_test(req):
    kind = str(req.get("carrier") or "").lower()
    if kind not in ("ups", "fedex"):
        raise UserError("Unknown carrier.")
    cid, sec = str(req.get("id") or "").strip(), str(req.get("secret") or "").strip()
    if not cid or not sec:
        raise UserError("Paste both the Client ID and the Client Secret.")
    _TOKENS.pop((kind, cid, hashlib.sha256(sec.encode()).hexdigest()), None)
    _token(kind, cid, sec)
    return {"ok": True}


def free_track(code, carrier):
    carrier = (carrier or "").upper()
    if carrier == "UPS" or code.upper().startswith("1Z"):
        return ups_track(code)
    raise UserError("Live tracking for %s needs an EasyPost key (Settings)." % (carrier or "this carrier"))


def track(req):
    """Live tracking. Order: the carrier's official API (free UPS / FedEx developer keys) -> EasyPost -> UPS's website."""
    key = str(req.get("apiKey") or "").strip()
    code0 = re.sub(r"\s+", "", str(req.get("tracking") or "")).upper()
    if not code0:
        raise UserError("No tracking number.")
    carrier = str(req.get("carrier") or "").upper()
    is_ups = carrier == "UPS" or code0.startswith("1Z")
    is_fedex = carrier in ("FEDEX", "FEDEXGROUND") or (not is_ups and re.fullmatch(r"\d{12}|\d{15}|\d{20}|\d{22}", code0) is not None)
    keys = req.get("carriers") or {}
    ups, fx = keys.get("ups") or {}, keys.get("fedex") or {}
    if is_ups and ups.get("id") and ups.get("secret"):
        return ups_api_track(code0, ups["id"], ups["secret"])
    if is_fedex and fx.get("id") and fx.get("secret"):
        return fedex_api_track(code0, fx["id"], fx["secret"])
    if not key:
        if is_ups:
            try:
                return ups_track(code0)
            except UserError:
                raise
            except Exception:
                raise UserError("Add your free UPS developer keys in Settings → Carrier tracking to get UPS delivery dates.")
        raise UserError("Add your free %s developer keys in Settings → Carrier tracking to get delivery dates." % ("FedEx" if is_fedex else "carrier"))
    key = str(req.get("apiKey") or "").strip()
    code = re.sub(r"\s+", "", str(req.get("tracking") or ""))
    if not key:
        raise UserError("Add your EasyPost API key in Settings first.")
    if not code:
        raise UserError("No tracking number.")
    tracker = {"tracking_code": code}
    if req.get("carrier"):
        tracker["carrier"] = str(req["carrier"])
    url = os.environ.get("CROWN_EASYPOST_URL", "https://api.easypost.com/v2/trackers")
    r = urllib.request.Request(url, data=json.dumps({"tracker": tracker}).encode(), method="POST", headers={
        "Content-Type": "application/json",
        "Authorization": "Basic " + base64.b64encode((key + ":").encode()).decode(),
    })
    try:
        with urllib.request.urlopen(r, timeout=30, context=ssl_context()) as resp:
            j = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = json.loads(e.read().decode("utf-8")).get("error", {}).get("message", "")
        except Exception:
            pass
        if e.code == 401:
            raise UserError("EasyPost rejected the API key. Check it in Settings.")
        raise UserError("EasyPost error %s%s" % (e.code, (": " + detail) if detail else ""))
    except urllib.error.URLError as e:
        raise UserError("Couldn't reach EasyPost (%s)." % e.reason)
    events = []
    for ev in (j.get("tracking_details") or [])[-20:]:
        loc = ev.get("tracking_location") or {}
        place = ", ".join([x for x in [loc.get("city"), loc.get("state")] if x])
        events.append({"date": ev.get("datetime"), "message": ev.get("message") or "", "status": ev.get("status") or "",
                       "location": place})
    return {"ok": True, "status": j.get("status") or "unknown", "carrier": j.get("carrier") or "",
            "est": j.get("est_delivery_date"), "publicUrl": j.get("public_url") or "", "events": events}


# ---------------------------------------------------------------- HTTP

TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json"}


class _LocalHandler(BaseHTTPRequestHandler):
    server_version = "Crown/" + VERSION

    def log_message(self, fmt, *args):  # keep the terminal quiet
        pass

    def _host_ok(self):
        host = (self.headers.get("Host") or "").split(":")[0].lower()
        return host in ("127.0.0.1", "localhost")

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(body)

    def _api_guard(self):
        if not self._host_ok() or self.headers.get("X-Crown") != "1":
            self._send(403, {"ok": False, "error": "Forbidden"})
            return False
        return True

    def _json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise UserError("Request too large.")
        raw = self.rfile.read(n) if n else b"{}"
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            raise UserError("Bad request.")

    def _run(self, fn):
        try:
            self._send(200, fn())
        except UserError as e:
            self._send(200, {"ok": False, "error": str(e)})
        except Exception as e:
            traceback.print_exc()
            self._send(500, {"ok": False, "error": "Unexpected error: %s" % e})

    def do_GET(self):
        path = self.path.split("?")[0]
        if path.startswith("/api/"):
            if not self._api_guard():
                return
            if path == "/api/ping":
                return self._run(lambda: {"ok": True, "version": VERSION, "dataDir": DATA_DIR})
            if path == "/api/vault":
                return self._run(lambda: {"ok": True, "vault": read_vault()})
            if path == "/api/backups":
                return self._run(lambda: {"ok": True, "backups": list_backups()})
            if path.startswith("/api/backups/"):
                name = path[len("/api/backups/"):]
                return self._run(lambda: {"ok": True, "vault": read_backup(name)})
            return self._send(404, {"ok": False, "error": "Not found"})
        if not self._host_ok():
            return self._send(403, "Forbidden", "text/plain")
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        full = os.path.realpath(os.path.join(APP_DIR, rel))
        if not full.startswith(os.path.realpath(APP_DIR) + os.sep) or not os.path.isfile(full):
            return self._send(404, "Not found", "text/plain")
        with open(full, "rb") as f:
            data = f.read()
        self._send(200, data, TYPES.get(os.path.splitext(full)[1].lower(), "application/octet-stream"))

    def do_PUT(self):
        if not self._api_guard():
            return
        if self.path == "/api/vault":
            if self.headers.get("X-Crown-App") != VERSION:
                return self._send(200, {"ok": False, "outdated": True, "error": "Crown was updated. Reload this tab to keep going."})

            def fn():
                write_vault(self._json())
                return {"ok": True, "savedAt": time.time()}
            return self._run(fn)
        self._send(404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        if not self._api_guard():
            return
        if self.path == "/api/shutdown":
            self._send(200, {"ok": True})
            threading.Thread(target=lambda: (time.sleep(0.3), os._exit(0)), daemon=True).start()
            return
        routes = {
            "/api/imap/test": lambda b: imap_test(b.get("account") or {}),
            "/api/imap/folders": lambda b: imap_folders(b.get("account") or {}),
            "/api/imap/scan": imap_scan,
            "/api/imap/bodies": imap_bodies,
            "/api/track": track,
            "/api/carriertest": carrier_test,
        }
        fn = routes.get(self.path)
        if not fn:
            return self._send(404, {"ok": False, "error": "Not found"})
        self._run(lambda: fn(self._json()))


def running_version(port):
    """Version of a Crown already running on this port ("" if it's an old one that doesn't say), or None."""
    try:
        req = urllib.request.Request("http://%s:%d/api/ping" % (HOST, port), headers={"X-Crown": "1"})
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(req, timeout=2) as r:
            j = json.loads(r.read().decode())
            return str(j.get("version") or "") if j.get("ok") else None
    except Exception:
        return None


def stop_old_crown(port):
    """Close an older Crown that's still running, so the new version can take over."""
    try:
        req = urllib.request.Request("http://%s:%d/api/shutdown" % (HOST, port), data=b"{}", method="POST",
                                     headers={"X-Crown": "1", "Content-Type": "application/json"})
        urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=2)
    except Exception:
        pass
    time.sleep(0.6)
    if running_version(port) is None:
        return True
    try:  # versions before 2.0 have no shutdown button - find the process on the port
        pids = subprocess.run(["lsof", "-ti", "tcp:%d" % port, "-sTCP:LISTEN"], capture_output=True, timeout=5).stdout.decode().split()
        for pid in pids:
            cmd = subprocess.run(["ps", "-o", "command=", "-p", pid], capture_output=True, timeout=5).stdout.decode()
            if "server.py" in cmd and int(pid) != os.getpid():
                os.kill(int(pid), 15)
    except Exception:
        pass
    for _ in range(20):
        time.sleep(0.25)
        if running_version(port) is None:
            return True
    return False


def already_running(port):
    return running_version(port) is not None


def main():
    global PORT
    os.makedirs(BACKUP_DIR, exist_ok=True)
    httpd = None
    for port in range(BASE_PORT, BASE_PORT + 12):  # an old Crown may still be running from the previous version
        v = running_version(port)
        if v is not None and v != VERSION:
            print("Closing the older Crown (%s) that's still running..." % (v or "1.x"))
            stop_old_crown(port)
    moved = import_old_data()
    if moved:
        print("  Brought your data over from %s" % moved)
    for port in range(BASE_PORT, BASE_PORT + 12):
        v = running_version(port)
        if v is not None and v != VERSION:
            print("Closing the older Crown (%s) that's still running..." % (v or "1.x"))
            stop_old_crown(port)
        if already_running(port):
            url = "http://%s:%d/" % (HOST, port)
            print("Crown is already running - opening %s" % url)
            if not os.environ.get("CROWN_NO_BROWSER"):
                webbrowser.open(url)
            return
        try:
            httpd = ThreadingHTTPServer((HOST, port), _LocalHandler)
            PORT = port
            break
        except OSError:
            continue
    if httpd is None:
        print("Couldn't find a free port between %d and %d." % (BASE_PORT, BASE_PORT + 11))
        sys.exit(1)
    httpd.daemon_threads = True
    threading.Thread(target=pool_sweeper, daemon=True).start()
    url = "http://%s:%d/" % (HOST, PORT)
    print("")
    print("  Crown %s is running at %s" % (VERSION, url))
    print("  Your data folder: %s" % DATA_DIR)
    print("  Keep this window open while you use Crown. Close it (or press Ctrl+C) to stop.")
    print("")
    if not os.environ.get("CROWN_NO_BROWSER"):
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nCrown stopped.")



# =====================================================================
# Crown Online - Vercel serverless handler (appended to server.py at build time).
# Storage: Upstash Redis (REST). Everything stored is encrypted in the browser first;
# the server only ever sees ciphertext plus a hash of a password-derived access key.
# =====================================================================
import hashlib as _hashlib
import hmac as _hmac
from urllib.parse import urlparse as _urlparse, parse_qs as _parse_qs

KV_URL = (os.environ.get("KV_REST_API_URL") or os.environ.get("UPSTASH_REDIS_REST_URL") or "").rstrip("/")
KV_TOKEN = os.environ.get("KV_REST_API_TOKEN") or os.environ.get("UPSTASH_REDIS_REST_TOKEN") or ""
SETUP_CODE = (os.environ.get("CROWN_SETUP_CODE") or "").strip()
K_META, K_VAULT, K_FAILS, K_BINDEX, K_BLAST = "crown:meta", "crown:vault", "crown:fails", "crown:backups", "crown:lastbackup"
MAX_CLOUD_BACKUPS = 20
CLOUD_BACKUP_EVERY = 15 * 60
SAVE_SCRIPT = """
local meta = redis.call('GET', KEYS[1])
local cur = 0
if meta then cur = tonumber(cjson.decode(meta)['rev']) or 0 end
if ARGV[1] ~= 'force' and tonumber(ARGV[1]) ~= cur then return {0, cur} end
redis.call('SET', KEYS[2], ARGV[2])
local m = cjson.decode(ARGV[3])
m['rev'] = cur + 1
redis.call('SET', KEYS[1], cjson.encode(m))
return {1, cur + 1}
"""


class Conflict(Exception):
    def __init__(self, rev):
        Exception.__init__(self, "conflict")
        self.rev = rev


class TooMany(Exception):
    pass


def kv(*cmd):
    if not KV_URL or not KV_TOKEN:
        raise UserError("Crown Online's storage isn't connected yet. Add the free Upstash Redis database to this project in Vercel (see the setup steps), then redeploy.")
    req = urllib.request.Request(KV_URL, data=json.dumps([str(c) if not isinstance(c, str) else c for c in cmd]).encode("utf-8"),
                                 method="POST", headers={"Authorization": "Bearer " + KV_TOKEN, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=25, context=ssl_context()) as r:
            j = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = json.loads(e.read().decode("utf-8")).get("error", "")
        except Exception:
            pass
        raise UserError("Storage error %s %s" % (e.code, detail))
    except urllib.error.URLError as e:
        raise UserError("Couldn't reach storage (%s)." % e.reason)
    if isinstance(j, dict) and j.get("error"):
        raise UserError("Storage error: %s" % j["error"])
    return j.get("result") if isinstance(j, dict) else j


def get_meta():
    raw = kv("GET", K_META)
    return json.loads(raw) if raw else None


def note_failure():
    n = kv("INCR", K_FAILS)
    if n == 1:
        kv("EXPIRE", K_FAILS, 900)
    time.sleep(0.4)
    if n and int(n) > 30:
        raise TooMany()


def check_fails():
    n = kv("GET", K_FAILS)
    if n and int(n) > 30:
        raise TooMany()


def hash_key(k):
    return _hashlib.sha256(("crown:" + str(k or "")).encode("utf-8")).hexdigest()


def require_auth(headers):
    vals = kv("MGET", K_META, K_FAILS) or [None, None]  # one storage call per request
    if vals[1] and int(vals[1]) > 30:
        raise TooMany()
    meta = json.loads(vals[0]) if vals[0] else None
    key = headers.get("X-Crown-Auth") or ""
    if not meta:
        raise UserError("Crown isn't set up yet.")
    if not key or not _hmac.compare_digest(hash_key(key), meta.get("authHash", "")):
        note_failure()
        raise PermissionError("Wrong password.")
    return meta


def check_code(code):
    check_fails()
    if not SETUP_CODE:
        raise UserError("The setup code isn't configured on the server.")
    clean = lambda x: re.sub(r"[^A-Z0-9]", "", str(x or "").upper())
    if not clean(code) or not _hmac.compare_digest(clean(code), clean(SETUP_CODE)):
        note_failure()
        raise PermissionError("That setup code isn't right.")


def valid_vault(v):
    return isinstance(v, dict) and all(isinstance(v.get(k), str) and v.get(k) for k in ("salt", "iv", "ct"))


def save_vault(vault, base_rev, auth_hash):
    if not valid_vault(vault):
        raise UserError("That doesn't look like a Crown vault.")
    blob = json.dumps(vault, separators=(",", ":"))
    meta = json.dumps({"authHash": auth_hash, "salt": vault["salt"], "savedAt": time.time(), "size": len(blob)})
    res = kv("EVAL", SAVE_SCRIPT, "2", K_META, K_VAULT, "force" if base_rev == "force" else str(int(base_rev or 0)), blob, meta)
    if not res or int(res[0]) != 1:
        raise Conflict(int(res[1]) if res else 0)
    rev = int(res[1])
    try:
        last = kv("GET", K_BLAST)
        if not last or time.time() - float(last) > CLOUD_BACKUP_EVERY:
            bid = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
            kv("SET", "crown:backup:" + bid, blob)
            kv("LPUSH", K_BINDEX, json.dumps({"id": bid, "at": time.time(), "size": len(blob)}))
            old = kv("LRANGE", K_BINDEX, str(MAX_CLOUD_BACKUPS), "-1") or []
            for o in old:
                try:
                    kv("DEL", "crown:backup:" + json.loads(o)["id"])
                except Exception:
                    pass
            kv("LTRIM", K_BINDEX, "0", str(MAX_CLOUD_BACKUPS - 1))
            kv("SET", K_BLAST, str(time.time()))
    except Exception:
        pass  # a missed backup must never fail a save
    return rev


def cloud_backups():
    rows = kv("LRANGE", K_BINDEX, "0", "-1") or []
    out = []
    for r in rows:
        try:
            b = json.loads(r)
            out.append({"name": b["id"], "mtime": b["at"], "size": b.get("size", 0)})
        except Exception:
            pass
    return out


class handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _route(self):
        u = _urlparse(self.path)
        q = _parse_qs(u.query)
        if q.get("route"):
            return "/" + q["route"][0].strip("/")
        p = u.path
        if p.startswith("/api/index"):
            p = p[len("/api/index"):]
        elif p.startswith("/api"):
            p = p[len("/api"):]
        return "/" + p.strip("/")

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise UserError("Request too large.")
        raw = self.rfile.read(n) if n else b"{}"
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            raise UserError("Bad request.")

    def _run(self, fn):
        try:
            self._send(200, fn())
        except Conflict as c:
            self._send(200, {"ok": False, "conflict": True, "rev": c.rev, "error": "Crown was changed on another device."})
        except TooMany:
            self._send(200, {"ok": False, "error": "Too many wrong tries. Wait 15 minutes and try again."})
        except PermissionError as e:
            self._send(200, {"ok": False, "auth": True, "error": str(e)})
        except UserError as e:
            self._send(200, {"ok": False, "error": str(e)})
        except Exception as e:
            traceback.print_exc()
            self._send(500, {"ok": False, "error": "Unexpected error: %s" % e})

    def _guard(self):
        if self.headers.get("X-Crown") != "1":
            self._send(403, {"ok": False, "error": "Forbidden"})
            return False
        return True

    def do_GET(self):
        r = self._route()
        if r != "/ping" and not self._guard():  # the status check is read-only and safe to leave open
            return
        h = self.headers
        if r == "/ping":
            def ping():
                exists = None
                try:
                    exists = bool(get_meta())
                except UserError:
                    pass
                return {"ok": True, "version": VERSION, "cloud": True, "storage": bool(KV_URL and KV_TOKEN), "exists": exists}
            return self._run(ping)
        if r == "/salt":
            def salt():
                m = get_meta()
                return {"ok": True, "exists": bool(m), "salt": (m or {}).get("salt", "")}
            return self._run(salt)
        if r == "/vault":
            def vault():
                meta = require_auth(h)
                raw = kv("GET", K_VAULT)
                return {"ok": True, "vault": json.loads(raw) if raw else None, "rev": int(meta.get("rev") or 0)}
            return self._run(vault)
        if r == "/rev":
            return self._run(lambda: {"ok": True, "rev": int(require_auth(h).get("rev") or 0)})
        if r == "/backups":
            return self._run(lambda: (require_auth(h), {"ok": True, "backups": cloud_backups()})[1])
        if r.startswith("/backups/"):
            name = r[len("/backups/"):]

            def one():
                require_auth(h)
                if not re.fullmatch(r"\d{8}-\d{6}", name):
                    raise UserError("Unknown backup.")
                raw = kv("GET", "crown:backup:" + name)
                if not raw:
                    raise UserError("That backup no longer exists.")
                return {"ok": True, "vault": json.loads(raw)}
            return self._run(one)
        self._send(404, {"ok": False, "error": "Not found"})

    def do_PUT(self):
        if not self._guard():
            return
        r = self._route()
        h = self.headers
        if r == "/vault" and h.get("X-Crown-App") != VERSION:
            return self._send(200, {"ok": False, "outdated": True, "error": "Crown was updated. Reload this page to keep going."})
        if r == "/vault":
            def put():
                b = self._body()
                meta = require_auth(h)
                new_key = b.get("newAuthKey")
                auth_hash = hash_key(new_key) if new_key else meta["authHash"]
                rev = save_vault(b.get("vault"), b.get("baseRev", 0), auth_hash)
                return {"ok": True, "rev": rev, "savedAt": time.time()}
            return self._run(put)
        self._send(404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        if not self._guard():
            return
        r = self._route()
        h = self.headers

        def authed(fn):
            def go():
                b = self._body()
                require_auth(h)
                return fn(b)
            return go

        if r == "/setup":
            def setup():
                b = self._body()
                check_code(b.get("code"))
                if get_meta():
                    raise UserError("Crown is already set up. Unlock it with your password, or use “Forgot password?” to start over.")
                if not b.get("authKey"):
                    raise UserError("Bad request.")
                rev = save_vault(b.get("vault"), 0, hash_key(b["authKey"]))
                kv("DEL", K_FAILS)
                return {"ok": True, "rev": rev}
            return self._run(setup)
        if r == "/reset":
            def reset():
                b = self._body()
                check_code(b.get("code"))
                for row in kv("LRANGE", K_BINDEX, "0", "-1") or []:
                    try:
                        kv("DEL", "crown:backup:" + json.loads(row)["id"])
                    except Exception:
                        pass
                kv("DEL", K_META, K_VAULT, K_BINDEX, K_BLAST, K_FAILS)
                return {"ok": True}
            return self._run(reset)
        if r == "/restore":
            def restore(b):
                if not b.get("newAuthKey"):
                    raise UserError("Bad request.")
                return {"ok": True, "rev": save_vault(b.get("vault"), "force", hash_key(b["newAuthKey"]))}
            return self._run(authed(restore))
        routes = {
            "/imap/test": lambda b: imap_test(b.get("account") or {}),
            "/imap/folders": lambda b: imap_folders(b.get("account") or {}),
            "/imap/scan": imap_scan,
            "/imap/bodies": imap_bodies,
            "/track": track,
            "/carriertest": carrier_test,
        }
        fn = routes.get(r)
        if not fn:
            return self._send(404, {"ok": False, "error": "Not found"})
        self._run(authed(fn))
