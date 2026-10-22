#!/usr/bin/env python3
"""
Crown Tools - local helper server.

Runs only on this computer (127.0.0.1). It:
  * serves the Crown Tools app in your browser
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

VERSION = "0.9.4"  # prerelease - stays 0.x until Crown Tools is finished
HOST = "127.0.0.1"
BASE_PORT = int(os.environ.get("CROWN_PORT", "8787"))
ROOT = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(ROOT, "app")


def default_data_dir():
    """A fixed home for your data, separate from the app folder, so updating Crown Tools never touches it."""
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
            raise UserError("That doesn't look like a Crown Tools vault.")
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
        for attempt in range(20):  # Windows: antivirus or a backup tool can hold the file open for a moment
            try:
                os.replace(tmp, VAULT_PATH)
                break
            except PermissionError:
                if attempt == 19:
                    raise
                time.sleep(0.1)


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
    """First run of a new version: find data from older Crown Tools folders (which kept it in Crown/data) and bring the newest copy here."""
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
            f.write("Crown Tools %s copied the data in this folder to:\n%s\n\nThis copy is no longer used. You can delete this old Crown Tools folder whenever you like.\n" % (VERSION, DATA_DIR))
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
USPS_BASE = os.environ.get("CROWN_USPS_URL", "https://apis.usps.com")
CARRIER_NAMES = {"ups": "UPS", "fedex": "FedEx", "usps": "USPS"}


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
        elif kind == "usps":
            j = _api_json(USPS_BASE + "/oauth2/v3/token", {"grant_type": "client_credentials", "client_id": cid, "client_secret": secret})
        else:
            j = _api_json(FEDEX_BASE + "/oauth/token", {"grant_type": "client_credentials", "client_id": cid, "client_secret": secret}, form=True)
    except CarrierError as e:
        if e.code in (400, 401, 403):
            raise UserError("%s rejected the Client ID / Secret. Check them in Settings → Carrier tracking." % CARRIER_NAMES.get(kind, kind))
        raise UserError("%s sign-in failed (%s)." % (CARRIER_NAMES.get(kind, kind), e))
    tok = j.get("access_token")
    if not tok:
        raise UserError("%s didn't return an access token." % CARRIER_NAMES.get(kind, kind))
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


def usps_api_track(code, cid, secret):
    tok = _token("usps", cid, secret)
    try:
        j = _api_json(USPS_BASE + "/tracking/v3/tracking/" + urllib.parse.quote(code) + "?expand=DETAIL", headers={"Authorization": "Bearer " + tok})
    except CarrierError as e:
        if e.code == 404:
            raise UserError("USPS has no information for this number yet.")
        if e.code in (401, 403):
            raise UserError("USPS refused the tracking request (%s). Make sure the Tracking API is added to your USPS app." % e.msg)
        raise UserError("USPS tracking error (%s)." % e)
    if isinstance(j, list):
        j = j[0] if j else {}
    if j.get("error") and not j.get("trackingEvents"):
        err = j["error"] if isinstance(j["error"], dict) else {"message": str(j["error"])}
        raise UserError("USPS: %s" % (err.get("message") or "no information yet"))
    cat = str(j.get("statusCategory") or "").lower()
    st = str(j.get("status") or j.get("statusSummary") or "")
    evs = j.get("trackingEvents") or []
    low = (cat + " " + st).lower()
    delivered = "delivered" in low and "not delivered" not in low and "delivery attempt" not in low
    status = "delivered" if delivered else "out_for_delivery" if "out for delivery" in low else \
        "exception" if any(w in low for w in ("alert", "exception", "return to sender", "undeliverable", "notice left")) else \
        "pre_transit" if any(w in low for w in ("pre-shipment", "label created", "shipping label", "pre shipment")) else "in_transit"
    deliv_day = ""
    if delivered:
        for ev in evs:
            if "delivered" in str(ev.get("eventType") or "").lower():
                deliv_day = _ymd(ev.get("eventTimestamp") or ev.get("GMTTimestamp"))
                break
    est = _ymd(j.get("expectedDeliveryTimeStamp") or j.get("expectedDeliveryDate") or j.get("guaranteedDeliveryTimeStamp") or j.get("predictedDeliveryDate"))
    events = []
    for ev in evs[:20]:
        events.append({"date": ev.get("eventTimestamp") or ev.get("GMTTimestamp") or "", "message": ev.get("eventType") or "", "status": "",
                       "location": ", ".join(x for x in [ev.get("eventCity"), ev.get("eventState")] if x)})
    events.reverse()
    return {"ok": True, "status": status, "carrier": "USPS", "est": "" if delivered else est, "deliveredOn": deliv_day,
            "statusText": st or cat, "events": events, "publicUrl": "https://tools.usps.com/go/TrackConfirmAction?tLabels=" + code, "source": "usps-api"}


def carrier_test(req):
    kind = str(req.get("carrier") or "").lower()
    if kind not in ("ups", "fedex", "usps"):
        raise UserError("Unknown carrier.")
    cid, sec = str(req.get("id") or "").strip(), str(req.get("secret") or "").strip()
    if not cid or not sec:
        raise UserError("Paste both the Client ID and the Client Secret.")
    _TOKENS.pop((kind, cid, hashlib.sha256(sec.encode()).hexdigest()), None)
    _token(kind, cid, sec)
    return {"ok": True}



# ---------------------------------------------------------------- Discord: reading bot checkout messages
# A Discord bot you add to your server (View Channel + Read Message History, with Message Content Intent on) lets
# Crown Tools read the checkout posts your bots send to a channel. The token comes from your encrypted data on each
# request and is never stored or logged here.
DISCORD_API = (os.environ.get("CROWN_DISCORD_API") or "https://discord.com/api/v10").rstrip("/")
BOT_TOKEN_RE = re.compile(r"^[A-Za-z0-9_\-]{18,40}\.[A-Za-z0-9_\-]{4,12}\.[A-Za-z0-9_\-]{20,80}$")
SNOWFLAKE_RE = re.compile(r"^\d{15,22}$")
DISCORD_EPOCH = 1420070400000


def _dbot_token(req):
    t = str(req.get("token") or "").strip().strip('"').strip()
    if t.lower().startswith("bot "):
        t = t[4:].strip()
    if not BOT_TOKEN_RE.match(t):
        raise UserError("That doesn't look like a Discord bot token. In the Discord Developer Portal open your app → Bot → Reset Token, then copy it.")
    return t


def _dchannel(req, key="channel"):
    c = re.sub(r"\D", "", str(req.get(key) or ""))
    if not SNOWFLAKE_RE.match(c):
        raise UserError("A channel ID is a long number. In Discord turn on Developer Mode (Settings → Advanced), then right-click the channel → Copy Channel ID.")
    return c


def _dget(path, token):
    for attempt in range(4):
        r = urllib.request.Request(DISCORD_API + path, headers={"Authorization": "Bot " + token, "User-Agent": "DiscordBot (https://crowntools.vercel.app, %s)" % VERSION})
        try:
            with urllib.request.urlopen(r, timeout=20, context=ssl_context()) as resp:
                return json.loads(resp.read().decode() or "null")
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 3:
                try:
                    wait = float(json.loads(e.read().decode() or "{}").get("retry_after") or 1)
                except Exception:
                    wait = 1.0
                time.sleep(min(5.0, max(0.2, wait)))
                continue
            if e.code == 401:
                raise UserError("Discord didn't accept that bot token. Copy it again from the Developer Portal (your app → Bot → Reset Token).")
            if e.code == 403:
                raise UserError("The bot can't read that channel. In Discord, give the bot View Channel and Read Message History there.")
            if e.code == 404:
                raise UserError("Discord couldn't find that channel. Check the channel ID, and that the bot is in that server.")
            raise UserError("Discord error %s." % e.code)
        except urllib.error.URLError as e:
            raise UserError("Couldn't reach Discord (%s)." % e.reason)
    raise UserError("Discord is busy right now — try again in a minute.")


def _slim_message(m):
    if not isinstance(m, dict):
        return None
    snap = None
    for sn in (m.get("message_snapshots") or [])[:1]:  # Discord "Forward" wraps the original message
        if isinstance(sn, dict) and isinstance(sn.get("message"), dict):
            snap = sn["message"]
    src = snap or m
    embeds = []
    for e in (src.get("embeds") or [])[:10]:
        if not isinstance(e, dict):
            continue
        embeds.append({
            "title": _clip(e.get("title"), 300), "description": _clip(e.get("description"), 4000), "url": _clip(e.get("url"), 500),
            "author": _clip((e.get("author") or {}).get("name") if isinstance(e.get("author"), dict) else "", 200),
            "footer": _clip((e.get("footer") or {}).get("text") if isinstance(e.get("footer"), dict) else "", 300),
            "thumb": _clip((e.get("thumbnail") or {}).get("url") if isinstance(e.get("thumbnail"), dict) else "", 800),
            "fields": [{"name": _clip(f.get("name"), 256), "value": _clip(f.get("value"), 1024)} for f in (e.get("fields") or [])[:30] if isinstance(f, dict)],
        })
    return {"id": str(m.get("id") or ""), "channel": str(m.get("channel_id") or ""), "at": _clip(m.get("timestamp"), 40),
            "author": _clip((m.get("author") or {}).get("username") if isinstance(m.get("author"), dict) else "", 100),
            "webhook": bool(m.get("webhook_id")), "content": _clip(src.get("content"), 2000), "embeds": embeds}


def discord_check(req):
    token = _dbot_token(req)
    me = _dget("/users/@me", token) or {}
    out = {"ok": True, "bot": me.get("username") or "your bot"}
    if req.get("channel"):
        ch = _dchannel(req)
        info = _dget("/channels/%s" % ch, token) or {}
        last = _dget("/channels/%s/messages?limit=10" % ch, token) or []
        out.update({"channel": ch, "name": _clip(info.get("name"), 100), "guild": str(info.get("guild_id") or ""), "count": len(last)})
        # Without Message Content Intent, Discord hands bots empty posts
        blank = [x for x in last if isinstance(x, dict) and x.get("webhook_id") and not x.get("embeds") and not x.get("content")]
        out["contentBlocked"] = bool(last) and len(blank) == len([x for x in last if isinstance(x, dict) and x.get("webhook_id")]) and len(blank) > 0
    return out


def discord_read(req):
    """New messages in one channel, oldest first. With 'after' (the last message seen) it reads forward from there;
    the first time it reads back to 'since' (an ISO date). Returns 'last' to pass as 'after' next time and 'more' when
    there's still more to read."""
    token = _dbot_token(req)
    ch = _dchannel(req)
    after = re.sub(r"\D", "", str(req.get("after") or ""))
    max_pages = max(1, min(20, int(req.get("maxPages") or 10)))
    msgs, pages, more = [], 0, False
    if SNOWFLAKE_RE.match(after):
        cur = after
        while True:
            if pages >= max_pages:
                more = True
                break
            batch = _dget("/channels/%s/messages?limit=100&after=%s" % (ch, cur), token) or []
            pages += 1
            if not batch:
                break
            msgs.extend(batch)
            cur = max(batch, key=lambda x: int(x["id"]))["id"]
            if len(batch) < 100:
                break
    else:
        try:
            since_ms = int(datetime.datetime.fromisoformat(str(req.get("since") or "")[:10]).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)
        except Exception:
            since_ms = int(time.time() * 1000) - 30 * 86400000
        floor = max(0, since_ms - DISCORD_EPOCH) << 22
        before = None
        while pages < max_pages:
            batch = _dget("/channels/%s/messages?limit=100%s" % (ch, "&before=" + before if before else ""), token) or []
            pages += 1
            if not batch:
                break
            msgs.extend(batch)
            oldest = min(batch, key=lambda x: int(x["id"]))
            before = oldest["id"]
            if len(batch) < 100 or int(oldest["id"]) < floor:
                break
        msgs = [m for m in msgs if int(m["id"]) >= floor]
    msgs.sort(key=lambda m: int(m["id"]))
    slim = [x for x in (_slim_message(m) for m in msgs) if x and x["id"]]
    return {"ok": True, "messages": slim, "last": slim[-1]["id"] if slim else after, "more": more}


# ---------------------------------------------------------------- Discord alerts
DISCORD_RE = re.compile(r"^https://(?:(?:ptb|canary)\.)?discord(?:app)?\.com/api/webhooks/\d{5,30}/[A-Za-z0-9_\-]{20,120}$")


def _clip(v, n):
    return str(v or "")[:n]


def _clean_embed(e):
    if not isinstance(e, dict):
        return None
    out = {"title": _clip(e.get("title"), 250), "description": _clip(e.get("description"), 3500)}
    if isinstance(e.get("color"), int):
        out["color"] = e["color"] & 0xFFFFFF
    if e.get("url") and str(e["url"]).startswith("https://"):
        out["url"] = _clip(e["url"], 500)
    th = (e.get("thumbnail") or {}).get("url") if isinstance(e.get("thumbnail"), dict) else None
    if th and str(th).startswith("https://"):
        out["thumbnail"] = {"url": _clip(th, 800)}
    if e.get("timestamp"):
        out["timestamp"] = _clip(e["timestamp"], 40)
    fields = []
    for f in (e.get("fields") or [])[:12]:
        if isinstance(f, dict) and f.get("name") and f.get("value"):
            fields.append({"name": _clip(f["name"], 250), "value": _clip(f["value"], 1000), "inline": bool(f.get("inline"))})
    if fields:
        out["fields"] = fields
    if e.get("footer"):
        out["footer"] = {"text": _clip((e["footer"] or {}).get("text") if isinstance(e["footer"], dict) else e["footer"], 200)}
    return out


def discord_send(req):
    url = str(req.get("url") or "").strip()
    if not DISCORD_RE.match(url):
        raise UserError("That isn't a Discord webhook link. In Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.")
    p = req.get("payload") or {}
    body = {"username": _clip(p.get("username") or "Crown Tools", 80), "allowed_mentions": {"parse": []}}
    if p.get("content"):
        body["content"] = _clip(p["content"], 1900)
    embeds = [x for x in (_clean_embed(e) for e in (p.get("embeds") or [])[:10]) if x]
    if embeds:
        body["embeds"] = embeds
    if not embeds and not body.get("content"):
        raise UserError("Nothing to send.")
    dbg = os.environ.get("CROWN_DISCORD_DEBUG")
    if dbg:
        with open(dbg, "a") as f:
            f.write(json.dumps({"url": url, "body": body}) + "\n")
        return {"ok": True}
    data = json.dumps(body).encode()
    for attempt in range(3):
        r = urllib.request.Request(url + "?wait=true", data=data, method="POST", headers={"Content-Type": "application/json", "User-Agent": "CrownTools (crowntools.vercel.app, %s)" % VERSION})
        try:
            with urllib.request.urlopen(r, timeout=20, context=ssl_context()) as resp:
                resp.read()
            return {"ok": True}
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 2:
                try:
                    wait = float(json.loads(e.read().decode() or "{}").get("retry_after") or 1)
                except Exception:
                    wait = 1.0
                time.sleep(min(5.0, wait))
                continue
            if e.code in (401, 403, 404):
                raise UserError("Discord says this webhook doesn't exist anymore. Make a new one and paste it in again.")
            raise UserError("Discord error %s." % e.code)
        except urllib.error.URLError as e:
            raise UserError("Couldn't reach Discord (%s)." % e.reason)
    raise UserError("Discord is rate-limiting this webhook — try again in a minute.")


# ---------------------------------------------------------------- barcode (UPC) lookup
UPC_URL = os.environ.get("CROWN_UPC_URL", "https://api.upcitemdb.com/prod/trial/lookup")


def upc_lookup(req):
    code = re.sub(r"\D", "", str(req.get("code") or ""))
    if not 8 <= len(code) <= 14:
        raise UserError("That doesn't look like a product barcode.")
    r = urllib.request.Request(UPC_URL + "?upc=" + code, headers={"Accept": "application/json", "User-Agent": "CrownTools/%s" % VERSION})
    try:
        with urllib.request.urlopen(r, timeout=15, context=ssl_context()) as resp:
            j = json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        if e.code == 429:
            raise UserError("The free barcode lookup has hit its daily limit — type the product name instead.")
        if e.code in (400, 404):
            return {"ok": True, "found": False, "code": code}
        raise UserError("Barcode lookup error %s." % e.code)
    except urllib.error.URLError as e:
        raise UserError("Couldn't reach the barcode lookup (%s)." % e.reason)
    items = j.get("items") or []
    if not items:
        return {"ok": True, "found": False, "code": code}
    it = items[0]
    imgs = [u for u in (it.get("images") or []) if str(u).startswith("https://")]
    prices = [o.get("price") for o in (it.get("offers") or []) if isinstance(o.get("price"), (int, float)) and o.get("price") > 0]
    return {"ok": True, "found": True, "code": code, "name": _clip(it.get("title"), 200), "brand": _clip(it.get("brand"), 80),
            "image": imgs[0] if imgs else "", "msrp": it.get("highest_recorded_price") or (max(prices) if prices else None),
            "category": _clip(it.get("category"), 120)}


# ---------------------------------------------------------------- market prices (TCGplayer data via tcgcsv.com)
TCG_BASE = os.environ.get("CROWN_TCGCSV_URL", "https://tcgcsv.com/tcgplayer")
_MCACHE = {}


def _mget(path, ttl, fresh=False):
    hit = _MCACHE.get(path)
    if hit and hit[0] > time.time() and not fresh:
        return hit[1]
    r = urllib.request.Request(TCG_BASE + path, headers={"Accept": "application/json", "User-Agent": "CrownTools/%s (+https://crowntools.vercel.app)" % VERSION})
    try:
        with urllib.request.urlopen(r, timeout=25, context=ssl_context()) as resp:
            j = json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        if hit:
            return hit[1]
        raise UserError("TCGplayer price data error %s." % e.code)
    except (urllib.error.URLError, socket.timeout) as e:
        if hit:
            return hit[1]
        raise UserError("Couldn't reach TCGplayer price data (%s)." % getattr(e, "reason", e))
    res = j.get("results") if isinstance(j, dict) else j
    res = res if isinstance(res, list) else []
    if len(_MCACHE) > 400:
        _MCACHE.clear()
    _MCACHE[path] = (time.time() + ttl, res)
    return res


def _cat(v):
    c = re.sub(r"\D", "", str(v or ""))
    if not c:
        raise UserError("Pick a game.")
    return c


def market_categories(req=None):
    rows = _mget("/categories", 86400)
    return {"ok": True, "categories": [{"id": c.get("categoryId"), "name": c.get("displayName") or c.get("name") or ""} for c in rows if c.get("categoryId")]}


def _groups(cat):
    rows = _mget("/%s/groups" % cat, 6 * 3600)
    out = [{"id": g.get("groupId"), "name": g.get("name") or "", "abbr": g.get("abbreviation") or "", "date": str(g.get("publishedOn") or "")[:10]} for g in rows if g.get("groupId")]
    out.sort(key=lambda g: g["date"], reverse=True)
    return out


def market_groups(req):
    return {"ok": True, "groups": _groups(_cat(req.get("cat")))}


def _is_sealed(p):
    ext = {str(x.get("name") or "").lower() for x in (p.get("extendedData") or []) if isinstance(x, dict)}
    return not ({"number", "rarity"} & ext)


def _products(cat, group):
    rows = _mget("/%s/%s/products" % (cat, group), 6 * 3600)
    return [{"id": p.get("productId"), "name": p.get("name") or p.get("cleanName") or "", "clean": (p.get("cleanName") or p.get("name") or "").lower(),
             "image": p.get("imageUrl") or "", "url": p.get("url") or "", "group": int(group), "cat": int(cat), "sealed": _is_sealed(p)} for p in rows if p.get("productId")]


def _prices(cat, group, ttl=3600):
    rows = _mget("/%s/%s/prices" % (cat, group), max(ttl, 600), fresh=ttl == 0)
    out = {}
    for x in rows:
        pid = x.get("productId")
        if not pid:
            continue
        out.setdefault(pid, {})[x.get("subTypeName") or "Normal"] = {"market": x.get("marketPrice"), "low": x.get("lowPrice"), "mid": x.get("midPrice"), "high": x.get("highPrice")}
    return out


# what people type -> how TCGplayer names it
MARKET_ALIASES = {"etb": "elite trainer box", "pcetb": "elite trainer box", "bb": "booster box", "upc": "ultra premium collection",
                  "spc": "super premium collection", "bndl": "booster bundle", "blister": "blister", "tin": "tin", "151": "151"}


def market_search(req):
    cat = _cat(req.get("cat"))
    q = re.sub(r"\s+", " ", str(req.get("q") or "").lower()).strip()
    toks = [t for t in re.split(r"[^a-z0-9]+", q) if t]
    sealed_only = req.get("sealed", True) is not False
    group = re.sub(r"\D", "", str(req.get("group") or ""))
    groups = _groups(cat)
    if group:
        cand = [g for g in groups if str(g["id"]) == group] or [{"id": int(group), "name": "", "date": ""}]
    else:
        if not toks:
            raise UserError("Type what you're looking for.")
        named = [g for g in groups if any(t in g["name"].lower() for t in toks if len(t) >= 3)][:12]
        cand = named + [g for g in groups[:24] if g not in named]
    import concurrent.futures as _cf
    found = []
    with _cf.ThreadPoolExecutor(max_workers=12) as ex:
        futs = {ex.submit(_products, cat, g["id"]): g for g in cand}
        for f in _cf.as_completed(futs):
            g = futs[f]
            try:
                prods = f.result()
            except UserError:
                continue
            for p in prods:
                if sealed_only and not p["sealed"]:
                    continue
                hay = re.sub(r"[^a-z0-9]+", " ", p["clean"] + " " + g["name"].lower())
                if toks and not all(t in hay or (t in MARKET_ALIASES and MARKET_ALIASES[t] in hay) for t in toks):
                    continue
                found.append(dict(p, setName=g["name"], setDate=g.get("date") or ""))
    # best match first: no "case"/"display"/"bundle of" unless asked for, then the shortest (closest) name, then newest set
    extra = re.compile(r"\b(case|display|bundle of|lot|sleeved|blister|\d+\s*pack|set of|half)\b")
    def rank(p):
        n = p["name"].lower()
        pen = sum(1 for m in extra.findall(n) if m not in q)
        return (pen, len(n), "".join(chr(255 - ord(c)) for c in p["setDate"]))
    found.sort(key=rank)
    found = found[:40]
    gids = sorted({p["group"] for p in found})
    prices = {}
    with _cf.ThreadPoolExecutor(max_workers=8) as ex:
        for gid, pr in zip(gids, ex.map(lambda gid: _safe_prices(cat, gid), gids)):
            prices.update(pr)
    for p in found:
        p.pop("clean", None)
        p["prices"] = prices.get(p["id"], {})
    return {"ok": True, "results": found, "searched": len(cand)}


def _safe_prices(cat, gid, ttl=3600):
    try:
        return _prices(cat, gid, ttl)
    except UserError:
        return {}


def market_prices(req):
    want = req.get("items") or []
    by = {}
    for it in want[:400]:
        try:
            by.setdefault((_cat(it.get("cat")), int(it.get("group"))), set()).add(int(it.get("id")))
        except (TypeError, ValueError, UserError):
            continue
    out, errors = {}, 0
    import concurrent.futures as _cf
    keys = list(by.keys())[:80]
    ttl = 0 if req.get("fresh") else 3600
    with _cf.ThreadPoolExecutor(max_workers=10) as ex:
        res = list(ex.map(lambda k: _safe_prices(k[0], k[1], ttl), keys))
    for k, pr in zip(keys, res):
        if not pr:
            errors += 1
        for pid in by[k]:
            if pid in pr:
                out[str(pid)] = pr[pid]
    return {"ok": True, "prices": out, "failedSets": errors, "at": time.time()}


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
    ups, fx, us = keys.get("ups") or {}, keys.get("fedex") or {}, keys.get("usps") or {}
    is_usps = carrier == "USPS" or (not is_ups and re.fullmatch(r"(92|93|94|95)\d{18,24}|[A-Z]{2}\d{9}US", code0) is not None)
    if is_usps and us.get("id") and us.get("secret"):
        return usps_api_track(code0, us["id"], us["secret"])
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
        raise UserError("Add your free %s developer keys in Settings → Carrier tracking to get delivery dates." % ("FedEx" if is_fedex else "USPS" if is_usps else "carrier"))
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
                return self._send(200, {"ok": False, "outdated": True, "error": "Crown Tools was updated. Reload this tab to keep going."})

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
            "/api/discord": discord_send,
            "/api/discord/check": discord_check,
            "/api/discord/read": discord_read,
            "/api/upc": upc_lookup,
            "/api/market/categories": market_categories,
            "/api/market/groups": market_groups,
            "/api/market/search": market_search,
            "/api/market/prices": market_prices,
        }
        fn = routes.get(self.path)
        if not fn:
            return self._send(404, {"ok": False, "error": "Not found"})
        self._run(lambda: fn(self._json()))


def running_version(port):
    """Version of a Crown Tools already running on this port ("" if it's an old one that doesn't say), or None."""
    try:
        req = urllib.request.Request("http://%s:%d/api/ping" % (HOST, port), headers={"X-Crown": "1"})
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(req, timeout=2) as r:
            j = json.loads(r.read().decode())
            return str(j.get("version") or "") if j.get("ok") else None
    except Exception:
        return None


def stop_old_crown(port):
    """Close an older Crown Tools that's still running, so the new version can take over."""
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
    if os.name == "nt":
        # Windows consoles default to an old code page; never crash printing an accented name or an emoji
        for stream in (sys.stdout, sys.stderr):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
        # on Windows "reuse address" lets two programs share one port; we want the second to move to the next port
        ThreadingHTTPServer.allow_reuse_address = False
        try:
            os.system("title Crown Tools")
        except Exception:
            pass
    os.makedirs(BACKUP_DIR, exist_ok=True)
    httpd = None
    for port in range(BASE_PORT, BASE_PORT + 12):  # an old Crown Tools may still be running from the previous version
        v = running_version(port)
        if v is not None and v != VERSION:
            print("Closing the older Crown Tools (%s) that's still running..." % (v or "1.x"))
            stop_old_crown(port)
    moved = import_old_data()
    if moved:
        print("  Brought your data over from %s" % moved)
    for port in range(BASE_PORT, BASE_PORT + 12):
        v = running_version(port)
        if v is not None and v != VERSION:
            print("Closing the older Crown Tools (%s) that's still running..." % (v or "1.x"))
            stop_old_crown(port)
        if already_running(port):
            url = "http://%s:%d/" % (HOST, port)
            print("Crown Tools is already running - opening %s" % url)
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
    print("  Crown Tools %s is running at %s" % (VERSION, url))
    print("  Your data folder: %s" % DATA_DIR)
    print("  Keep this window open while you use Crown Tools. Close it (or press Ctrl+C) to stop.")
    print("")
    if not os.environ.get("CROWN_NO_BROWSER"):
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nCrown Tools stopped.")



# =====================================================================
# Crown Tools Online - Vercel serverless handler (appended to server.py at build time).
# Multi-user: every customer has an account and their own encrypted vault. Data is encrypted in the
# browser with the customer's password; the server only stores ciphertext plus a hash of a
# password-derived access key, so neither the server nor the admin can read anyone's profiles or orders.
# Storage: Upstash Redis (REST). Payments: Stripe (test or live keys from the environment).
# =====================================================================
import base64 as _b64
import hashlib as _hashlib
import hmac as _hmac
import secrets as _secrets
import smtplib as _smtplib
import struct as _struct
from email.mime.text import MIMEText as _MIMEText
from email.mime.multipart import MIMEMultipart as _MIMEMultipart
from urllib.parse import urlparse as _urlparse, parse_qs as _parse_qs, urlencode as _urlencode

KV_URL = (os.environ.get("KV_REST_API_URL") or os.environ.get("UPSTASH_REDIS_REST_URL") or "").rstrip("/")
KV_TOKEN = os.environ.get("KV_REST_API_TOKEN") or os.environ.get("UPSTASH_REDIS_REST_TOKEN") or ""
SETUP_CODE = (os.environ.get("CROWN_SETUP_CODE") or "").strip()
SECRET = os.environ.get("CROWN_SECRET") or _hashlib.sha256(("crown-secret:" + KV_TOKEN).encode()).hexdigest()
STRIPE_KEY = os.environ.get("STRIPE_SECRET_KEY") or ""
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET") or ""
STRIPE_API = (os.environ.get("STRIPE_API_BASE") or "https://api.stripe.com").rstrip("/")
SMTP_HOST = os.environ.get("CROWN_SMTP_HOST") or ("smtp.gmail.com" if os.environ.get("CROWN_SMTP_USER") else "")
SMTP_PORT = int(os.environ.get("CROWN_SMTP_PORT") or 465)
SMTP_USER = os.environ.get("CROWN_SMTP_USER") or ""
SMTP_PASS = os.environ.get("CROWN_SMTP_PASS") or ""
MAIL_FROM = os.environ.get("CROWN_MAIL_FROM") or SMTP_USER
MAIL_DEBUG = os.environ.get("CROWN_MAIL_DEBUG") or ""  # tests: write emails to this file instead of sending
APP_URL = (os.environ.get("CROWN_APP_URL") or "").rstrip("/")
ADMIN_ORIGINS = [o.strip().rstrip("/") for o in (os.environ.get("CROWN_ADMIN_ORIGIN") or "").split(",") if o.strip()]

MAX_CLOUD_BACKUPS = 20
CLOUD_BACKUP_EVERY = 15 * 60
DAY = 86400
DEFAULT_SETTINGS = {"priceCents": 1500, "currency": "usd", "trialDays": 0, "graceDays": 3, "signupsOpen": True,
                    "requireVerify": True, "announcement": "", "productName": "Crown Tools"}
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
# the single-user version's keys: kept so the owner can bring that data into their account once
L_META, L_VAULT, L_BINDEX = "crown:meta", "crown:vault", "crown:backups"


class Conflict(Exception):
    def __init__(self, rev):
        Exception.__init__(self, "conflict")
        self.rev = rev


class TooMany(Exception):
    pass


class NoAccess(Exception):
    def __init__(self, status):
        Exception.__init__(self, "no access")
        self.status = status


def kv(*cmd):
    if not KV_URL or not KV_TOKEN:
        raise UserError("Crown Tools Online's storage isn't connected yet.")
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


def kv_json(key):
    raw = kv("GET", key)
    try:
        return json.loads(raw) if raw else None
    except ValueError:
        return None


def kv_set_json(key, obj, ttl=None):
    if ttl:
        return kv("SET", key, json.dumps(obj, separators=(",", ":")), "EX", str(int(ttl)))
    return kv("SET", key, json.dumps(obj, separators=(",", ":")))


# ---------------------------------------------------------------- helpers

def sha(s):
    return _hashlib.sha256(str(s).encode("utf-8")).hexdigest()


def hash_key(k):
    return sha("crown:" + str(k or ""))


def norm_email(e):
    e = str(e or "").strip().lower()
    if not re.fullmatch(r"[^@\s]{1,64}@[^@\s]{1,190}\.[a-z0-9-]{2,24}", e):
        return ""
    return e


def now():
    return time.time()


def settings():
    s = dict(DEFAULT_SETTINGS)
    s.update(kv_json("ct:settings") or {})
    return s


def mail_ready():
    return bool(MAIL_DEBUG or (SMTP_HOST and SMTP_USER and SMTP_PASS))


def billing_ready():
    return bool(STRIPE_KEY)


def rate_limit(kind, key, limit, window):
    k = "ct:rl:%s:%s" % (kind, sha(key)[:24])
    n = kv("INCR", k)
    if n == 1:
        kv("EXPIRE", k, str(window))
    if n and int(n) > limit:
        raise TooMany()


def clear_limit(kind, key):
    kv("DEL", "ct:rl:%s:%s" % (kind, sha(key)[:24]))


def fake_salt(email):
    return _b64.b64encode(_hmac.new(SECRET.encode(), ("salt:" + email).encode(), _hashlib.sha256).digest()[:16]).decode()


def valid_vault(v):
    return isinstance(v, dict) and all(isinstance(v.get(k), str) and v.get(k) for k in ("salt", "iv", "ct"))


def audit(actor, action, target="", detail=""):
    try:
        kv("LPUSH", "ct:audit", json.dumps({"at": now(), "actor": actor, "action": action, "target": target, "detail": detail}))
        kv("LTRIM", "ct:audit", "0", "1999")
    except Exception:
        pass


def check_mail_host(host):
    """Email sync may only connect to real mail servers on the internet, never to addresses inside the hosting network."""
    import ipaddress
    host = str(host or "").strip()
    if not host or os.environ.get("CROWN_ALLOW_PRIVATE_IMAP"):
        return
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception:
        raise UserError("Couldn't find the mail server %s." % host)
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise UserError("That mail server address isn't allowed.")


# ---------------------------------------------------------------- users

def user_by_email(email):
    uid = kv("GET", "ct:email:" + email) if email else None
    return kv_json("ct:user:" + uid) if uid else None


def get_user(uid):
    return kv_json("ct:user:" + str(uid)) if uid else None


def put_user(u):
    kv_set_json("ct:user:" + u["id"], u)


def access_of(u, s=None, t=None):
    """Can this account use Crown Tools right now? Returns (allowed, reason)."""
    s = s or settings()
    t = t or now()
    if u.get("suspended"):
        return False, "suspended"
    comp = u.get("comp") or {}
    if comp.get("until") == "forever" or (isinstance(comp.get("until"), (int, float)) and comp["until"] > t):
        return True, "free"
    if s.get("requireVerify") and mail_ready() and not u.get("verified"):
        return False, "verify"
    sub = u.get("sub") or {}
    st = sub.get("status")
    if st == "trialing":
        return True, "trial"
    if st == "active":
        return True, "active"
    if st in ("past_due", "unpaid") and t < float(sub.get("periodEnd") or 0) + float(s.get("graceDays") or 0) * DAY:
        return True, "grace"
    if st in ("canceled", "incomplete_expired"):
        return False, "canceled"
    if comp.get("until") and comp.get("until") != "forever":
        return False, "expired"
    return False, "unpaid"


def public_account(u, s=None):
    s = s or settings()
    ok, reason = access_of(u, s)
    sub = u.get("sub") or {}
    comp = u.get("comp") or {}
    return {"email": u["email"], "id": u["id"], "verified": bool(u.get("verified")), "access": ok, "reason": reason,
            "createdAt": u.get("createdAt"),
            "sub": {"status": sub.get("status") or "", "periodEnd": sub.get("periodEnd") or 0, "cancelAtPeriodEnd": bool(sub.get("cancelAtPeriodEnd")),
                    "hasCustomer": bool(u.get("customerId"))},
            "comp": {"until": comp.get("until") or None, "note": comp.get("note") or ""},
            "price": {"cents": int(s["priceCents"]), "currency": s["currency"], "trialDays": int(s.get("trialDays") or 0)},
            "graceDays": int(s.get("graceDays") or 0), "trialUsed": bool(u.get("trialUsed")),
            "billingReady": billing_ready(), "mailReady": mail_ready(), "announcement": s.get("announcement") or ""}


def client_ip(headers):
    return (headers.get("X-Forwarded-For") or headers.get("X-Real-Ip") or "").split(",")[0].strip() or "?"


def require_user(headers, need_access=True):
    email = norm_email(headers.get("X-Crown-Email"))
    key = headers.get("X-Crown-Auth") or ""
    ip = client_ip(headers)
    if not email or not key:
        raise PermissionError("Sign in first.")
    for kind, k, lim in (("lfe", email, 12), ("lfi", ip, 60)):  # wrong-password counters
        n = kv("GET", "ct:rl:%s:%s" % (kind, sha(k)[:24]))
        if n and int(n) > lim:
            raise TooMany()
    u = user_by_email(email)
    if not u or not _hmac.compare_digest(hash_key(key), u.get("authHash", "")):
        rate_limit("lfe", email, 1000, 900)
        rate_limit("lfi", ip, 1000, 900)
        time.sleep(0.3)
        raise PermissionError("Wrong email or password.")
    if need_access:
        ok, reason = access_of(u)
        if not ok:
            raise NoAccess(reason)
    return u


# ---------------------------------------------------------------- vaults (one per user)

def vkeys(uid):
    return "ct:vmeta:" + uid, "ct:vault:" + uid


def save_vault(uid, vault, base_rev):
    if not valid_vault(vault):
        raise UserError("That doesn't look like a Crown Tools vault.")
    blob = json.dumps(vault, separators=(",", ":"))
    if len(blob) > 20 * 1024 * 1024:
        raise UserError("Your data is too large to save online.")
    km, kvault = vkeys(uid)
    meta = json.dumps({"savedAt": now(), "size": len(blob)})
    res = kv("EVAL", SAVE_SCRIPT, "2", km, kvault, "force" if base_rev == "force" else str(int(base_rev or 0)), blob, meta)
    if not res or int(res[0]) != 1:
        raise Conflict(int(res[1]) if res else 0)
    rev = int(res[1])
    try:
        last = kv("GET", "ct:bkl:" + uid)
        if not last or now() - float(last) > CLOUD_BACKUP_EVERY:
            bid = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
            kv("SET", "ct:bk:%s:%s" % (uid, bid), blob)
            kv("LPUSH", "ct:bki:" + uid, json.dumps({"id": bid, "at": now(), "size": len(blob)}))
            for o in kv("LRANGE", "ct:bki:" + uid, str(MAX_CLOUD_BACKUPS), "-1") or []:
                try:
                    kv("DEL", "ct:bk:%s:%s" % (uid, json.loads(o)["id"]))
                except Exception:
                    pass
            kv("LTRIM", "ct:bki:" + uid, "0", str(MAX_CLOUD_BACKUPS - 1))
            kv("SET", "ct:bkl:" + uid, str(now()))
    except Exception:
        pass  # a missed backup must never fail a save
    return rev


def vault_rev(uid):
    m = kv_json(vkeys(uid)[0]) or {}
    return int(m.get("rev") or 0)


def user_backups(uid):
    out = []
    for r in kv("LRANGE", "ct:bki:" + uid, "0", "-1") or []:
        try:
            b = json.loads(r)
            out.append({"name": b["id"], "mtime": b["at"], "size": b.get("size", 0)})
        except Exception:
            pass
    return out


def delete_user_data(u):
    uid = u["id"]
    keys = ["ct:user:" + uid, "ct:email:" + u["email"], "ct:vault:" + uid, "ct:vmeta:" + uid, "ct:bki:" + uid, "ct:bkl:" + uid]
    for r in kv("LRANGE", "ct:bki:" + uid, "0", "-1") or []:
        try:
            keys.append("ct:bk:%s:%s" % (uid, json.loads(r)["id"]))
        except Exception:
            pass
    if u.get("customerId"):
        keys.append("ct:cust:" + u["customerId"])
    kv("DEL", *keys)
    kv("ZREM", "ct:users", uid)


# ---------------------------------------------------------------- email

def app_url(headers=None):
    if APP_URL:
        return APP_URL
    host = (headers.get("X-Forwarded-Host") or headers.get("Host") or "") if headers else ""
    return ("https://" + host) if host else "https://crowntools.vercel.app"


def send_mail(to, subject, text, html=None):
    if MAIL_DEBUG:
        with open(MAIL_DEBUG, "a", encoding="utf-8") as f:
            f.write(json.dumps({"to": to, "subject": subject, "text": text}) + "\n")
        return True
    if not mail_ready():
        return False
    msg = _MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = "%s <%s>" % (settings().get("productName") or "Crown Tools", MAIL_FROM)
    msg["To"] = to
    msg.attach(_MIMEText(text, "plain", "utf-8"))
    if html:
        msg.attach(_MIMEText(html, "html", "utf-8"))
    with _smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ssl_context(), timeout=20) as s:
        s.login(SMTP_USER, SMTP_PASS)
        s.sendmail(MAIL_FROM, [to], msg.as_string())
    return True


def mail_html(title, body, button=None, url=None):
    btn = ('<p style="margin:24px 0"><a href="%s" style="background:#7c8cff;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">%s</a></p>' % (url, button)) if button else ""
    return ('<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:520px;margin:auto;padding:24px;color:#111">'
            '<h2 style="margin:0 0 12px">%s</h2><p style="line-height:1.5">%s</p>%s'
            '<p style="color:#888;font-size:12px">If you didn\'t ask for this, you can ignore this email.</p></div>') % (title, body, btn)


def make_token(kind, uid, ttl):
    tok = _secrets.token_urlsafe(32)
    kv("SET", "ct:tok:%s:%s" % (kind, sha(tok)), uid, "EX", str(ttl))
    return tok


def use_token(kind, tok, consume=True):
    if not tok or len(str(tok)) > 200:
        return None
    k = "ct:tok:%s:%s" % (kind, sha(tok))
    uid = kv("GET", k)
    if uid and consume:
        kv("DEL", k)
    return uid


def send_verify(u, headers):
    tok = make_token("verify", u["id"], 3 * DAY)
    url = "%s/?verify=%s" % (app_url(headers), tok)
    return send_mail(u["email"], "Confirm your Crown Tools email",
                     "Confirm your email for Crown Tools by opening this link:\n\n%s\n\nThe link works for 3 days." % url,
                     mail_html("Confirm your email", "Tap the button to confirm the email address for your Crown Tools account.", "Confirm email", url))


# ---------------------------------------------------------------- Stripe (standard library only)

def _flat(params, prefix=""):
    out = []
    if isinstance(params, dict):
        for k, v in params.items():
            out += _flat(v, "%s[%s]" % (prefix, k) if prefix else k)
    elif isinstance(params, list):
        for i, v in enumerate(params):
            out += _flat(v, "%s[%d]" % (prefix, i))
    elif params is not None:
        out.append((prefix, "true" if params is True else "false" if params is False else str(params)))
    return out


def stripe(method, path, params=None):
    if not STRIPE_KEY:
        raise UserError("Payments aren't set up yet.")
    data = _urlencode(_flat(params or {})).encode() if params and method != "GET" else None
    url = STRIPE_API + path + (("?" + _urlencode(_flat(params))) if params and method == "GET" else "")
    req = urllib.request.Request(url, data=data, method=method, headers={"Authorization": "Bearer " + STRIPE_KEY, "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=25, context=ssl_context()) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode("utf-8")).get("error", {}).get("message", "")
        except Exception:
            msg = ""
        raise UserError("Payment service error: %s" % (msg or e.code))


def ensure_price(s):
    """The Stripe price that matches the current monthly price (Stripe prices can't be edited, so a new one is made when it changes)."""
    if s.get("stripePriceId") and int(s.get("stripePriceCents") or -1) == int(s["priceCents"]) and s.get("stripeCurrency") == s["currency"] and s.get("stripeMode") == STRIPE_KEY[:8]:
        return s["stripePriceId"]
    prod = s.get("stripeProductId") if s.get("stripeMode") == STRIPE_KEY[:8] else None
    if not prod:
        prod = stripe("POST", "/v1/products", {"name": s.get("productName") or "Crown Tools", "metadata": {"app": "crowntools"}})["id"]
    price = stripe("POST", "/v1/prices", {"product": prod, "unit_amount": int(s["priceCents"]), "currency": s["currency"], "recurring": {"interval": "month"}, "metadata": {"app": "crowntools"}})
    cur = kv_json("ct:settings") or {}
    cur.update({"stripeProductId": prod, "stripePriceId": price["id"], "stripePriceCents": int(s["priceCents"]), "stripeCurrency": s["currency"], "stripeMode": STRIPE_KEY[:8]})
    kv_set_json("ct:settings", cur)
    return price["id"]


def ensure_customer(u):
    if u.get("customerId") and u.get("customerMode") == STRIPE_KEY[:8]:
        return u["customerId"]
    c = stripe("POST", "/v1/customers", {"email": u["email"], "metadata": {"uid": u["id"]}})
    u["customerId"] = c["id"]
    u["customerMode"] = STRIPE_KEY[:8]
    put_user(u)
    kv("SET", "ct:cust:" + c["id"], u["id"])
    return c["id"]


def apply_subscription(u, sub):
    item = ((sub.get("items") or {}).get("data") or [{}])[0]
    period_end = sub.get("current_period_end") or item.get("current_period_end") or 0
    u["sub"] = {"id": sub.get("id"), "status": sub.get("status"), "periodEnd": period_end, "cancelAtPeriodEnd": bool(sub.get("cancel_at_period_end")),
                "priceId": (item.get("price") or {}).get("id", ""), "updatedAt": now()}
    if sub.get("status") == "trialing":
        u["trialUsed"] = True
    put_user(u)


def sync_from_stripe(u):
    """Pull this customer's newest subscription straight from Stripe (used right after checkout, in case the webhook is slow)."""
    if not u.get("customerId") or not STRIPE_KEY:
        return u
    subs = stripe("GET", "/v1/subscriptions", {"customer": u["customerId"], "status": "all", "limit": 5}).get("data") or []
    if subs:
        subs.sort(key=lambda x: (x.get("status") in ("active", "trialing", "past_due"), x.get("created") or 0), reverse=True)
        apply_subscription(u, subs[0])
    return u


def verify_stripe_signature(raw, header):
    if not STRIPE_WEBHOOK_SECRET:
        raise PermissionError("Webhook secret isn't set.")
    parts = dict(p.split("=", 1) for p in str(header or "").split(",") if "=" in p)
    t = parts.get("t", "")
    sigs = [p.split("=", 1)[1] for p in str(header or "").split(",") if p.startswith("v1=")]
    if not t or not sigs or abs(now() - int(t)) > 300:
        raise PermissionError("Bad signature.")
    expect = _hmac.new(STRIPE_WEBHOOK_SECRET.encode(), (t + ".").encode() + raw, _hashlib.sha256).hexdigest()
    if not any(_hmac.compare_digest(expect, s) for s in sigs):
        raise PermissionError("Bad signature.")


def handle_webhook(raw, headers):
    verify_stripe_signature(raw, headers.get("Stripe-Signature"))
    ev = json.loads(raw.decode("utf-8"))
    if kv("SET", "ct:evt:" + str(ev.get("id")), "1", "NX", "EX", str(7 * DAY)) is None:
        return {"ok": True, "duplicate": True}
    obj = (ev.get("data") or {}).get("object") or {}
    typ = ev.get("type", "")
    uid = None
    if typ.startswith("customer.subscription."):
        uid = (obj.get("metadata") or {}).get("uid") or kv("GET", "ct:cust:" + str(obj.get("customer")))
        u = get_user(uid)
        if u:
            apply_subscription(u, obj)
    elif typ == "checkout.session.completed":
        uid = obj.get("client_reference_id") or kv("GET", "ct:cust:" + str(obj.get("customer")))
        u = get_user(uid)
        if u:
            if obj.get("customer") and not u.get("customerId"):
                u["customerId"] = obj["customer"]
                put_user(u)
                kv("SET", "ct:cust:" + obj["customer"], u["id"])
            sync_from_stripe(u)
    elif typ in ("invoice.payment_failed", "invoice.paid", "invoice.payment_succeeded"):
        uid = kv("GET", "ct:cust:" + str(obj.get("customer")))
        u = get_user(uid)
        if u:
            sync_from_stripe(u)
    return {"ok": True}


# ---------------------------------------------------------------- admin

def b32secret():
    return _b64.b32encode(_secrets.token_bytes(20)).decode().rstrip("=")


def totp_ok(secret, code, last_step=None):
    try:
        key = _b64.b32decode(secret + "=" * (-len(secret) % 8))
    except Exception:
        return None
    code = re.sub(r"\D", "", str(code or ""))
    if len(code) != 6:
        return None
    step = int(now() // 30)
    for s in (step - 1, step, step + 1):
        if last_step and s <= last_step:
            continue
        h = _hmac.new(key, _struct.pack(">Q", s), _hashlib.sha1).digest()
        o = h[-1] & 15
        v = (_struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % 1000000
        if _hmac.compare_digest("%06d" % v, code):
            return s
    return None


def pw_hash(pw, salt=None):
    salt = salt or _secrets.token_hex(16)
    return salt, _hashlib.pbkdf2_hmac("sha256", str(pw).encode(), salt.encode(), 310000).hex()


def require_admin(headers):
    auth = headers.get("Authorization") or ""
    tok = auth[7:] if auth.startswith("Bearer ") else ""
    sess = kv_json("ct:asess:" + sha(tok)) if tok else None
    if not sess:
        raise PermissionError("Please sign in to the admin site.")
    return sess


def admin_user_row(u, s, t):
    ok, reason = access_of(u, s, t)
    sub = u.get("sub") or {}
    comp = u.get("comp") or {}
    return {"id": u["id"], "email": u["email"], "createdAt": u.get("createdAt"), "lastSeen": u.get("lastSeen"), "verified": bool(u.get("verified")),
            "access": ok, "reason": reason, "subStatus": sub.get("status") or "", "periodEnd": sub.get("periodEnd") or 0, "cancelAtPeriodEnd": bool(sub.get("cancelAtPeriodEnd")),
            "compUntil": comp.get("until"), "compNote": comp.get("note") or "", "suspended": bool(u.get("suspended")), "note": u.get("adminNote") or "",
            "customerId": u.get("customerId") or "", "vaultSize": u.get("vaultSize") or 0}


def all_users():
    ids = kv("ZREVRANGE", "ct:users", "0", "-1") or []
    out = []
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        for raw in kv("MGET", *["ct:user:" + x for x in chunk]) or []:
            try:
                if raw:
                    out.append(json.loads(raw))
            except ValueError:
                pass
    return out


def admin_stats():
    s = settings()
    t = now()
    users = all_users()
    rows = [admin_user_row(u, s, t) for u in users]
    paying = [r for r in rows if r["reason"] in ("active", "grace") and r["subStatus"] in ("active", "past_due", "unpaid")]
    return {"total": len(rows), "access": sum(1 for r in rows if r["access"]), "paying": len(paying),
            "trial": sum(1 for r in rows if r["reason"] == "trial"), "free": sum(1 for r in rows if r["reason"] == "free"),
            "unpaid": sum(1 for r in rows if r["reason"] in ("unpaid", "expired", "verify")), "canceled": sum(1 for r in rows if r["reason"] == "canceled"),
            "pastDue": sum(1 for r in rows if r["subStatus"] in ("past_due", "unpaid")), "suspended": sum(1 for r in rows if r["suspended"]),
            "new7": sum(1 for r in rows if (r["createdAt"] or 0) > t - 7 * DAY), "new30": sum(1 for r in rows if (r["createdAt"] or 0) > t - 30 * DAY),
            "mrrCents": len(paying) * int(s["priceCents"]), "currency": s["currency"],
            "billingReady": billing_ready(), "webhookReady": bool(STRIPE_WEBHOOK_SECRET), "mailReady": mail_ready(),
            "stripeMode": "live" if STRIPE_KEY.startswith("sk_live") or STRIPE_KEY.startswith("rk_live") else ("test" if STRIPE_KEY else "off"),
            "legacyData": bool(kv("GET", L_META))}


# ---------------------------------------------------------------- HTTP handler

class handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _cors(self):
        origin = (self.headers.get("Origin") or "").rstrip("/")
        if origin and origin in ADMIN_ORIGINS and self._route().startswith("/admin"):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Crown")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Max-Age", "600")

    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self._cors()
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

    def _query(self):
        q = _parse_qs(_urlparse(self.path).query)
        return {k: v[0] for k, v in q.items() if k != "route"}

    def _raw(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise UserError("Request too large.")
        return self.rfile.read(n) if n else b""

    def _body(self):
        raw = self._raw() or b"{}"
        try:
            b = json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            raise UserError("Bad request.")
        if not isinstance(b, dict):
            raise UserError("Bad request.")
        return b

    def _run(self, fn):
        try:
            self._send(200, fn())
        except Conflict as c:
            self._send(200, {"ok": False, "conflict": True, "rev": c.rev, "error": "Crown Tools was changed on another device."})
        except TooMany:
            self._send(200, {"ok": False, "error": "Too many tries. Wait 15 minutes and try again."})
        except NoAccess as e:
            self._send(200, {"ok": False, "noAccess": True, "reason": e.status, "error": "Your Crown Tools subscription isn't active."})
        except PermissionError as e:
            self._send(200, {"ok": False, "auth": True, "error": str(e)})
        except UserError as e:
            self._send(200, {"ok": False, "error": str(e)})
        except Exception as e:
            traceback.print_exc()
            self._send(500, {"ok": False, "error": "Unexpected error. Please try again."})

    def _guard(self):
        if self.headers.get("X-Crown") != "1":
            self._send(403, {"ok": False, "error": "Forbidden"})
            return False
        return True

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    # ------------------------------------------------------------ GET
    def do_GET(self):
        r = self._route()
        h = self.headers
        if r == "/ping":
            def ping():
                s = settings()
                return {"ok": True, "version": VERSION, "cloud": True, "accounts": True, "storage": bool(KV_URL and KV_TOKEN),
                        "price": {"cents": int(s["priceCents"]), "currency": s["currency"], "trialDays": int(s.get("trialDays") or 0)},
                        "signupsOpen": bool(s.get("signupsOpen")), "announcement": s.get("announcement") or "", "billingReady": billing_ready()}
            return self._run(ping)
        if r == "/market/status":  # public health check of the outside data sources (rate-limited)
            def mstatus():
                rate_limit("mstat", client_ip(h), 20, 3600)
                out = {"ok": True}
                try:
                    out["tcgplayer"] = len(market_categories()["categories"])
                except UserError as e:
                    out["tcgplayer"] = str(e)
                q = self._query()
                if q.get("upc"):
                    try:
                        out["upc"] = upc_lookup({"code": q.get("upc")})
                    except UserError as e:
                        out["upc"] = str(e)
                if q.get("search"):
                    try:
                        res = market_search({"cat": q.get("cat") or "3", "q": q.get("search")})
                        out["search"] = [[x["name"], x["setName"], (x["prices"].get("Normal") or next(iter(x["prices"].values()), {})).get("market")] for x in res["results"][:5]]
                    except UserError as e:
                        out["search"] = str(e)
                return out
            return self._run(mstatus)
        if not self._guard():
            return
        if r.startswith("/admin"):
            return self._admin_get(r)
        if r == "/account":
            return self._run(lambda: {"ok": True, "account": public_account(require_user(h, need_access=False))})
        if r == "/vault":
            def vault():
                u = require_user(h)
                raw = kv("GET", "ct:vault:" + u["id"])
                u["lastSeen"] = now()
                put_user(u)
                return {"ok": True, "vault": json.loads(raw) if raw else None, "rev": vault_rev(u["id"]), "account": public_account(u)}
            return self._run(vault)
        if r == "/export":  # the encrypted data as a backup file - allowed even without a subscription
            def export():
                u = require_user(h, need_access=False)
                raw = kv("GET", "ct:vault:" + u["id"])
                return {"ok": True, "vault": json.loads(raw) if raw else None}
            return self._run(export)
        if r == "/rev":
            return self._run(lambda: {"ok": True, "rev": vault_rev(require_user(h)["id"])})
        if r == "/backups":
            return self._run(lambda: {"ok": True, "backups": user_backups(require_user(h)["id"])})
        if r.startswith("/backups/"):
            name = r[len("/backups/"):]

            def one():
                u = require_user(h)
                if not re.fullmatch(r"\d{8}-\d{6}", name):
                    raise UserError("Unknown backup.")
                raw = kv("GET", "ct:bk:%s:%s" % (u["id"], name))
                if not raw:
                    raise UserError("That backup no longer exists.")
                return {"ok": True, "vault": json.loads(raw)}
            return self._run(one)
        self._send(404, {"ok": False, "error": "Not found"})

    # ------------------------------------------------------------ PUT
    def do_PUT(self):
        if not self._guard():
            return
        r = self._route()
        h = self.headers
        if r == "/vault" and h.get("X-Crown-App") != VERSION:
            return self._send(200, {"ok": False, "outdated": True, "error": "Crown Tools was updated. Reload this page to keep going."})
        if r == "/vault":
            def put():
                b = self._body()
                u = require_user(h)
                rev = save_vault(u["id"], b.get("vault"), b.get("baseRev", 0))
                changed = False
                if b.get("newAuthKey"):  # password changed: the new key and salt take over
                    u["authHash"] = hash_key(b["newAuthKey"])
                    u["salt"] = b["vault"]["salt"]
                    changed = True
                size = len(json.dumps(b.get("vault")))
                if abs(size - int(u.get("vaultSize") or 0)) > 2048 or changed:
                    u["vaultSize"] = size
                    changed = True
                if changed:
                    put_user(u)
                return {"ok": True, "rev": rev, "savedAt": now()}
            return self._run(put)
        self._send(404, {"ok": False, "error": "Not found"})

    # ------------------------------------------------------------ POST
    def do_POST(self):
        r = self._route()
        h = self.headers
        if r == "/billing/webhook":  # Stripe calls this; it's checked by signature instead of headers
            raw = self._raw()
            return self._run(lambda: handle_webhook(raw, h))
        if not self._guard():
            return
        if r.startswith("/admin"):
            return self._admin_post(r)
        ip = client_ip(h)

        if r == "/auth/salt":
            def salt():
                b = self._body()
                email = norm_email(b.get("email"))
                if not email:
                    raise UserError("Enter a valid email address.")
                rate_limit("salt", ip, 120, 900)
                u = user_by_email(email)
                return {"ok": True, "salt": (u or {}).get("salt") or fake_salt(email)}
            return self._run(salt)

        if r == "/auth/signup":
            def signup():
                b = self._body()
                s = settings()
                email = norm_email(b.get("email"))
                if not email:
                    raise UserError("Enter a valid email address.")
                if not b.get("agree"):
                    raise UserError("Please confirm you understand the monthly price and agree to the Terms.")
                claim = bool(b.get("claimCode"))
                if not s.get("signupsOpen") and not claim:
                    raise UserError("Sign-ups are closed right now.")
                rate_limit("signup", ip, 8, 3600)
                if not b.get("authKey") or not valid_vault(b.get("vault")) or not isinstance(b.get("salt"), str):
                    raise UserError("Bad request.")
                if user_by_email(email):
                    raise UserError("There's already an account with that email. Sign in instead.")
                uid = _secrets.token_hex(12)
                u = {"id": uid, "email": email, "createdAt": now(), "verified": False, "salt": b["salt"], "authHash": hash_key(b["authKey"]),
                     "agreedAt": now(), "agreedPrice": int(s["priceCents"]), "ip": ip[:64]}
                if claim:  # the owner bringing the single-user version's data into their new account
                    if not SETUP_CODE:
                        raise UserError("The setup code isn't configured on the server.")
                    rate_limit("claim", ip, 10, 900)
                    clean = lambda x: re.sub(r"[^A-Z0-9]", "", str(x or "").upper())
                    if not _hmac.compare_digest(clean(b["claimCode"]), clean(SETUP_CODE)):
                        raise PermissionError("That setup code isn't right.")
                    lm = kv_json(L_META)
                    if not lm:
                        raise UserError("There's no earlier data to bring over.")
                    if not _hmac.compare_digest(hash_key(b["authKey"]), lm.get("authHash", "")):
                        raise PermissionError("That isn't the password your earlier Crown Tools data used.")
                    u["salt"] = lm.get("salt") or b["salt"]
                    u["verified"] = True
                    u["comp"] = {"until": "forever", "note": "Owner", "by": "setup code", "at": now()}
                if kv("SET", "ct:email:" + email, uid, "NX") is None:
                    raise UserError("There's already an account with that email. Sign in instead.")
                put_user(u)
                kv("ZADD", "ct:users", str(now()), uid)
                if claim:
                    raw = kv("GET", L_VAULT)
                    save_vault(uid, json.loads(raw), "force")
                    for row in kv("LRANGE", L_BINDEX, "0", "-1") or []:
                        try:
                            bk = json.loads(row)
                            data = kv("GET", "crown:backup:" + bk["id"])
                            if data:
                                kv("SET", "ct:bk:%s:%s" % (uid, bk["id"]), data)
                                kv("RPUSH", "ct:bki:" + uid, row)
                        except Exception:
                            pass
                    kv("RENAME", L_META, "crown:meta:claimed")
                    audit(email, "claimed earlier data", uid)
                else:
                    save_vault(uid, b["vault"], 0)
                sent = False
                if not u["verified"] and mail_ready():
                    try:
                        sent = send_verify(u, h)
                    except Exception:
                        traceback.print_exc()
                audit(email, "signed up", uid)
                return {"ok": True, "account": public_account(u, s), "verifySent": sent}
            return self._run(signup)

        if r == "/auth/legacy":  # salt of the earlier single-user data, so the owner's password can be checked
            def legacy():
                b = self._body()
                rate_limit("claim", ip, 10, 900)
                clean = lambda x: re.sub(r"[^A-Z0-9]", "", str(x or "").upper())
                if not SETUP_CODE or not _hmac.compare_digest(clean(b.get("code")), clean(SETUP_CODE)):
                    raise PermissionError("That setup code isn't right.")
                lm = kv_json(L_META)
                if not lm:
                    raise UserError("There's no earlier data to bring over.")
                return {"ok": True, "salt": lm.get("salt")}
            return self._run(legacy)

        if r == "/auth/verify":
            def verify():
                b = self._body()
                rate_limit("verify", ip, 30, 900)
                uid = use_token("verify", b.get("token"))
                u = get_user(uid)
                if not u:
                    raise UserError("That link has expired or was already used. Sign in and ask for a new one.")
                u["verified"] = True
                put_user(u)
                audit(u["email"], "verified email", u["id"])
                return {"ok": True, "email": u["email"]}
            return self._run(verify)

        if r == "/auth/resend":
            def resend():
                u = require_user(h, need_access=False)
                rate_limit("resend", u["id"], 4, 3600)
                if u.get("verified"):
                    return {"ok": True, "already": True}
                if not mail_ready():
                    raise UserError("Email isn't set up on the server yet.")
                send_verify(u, h)
                return {"ok": True}
            return self._run(resend)

        if r == "/auth/forgot":
            def forgot():
                b = self._body()
                email = norm_email(b.get("email"))
                rate_limit("forgot", ip, 6, 3600)
                if email:
                    rate_limit("forgote", email, 3, 3600)
                u = user_by_email(email)
                if u and mail_ready():
                    tok = make_token("reset", u["id"], 3600)
                    url = "%s/?reset=%s" % (app_url(h), tok)
                    send_mail(email, "Reset your Crown Tools password",
                              "Open this link to choose a new password:\n\n%s\n\nImportant: your saved data is locked with your old password, so a reset starts you with empty data. If you remember your old password later, you can restore a backup.\n\nThe link works for 1 hour." % url,
                              mail_html("Reset your password", "Choose a new password for Crown Tools. Your saved data is locked with your old password, so a reset starts you with empty data (backups made with the old password can still be restored if you remember it).", "Choose a new password", url))
                return {"ok": True, "mailReady": mail_ready()}  # same answer whether or not the email exists
            return self._run(forgot)

        if r == "/auth/reset":
            def reset():
                b = self._body()
                rate_limit("reset", ip, 10, 900)
                if not b.get("authKey") or not valid_vault(b.get("vault")):
                    raise UserError("Bad request.")
                uid = use_token("reset", b.get("token"))
                u = get_user(uid)
                if not u:
                    raise UserError("That reset link has expired or was already used.")
                u["authHash"] = hash_key(b["authKey"])
                u["salt"] = b["vault"]["salt"]
                u["verified"] = True
                put_user(u)
                save_vault(uid, b["vault"], "force")
                audit(u["email"], "reset password", uid)
                return {"ok": True, "email": u["email"]}
            return self._run(reset)

        if r == "/account/delete":
            def delete():
                u = require_user(h, need_access=False)
                sub = u.get("sub") or {}
                if sub.get("id") and sub.get("status") not in ("canceled", "incomplete_expired") and STRIPE_KEY:
                    try:
                        stripe("DELETE", "/v1/subscriptions/" + sub["id"])
                    except Exception:
                        traceback.print_exc()
                delete_user_data(u)
                audit(u["email"], "deleted account", u["id"])
                return {"ok": True}
            return self._run(delete)

        if r == "/billing/checkout":
            def checkout():
                u = require_user(h, need_access=False)
                s = settings()
                if u.get("suspended"):
                    raise UserError("This account is suspended.")
                if s.get("requireVerify") and mail_ready() and not u.get("verified"):
                    raise UserError("Confirm your email first. Check your inbox for the link.")
                rate_limit("checkout", u["id"], 20, 3600)
                price = ensure_price(s)
                cust = ensure_customer(u)
                base = app_url(h)
                params = {"mode": "subscription", "customer": cust, "client_reference_id": u["id"],
                          "line_items": [{"price": price, "quantity": 1}], "allow_promotion_codes": True,
                          "success_url": base + "/?billing=success", "cancel_url": base + "/?billing=cancel",
                          "subscription_data": {"metadata": {"uid": u["id"]}}}
                if int(s.get("trialDays") or 0) > 0 and not u.get("trialUsed"):
                    params["subscription_data"]["trial_period_days"] = int(s["trialDays"])
                sess = stripe("POST", "/v1/checkout/sessions", params)
                return {"ok": True, "url": sess["url"]}
            return self._run(checkout)

        if r == "/billing/portal":
            def portal():
                u = require_user(h, need_access=False)
                if not u.get("customerId"):
                    raise UserError("There's no billing account yet. Subscribe first.")
                p = stripe("POST", "/v1/billing_portal/sessions", {"customer": u["customerId"], "return_url": app_url(h) + "/#settings"})
                return {"ok": True, "url": p["url"]}
            return self._run(portal)

        if r == "/billing/sync":
            def bsync():
                u = require_user(h, need_access=False)
                rate_limit("bsync", u["id"], 60, 3600)
                return {"ok": True, "account": public_account(sync_from_stripe(u))}
            return self._run(bsync)

        if r == "/restore":
            def restore():
                b = self._body()
                u = require_user(h)
                if not b.get("newAuthKey") or not valid_vault(b.get("vault")):
                    raise UserError("Bad request.")
                rev = save_vault(u["id"], b["vault"], "force")
                u["authHash"] = hash_key(b["newAuthKey"])
                u["salt"] = b["vault"]["salt"]
                put_user(u)
                return {"ok": True, "rev": rev}
            return self._run(restore)

        routes = {
            "/imap/test": lambda b: imap_test(b.get("account") or {}),
            "/imap/folders": lambda b: imap_folders(b.get("account") or {}),
            "/imap/scan": imap_scan,
            "/imap/bodies": imap_bodies,
            "/track": track,
            "/carriertest": carrier_test,
            "/discord": discord_send,
            "/discord/check": discord_check,
            "/discord/read": discord_read,
            "/upc": upc_lookup,
            "/market/categories": market_categories,
            "/market/groups": market_groups,
            "/market/search": market_search,
            "/market/prices": market_prices,
        }
        fn = routes.get(r)
        if not fn:
            return self._send(404, {"ok": False, "error": "Not found"})

        def go():
            b = self._body()
            u = require_user(h)
            limits = {"/discord": (300, 3600), "/discord/check": (60, 3600), "/discord/read": (400, 3600), "/upc": (60, 3600), "/market/search": (150, 3600), "/market/prices": (60, 3600)}
            if r in limits:
                rate_limit("u" + r.replace("/", ""), u["id"], *limits[r])
            if r.startswith("/imap/"):
                check_mail_host((b.get("account") or {}).get("host"))
            return fn(b)
        self._run(go)

    # ------------------------------------------------------------ admin API
    def _admin_get(self, r):
        h = self.headers
        q = self._query()
        if r == "/admin/status":
            return self._run(lambda: {"ok": True, "setup": bool(kv("GET", "ct:admin")), "version": VERSION})
        if r == "/admin/stats":
            return self._run(lambda: (require_admin(h), {"ok": True, "stats": admin_stats(), "settings": {k: v for k, v in settings().items() if not k.startswith("stripe")}})[1])
        if r == "/admin/users":
            def users():
                require_admin(h)
                s = settings()
                t = now()
                rows = [admin_user_row(u, s, t) for u in all_users()]
                term = (q.get("q") or "").strip().lower()
                if term:
                    rows = [x for x in rows if term in x["email"] or term in x["id"] or term in (x["note"] or "").lower() or term in (x["compNote"] or "").lower()]
                f = q.get("filter") or "all"
                pick = {"access": lambda x: x["access"], "paying": lambda x: x["reason"] in ("active", "grace") and x["subStatus"] in ("active", "past_due", "unpaid"),
                        "free": lambda x: x["reason"] == "free", "trial": lambda x: x["reason"] == "trial", "waiting": lambda x: not x["access"] and not x["suspended"],
                        "pastdue": lambda x: x["subStatus"] in ("past_due", "unpaid"), "suspended": lambda x: x["suspended"], "unverified": lambda x: not x["verified"]}
                if f in pick:
                    rows = [x for x in rows if pick[f](x)]
                return {"ok": True, "users": rows[:1000], "total": len(rows)}
            return self._run(users)
        if r.startswith("/admin/user/"):
            uid = r[len("/admin/user/"):]

            def one():
                require_admin(h)
                u = get_user(uid)
                if not u:
                    raise UserError("No such account.")
                row = admin_user_row(u, settings(), now())
                row["backups"] = len(kv("LRANGE", "ct:bki:" + uid, "0", "-1") or [])
                row["agreedAt"] = u.get("agreedAt")
                row["agreedPrice"] = u.get("agreedPrice")
                row["history"] = [json.loads(x) for x in (kv("LRANGE", "ct:audit", "0", "1999") or []) if ('"' + uid + '"') in x][:50]
                return {"ok": True, "user": row}
            return self._run(one)
        if r == "/admin/audit":
            return self._run(lambda: (require_admin(h), {"ok": True, "log": [json.loads(x) for x in (kv("LRANGE", "ct:audit", "0", "299") or [])]})[1])
        if r == "/admin/coupons":
            def coupons():
                require_admin(h)
                if not STRIPE_KEY:
                    return {"ok": True, "coupons": [], "billingReady": False}
                pcs = stripe("GET", "/v1/promotion_codes", {"limit": 50}).get("data") or []
                return {"ok": True, "billingReady": True, "coupons": [{"id": p["id"], "code": p["code"], "active": p.get("active"), "times": p.get("times_redeemed", 0),
                                                                       "percentOff": (p.get("coupon") or {}).get("percent_off"), "amountOff": (p.get("coupon") or {}).get("amount_off"),
                                                                       "duration": (p.get("coupon") or {}).get("duration"), "months": (p.get("coupon") or {}).get("duration_in_months")} for p in pcs]}
            return self._run(coupons)
        self._send(404, {"ok": False, "error": "Not found"})

    def _admin_post(self, r):
        h = self.headers
        ip = client_ip(h)
        if r == "/admin/setup":
            def setup():
                b = self._body()
                rate_limit("asetup", ip, 10, 900)
                if kv("GET", "ct:admin"):
                    raise UserError("The admin account already exists. Sign in instead.")
                clean = lambda x: re.sub(r"[^A-Z0-9]", "", str(x or "").upper())
                if not SETUP_CODE or not _hmac.compare_digest(clean(b.get("code")), clean(SETUP_CODE)):
                    raise PermissionError("That setup code isn't right.")
                email = norm_email(b.get("email"))
                pw = str(b.get("password") or "")
                if not email or len(pw) < 10:
                    raise UserError("Use your email and a password of at least 10 characters.")
                secret = str(b.get("totpSecret") or "")
                step = totp_ok(secret, b.get("totpCode"))
                if not step:
                    raise UserError("That 6-digit code didn't match. Check your authenticator app's time and try again.")
                salt, ph = pw_hash(pw)
                if kv("SET", "ct:admin", json.dumps({"email": email, "salt": salt, "hash": ph, "totp": secret, "lastStep": step, "createdAt": now()}), "NX") is None:
                    raise UserError("The admin account already exists.")
                audit(email, "created admin account")
                return {"ok": True}
            return self._run(setup)
        if r == "/admin/login":
            def login():
                b = self._body()
                rate_limit("alogin", ip, 10, 900)
                a = kv_json("ct:admin")
                email = norm_email(b.get("email"))
                if not a or email != a["email"] or not _hmac.compare_digest(pw_hash(b.get("password") or "", a["salt"])[1], a["hash"]):
                    time.sleep(0.5)
                    raise PermissionError("Wrong email, password or code.")
                step = totp_ok(a["totp"], b.get("code"), a.get("lastStep"))
                if not step:
                    raise PermissionError("Wrong email, password or code.")
                a["lastStep"] = step
                kv_set_json("ct:admin", a)
                tok = _secrets.token_urlsafe(32)
                kv_set_json("ct:asess:" + sha(tok), {"email": email, "at": now(), "ip": ip[:64]}, 12 * 3600)
                clear_limit("alogin", ip)
                audit(email, "admin signed in", detail=ip[:64])
                return {"ok": True, "token": tok, "email": email}
            return self._run(login)
        if r == "/admin/logout":
            def logout():
                auth = h.get("Authorization") or ""
                if auth.startswith("Bearer "):
                    kv("DEL", "ct:asess:" + sha(auth[7:]))
                return {"ok": True}
            return self._run(logout)

        def act(fn):
            def go():
                sess = require_admin(h)
                return fn(self._body(), sess["email"])
            return self._run(go)

        if r == "/admin/settings":
            def save_settings(b, who):
                cur = kv_json("ct:settings") or {}
                changes = []
                if "priceCents" in b:
                    p = int(b["priceCents"])
                    if p < 50 or p > 100000:
                        raise UserError("Price must be between $0.50 and $1,000.")
                    cur["priceCents"] = p
                    changes.append("price %d" % p)
                if "currency" in b:
                    c = str(b["currency"]).lower()
                    if not re.fullmatch(r"[a-z]{3}", c):
                        raise UserError("Bad currency.")
                    cur["currency"] = c
                for k, lo, hi in (("trialDays", 0, 90), ("graceDays", 0, 30)):
                    if k in b:
                        v = int(b[k])
                        if v < lo or v > hi:
                            raise UserError("%s must be %d-%d." % (k, lo, hi))
                        cur[k] = v
                        changes.append("%s %d" % (k, v))
                for k in ("signupsOpen", "requireVerify"):
                    if k in b:
                        cur[k] = bool(b[k])
                        changes.append("%s %s" % (k, cur[k]))
                if "announcement" in b:
                    cur["announcement"] = str(b["announcement"])[:400]
                    changes.append("announcement")
                kv_set_json("ct:settings", cur)
                audit(who, "changed settings", detail=", ".join(changes))
                return {"ok": True, "settings": {k: v for k, v in settings().items() if not k.startswith("stripe")}}
            return act(save_settings)
        m = re.fullmatch(r"/admin/user/([a-f0-9]{24})/(grant|revoke|suspend|unsuspend|verify|note|delete|resend|sync)", r)
        if m:
            uid, what = m.group(1), m.group(2)

            def user_action(b, who):
                u = get_user(uid)
                if not u:
                    raise UserError("No such account.")
                detail = ""
                if what == "grant":
                    if b.get("forever"):
                        until = "forever"
                    elif b.get("until"):
                        until = float(b["until"])
                    else:
                        days = int(b.get("days") or 0)
                        if days < 1 or days > 3650:
                            raise UserError("Pick a number of days.")
                        base = (u.get("comp") or {}).get("until")
                        start = base if isinstance(base, (int, float)) and base > now() and b.get("extend") else now()
                        until = start + days * DAY
                    u["comp"] = {"until": until, "note": str(b.get("note") or "")[:200], "by": who, "at": now()}
                    detail = "forever" if until == "forever" else "until @%d" % int(until)
                elif what == "revoke":
                    u.pop("comp", None)
                elif what == "suspend":
                    u["suspended"] = True
                    detail = str(b.get("note") or "")[:200]
                elif what == "unsuspend":
                    u["suspended"] = False
                elif what == "verify":
                    u["verified"] = True
                elif what == "note":
                    u["adminNote"] = str(b.get("note") or "")[:500]
                elif what == "resend":
                    if not mail_ready():
                        raise UserError("Email isn't set up on the server yet.")
                    send_verify(u, h)
                elif what == "sync":
                    sync_from_stripe(u)
                    u = get_user(uid)
                elif what == "delete":
                    if (b.get("confirm") or "").strip().lower() != u["email"]:
                        raise UserError("Type the account's email to confirm.")
                    sub = u.get("sub") or {}
                    if sub.get("id") and sub.get("status") not in ("canceled", "incomplete_expired") and STRIPE_KEY:
                        try:
                            stripe("DELETE", "/v1/subscriptions/" + sub["id"])
                        except Exception:
                            traceback.print_exc()
                    delete_user_data(u)
                    audit(who, "deleted account", uid, u["email"])
                    return {"ok": True, "deleted": True}
                if what not in ("resend", "sync"):
                    put_user(u)
                audit(who, what, uid, (u["email"] + (" " + detail if detail else "")))
                return {"ok": True, "user": admin_user_row(u, settings(), now())}
            return act(user_action)
        if r == "/admin/coupon":
            def coupon(b, who):
                code = re.sub(r"[^A-Za-z0-9_-]", "", str(b.get("code") or "")).upper()[:30]
                if not code:
                    raise UserError("Enter a code, like LAUNCH50.")
                params = {"duration": b.get("duration") if b.get("duration") in ("once", "repeating", "forever") else "once", "name": code}
                if params["duration"] == "repeating":
                    params["duration_in_months"] = max(1, min(36, int(b.get("months") or 1)))
                if b.get("percentOff"):
                    params["percent_off"] = max(1, min(100, int(b["percentOff"])))
                elif b.get("amountOffCents"):
                    params["amount_off"] = int(b["amountOffCents"])
                    params["currency"] = settings()["currency"]
                else:
                    raise UserError("Set a percent or amount off.")
                c = stripe("POST", "/v1/coupons", params)
                pc = stripe("POST", "/v1/promotion_codes", {"coupon": c["id"], "code": code})
                audit(who, "created discount code", detail=code)
                return {"ok": True, "id": pc["id"]}
            return act(coupon)
        if r == "/admin/coupon/off":
            def coupon_off(b, who):
                stripe("POST", "/v1/promotion_codes/" + re.sub(r"[^A-Za-z0-9_]", "", str(b.get("id") or "")), {"active": False})
                audit(who, "turned off discount code", detail=str(b.get("id")))
                return {"ok": True}
            return act(coupon_off)
        if r == "/admin/password":
            def change(b, who):
                a = kv_json("ct:admin")
                if not _hmac.compare_digest(pw_hash(b.get("old") or "", a["salt"])[1], a["hash"]):
                    raise PermissionError("Current password is wrong.")
                if len(str(b.get("new") or "")) < 10:
                    raise UserError("Use at least 10 characters.")
                a["salt"], a["hash"] = pw_hash(b["new"])
                kv_set_json("ct:admin", a)
                audit(who, "changed admin password")
                return {"ok": True}
            return act(change)
        self._send(404, {"ok": False, "error": "Not found"})
