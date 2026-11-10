#!/usr/bin/env python3
"""
Kingpin - local helper server.

Runs only on this computer (127.0.0.1). It:
  * serves the Kingpin app in your browser
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
import html as _html
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

VERSION = "0.20.12"  # prerelease - stays 0.x until Kingpin is finished
HOST = "127.0.0.1"
BASE_PORT = int(os.environ.get("CROWN_PORT", "8787"))
ROOT = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(ROOT, "app")
SERVE_DIR = APP_DIR  # the screens being shown: the ones that came with this copy, or a newer downloaded set (see updates)


def default_data_dir():
    """A fixed home for your data, separate from the app folder, so updating Kingpin never touches it."""
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
            raise UserError("That doesn't look like a Kingpin vault.")
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
    """First run of a new version: find data from older Kingpin folders (which kept it in Crown/data) and bring the newest copy here."""
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
            f.write("Kingpin %s copied the data in this folder to:\n%s\n\nThis copy is no longer used. You can delete this old Kingpin folder whenever you like.\n" % (VERSION, DATA_DIR))
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
    return _finish({"status": status, "carrier": "UPS", "est": "" if delivered else ymd(str(d.get("sdd") or "")), "deliveredOn": del_date if delivered else "",
                    "publicUrl": "https://www.ups.com/track?loc=en_US&tracknum=" + code, "source": "ups", "statusText": text}, events)


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


TRACK_EVENTS = 40  # scans kept per package


def _busy(kind):
    return UserError("%s is busy — too many checks this hour. Kingpin will try again later." % CARRIER_NAMES.get(kind, kind))


def _place(*parts):
    return ", ".join(str(x).strip().title() if len(str(x).strip()) > 2 else str(x).strip().upper() for x in parts if x and str(x).strip())


def _weight(v, unit):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return ""
    if f <= 0:
        return ""
    u = str(unit or "").upper()
    u = "lb" if u.startswith("LB") or u == "LBS" else "oz" if u.startswith("OZ") else "kg" if u.startswith("KG") else u.lower()
    return ("%g %s" % (round(f, 1), u)).strip()


def _finish(out, events):
    """Common tail for every carrier: newest scan last, capped, plus the last scan on its own."""
    evs = [e for e in events if e.get("message") or e.get("location")][-TRACK_EVENTS:]
    out["events"] = evs
    if evs:
        out["last"] = evs[-1]
    out["ok"] = True
    return out


def ups_api_track(code, cid, secret):
    tok = _token("ups", cid, secret)
    try:
        j = _api_json(UPS_BASE + "/api/track/v1/details/%s?locale=en_US&returnSignature=false&returnMilestones=false&returnPOD=false" % urllib.parse.quote(code),
                      headers={"Authorization": "Bearer " + tok, "transId": "crown%d" % int(time.time() * 1000), "transactionSrc": "Crown"})
    except CarrierError as e:
        if e.code == 404:
            raise UserError("UPS doesn't know this tracking number yet.")
        if e.code == 429:
            raise _busy("ups")
        raise UserError("UPS tracking error (%s)." % e)
    ship = ((j.get("trackResponse") or {}).get("shipment") or [{}])[0] or {}
    if ship.get("warnings") and not ship.get("package"):
        raise UserError("UPS: %s" % ship["warnings"][0].get("message", "no information yet"))
    pkg = (ship.get("package") or [{}])[0] or {}
    dates = {d.get("type"): _ymd(d.get("date")) for d in pkg.get("deliveryDate") or []}
    cur = pkg.get("currentStatus") or {}
    desc = str(cur.get("description") or cur.get("simplifiedTextDescription") or "")
    ctype = str(cur.get("type") or "").upper()
    acts = pkg.get("activity") or []
    delivered = ctype == "D" or bool(dates.get("DEL")) or re.search(r"\bdelivered\b", desc, re.I) is not None
    status = "delivered" if delivered else "out_for_delivery" if re.search(r"out for delivery", desc, re.I) or ctype == "O" else \
        "exception" if ctype in ("X", "RS") else "pre_transit" if ctype in ("M", "P", "MV") and not acts[1:] else "in_transit"
    events = []
    for a in acts[:TRACK_EVENTS]:
        d, t = str(a.get("date") or ""), str(a.get("time") or "000000")
        iso = "%s-%s-%sT%s:%s:%s" % (d[:4], d[4:6], d[6:8], t[:2], t[2:4], t[4:6]) if len(d) == 8 else ""
        ad = ((a.get("location") or {}).get("address") or {})
        st = a.get("status") or {}
        events.append({"date": iso, "message": st.get("description") or "", "status": "", "x": str(st.get("type") or "").upper() == "X",
                       "location": _place(ad.get("city"), ad.get("stateProvince"))})
    events.reverse()
    dt = pkg.get("deliveryTime") or {}
    adr = {str(p.get("type") or "").upper(): (p.get("address") or {}) for p in pkg.get("packageAddress") or []}
    di = pkg.get("deliveryInformation") or {}
    w = pkg.get("weight") or {}
    out = {"status": status, "carrier": "UPS", "est": "" if delivered else dates.get("RDD") or dates.get("SDD") or "", "deliveredOn": dates.get("DEL") or "",
           "window": [dt.get("startTime") or "", dt.get("endTime") or ""], "statusText": desc,
           "service": str((pkg.get("service") or {}).get("description") or "").strip(), "weight": _weight(w.get("weight"), w.get("unitOfMeasurement")),
           "from": _place((adr.get("ORIGIN") or {}).get("city"), (adr.get("ORIGIN") or {}).get("stateProvince")),
           "to": _place((adr.get("DESTINATION") or {}).get("city"), (adr.get("DESTINATION") or {}).get("stateProvince")),
           "leftAt": str(di.get("location") or "").strip() if delivered else "", "signedBy": str(di.get("receivedBy") or "").strip() if delivered else "",
           "problem": desc if status == "exception" else "",
           "publicUrl": "https://www.ups.com/track?loc=en_US&tracknum=" + code, "source": "ups-api"}
    return _finish(out, events)


def fedex_api_track(code, cid, secret):
    tok = _token("fedex", cid, secret)
    try:
        j = _api_json(FEDEX_BASE + "/track/v1/trackingnumbers", {"includeDetailedScans": True, "trackingInfo": [{"trackingNumberInfo": {"trackingNumber": code}}]},
                      headers={"Authorization": "Bearer " + tok, "X-locale": "en_US"})
    except CarrierError as e:
        if e.code == 429:
            raise _busy("fedex")
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
    status = "delivered" if delivered else "out_for_delivery" if code2 == "OD" else "exception" if code2 in ("DE", "SE", "CA", "DY", "RS") else \
        "pre_transit" if code2 in ("OC", "IN") else "in_transit"
    events = []
    for ev in (res.get("scanEvents") or [])[:TRACK_EVENTS]:
        loc = ev.get("scanLocation") or {}
        events.append({"date": ev.get("date") or "", "message": ev.get("eventDescription") or "", "status": "",
                       "x": str(ev.get("derivedStatusCode") or ev.get("eventType") or "").upper() in ("DE", "SE", "DY"),
                       "location": _place(loc.get("city"), loc.get("stateOrProvinceCode"))})
    events.reverse()
    w = (res.get("estimatedDeliveryTimeWindow") or {}).get("window") or {}
    anc = [x for x in (lsd.get("ancillaryDetails") or []) if isinstance(x, dict)]
    why = "; ".join(x for x in [str(anc[0].get("reasonDescription") or "").strip(), str(anc[0].get("actionDescription") or "").strip()] if x) if anc else ""
    dd = res.get("deliveryDetails") or {}
    wt = ((res.get("packageDetails") or {}).get("weightAndDimensions") or {}).get("weight") or []
    wt = next((x for x in wt if str(x.get("unit") or "").upper().startswith("LB")), wt[0] if wt else {})
    sa, ra = (res.get("shipperInformation") or {}).get("address") or {}, (res.get("recipientInformation") or {}).get("address") or {}
    out = {"status": status, "carrier": "FedEx", "est": "" if delivered else est, "deliveredOn": _ymd(dts.get("ACTUAL_DELIVERY")),
           "window": [w.get("begins") or "", w.get("ends") or ""], "statusText": desc,
           "service": str((res.get("serviceDetail") or {}).get("description") or "").strip(), "weight": _weight(wt.get("value"), wt.get("unit")),
           "from": _place(sa.get("city"), sa.get("stateOrProvinceCode")), "to": _place(ra.get("city"), ra.get("stateOrProvinceCode")),
           "leftAt": str(dd.get("locationDescription") or "").strip() if delivered else "", "signedBy": str(dd.get("receivedByName") or "").strip() if delivered else "",
           "problem": (why or desc) if status == "exception" else why if why and code2 in ("DY", "DE") else "",
           "publicUrl": "https://www.fedex.com/fedextrack/?trknbr=" + code, "source": "fedex-api"}
    return _finish(out, events)


def usps_api_track(code, cid, secret):
    tok = _token("usps", cid, secret)
    try:
        j = _api_json(USPS_BASE + "/tracking/v3/tracking/" + urllib.parse.quote(code) + "?expand=DETAIL", headers={"Authorization": "Bearer " + tok})
    except CarrierError as e:
        if e.code == 404:
            raise UserError("USPS has no information for this number yet.")
        if e.code == 429:
            raise _busy("usps")
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
    bad = ("alert", "exception", "return to sender", "undeliverable", "notice left", "delivery attempt", "no access", "held", "missent", "damaged")
    delivered = "delivered" in low and "not delivered" not in low and "delivery attempt" not in low and "undeliverable" not in low
    status = "delivered" if delivered else "out_for_delivery" if "out for delivery" in low else \
        "exception" if any(w in low for w in bad) else \
        "pre_transit" if any(w in low for w in ("pre-shipment", "label created", "shipping label", "pre shipment")) else "in_transit"
    deliv_day = ""
    if delivered:
        for ev in evs:
            if "delivered" in str(ev.get("eventType") or "").lower():
                deliv_day = _ymd(ev.get("eventTimestamp") or ev.get("GMTTimestamp"))
                break
    est = _ymd(j.get("expectedDeliveryTimeStamp") or j.get("expectedDeliveryDate") or j.get("guaranteedDeliveryTimeStamp") or j.get("predictedDeliveryDate"))
    events = []
    for ev in evs[:TRACK_EVENTS]:
        msg = str(ev.get("eventType") or "")
        events.append({"date": ev.get("eventTimestamp") or ev.get("GMTTimestamp") or "", "message": msg, "status": "",
                       "x": any(w in msg.lower() for w in bad), "location": _place(ev.get("eventCity"), ev.get("eventState"))})
    events.reverse()
    left = ""
    m = re.search(r"delivered,?\s*(?:to\s+)?(.+)$", st, re.I) if delivered else None
    if m and not re.search(r"^(individual|left with individual)$", m.group(1).strip(), re.I):
        left = m.group(1).strip().rstrip(".")
    elif m:
        left = "Handed to someone"
    out = {"status": status, "carrier": "USPS", "est": "" if delivered else est, "deliveredOn": deliv_day,
           "statusText": st or cat, "service": re.sub(r"[®™]", "", _html.unescape(re.sub(r"<[^>]+>", "", str(j.get("mailClass") or "")))).strip(),
           "from": _place(j.get("originCity"), j.get("originState")), "to": _place(j.get("destinationCity"), j.get("destinationState")),
           "leftAt": left, "problem": st if status == "exception" else "",
           "publicUrl": "https://tools.usps.com/go/TrackConfirmAction?tLabels=" + code, "source": "usps-api"}
    return _finish(out, events)


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




# ---------------------------------------------------------------- product pictures for the Checkout card
# A canvas can't be saved once a picture from another site is drawn on it, so pictures are fetched here and handed
# back as data. Only public https image addresses: never this computer or a private network, a size cap, images only.
IMG_MAX = 2_500_000
IMG_TYPES = ("image/png", "image/jpeg", "image/webp", "image/gif")


def _public_host(host):
    import ipaddress
    if os.environ.get("CROWN_IMG_ALLOW_LOCAL") and host in ("127.0.0.1", "localhost"):
        return True
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except Exception:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if not ip.is_global or ip.is_multicast:
            return False
    return bool(infos)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def image_fetch(req):
    url = str(req.get("url") or "").strip()
    for hop in range(4):
        u = urllib.parse.urlsplit(url)
        local_ok = os.environ.get("CROWN_IMG_ALLOW_LOCAL") and u.scheme == "http" and u.hostname in ("127.0.0.1", "localhost")
        if not (u.scheme == "https" or local_ok) or not u.hostname or len(url) > 2000:
            raise UserError("That picture link can't be used.")
        if not _public_host(u.hostname):
            raise UserError("That picture link can't be used.")
        opener = urllib.request.build_opener(_NoRedirect, urllib.request.HTTPSHandler(context=ssl_context()))
        r = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (CrownTools %s)" % VERSION, "Accept": "image/webp,image/png,image/jpeg,image/*;q=0.8"})
        try:
            with opener.open(r, timeout=12) as resp:
                ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                if ctype not in IMG_TYPES:
                    raise UserError("That link isn't a picture.")
                data = resp.read(IMG_MAX + 1)
                if len(data) > IMG_MAX:
                    raise UserError("That picture is too big.")
                return {"ok": True, "type": ctype, "data": base64.b64encode(data).decode()}
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308) and e.headers.get("Location"):
                url = urllib.parse.urljoin(url, e.headers["Location"])
                continue
            raise UserError("Couldn't load that picture (%s)." % e.code)
        except urllib.error.URLError as e:
            raise UserError("Couldn't load that picture (%s)." % e.reason)
    raise UserError("That picture link redirects too many times.")


# ---------------------------------------------------------------- Discord: reading bot checkout messages
# A Discord bot you add to your server (View Channel + Read Message History, with Message Content Intent on) lets
# Kingpin read the checkout posts your bots send to a channel. The token comes from your encrypted data on each
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
    body = {"username": _clip(p.get("username") or "Kingpin", 80), "allowed_mentions": {"parse": []}}
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


# ---------------------------------------------------------------- SKU lookup (SKU lists)
# Reads a store's public product page (the same page you'd open) for the product's name, picture and, when the page
# includes it, the price. Only well-known store sites are read. A barcode (UPC) goes to the barcode lookup instead.
SKU_STORES = {"target.com": "Target", "walmart.com": "Walmart", "bestbuy.com": "Best Buy", "pokemoncenter.com": "Pokémon Center",
              "gamestop.com": "GameStop", "costco.com": "Costco", "samsclub.com": "Sam's Club", "amazon.com": "Amazon",
              "barnesandnoble.com": "Barnes & Noble", "walgreens.com": "Walgreens", "kohls.com": "Kohl's", "meijer.com": "Meijer"}
SKU_TARGET_URL = os.environ.get("CROWN_TARGET_URL", "https://www.target.com")
_SKUCACHE = {}


def _sku_store(host):
    host = (host or "").lower()
    for d, n in SKU_STORES.items():
        if host == d or host.endswith("." + d):
            return n
    return ""


def _meta(html, *names):
    for n in names:
        for pat in (r'<meta[^>]+(?:property|name|itemprop)=["\']%s["\'][^>]*content=["\']([^"\']*)["\']' % re.escape(n),
                    r'<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name|itemprop)=["\']%s["\']' % re.escape(n)):
            m = re.search(pat, html, re.I)
            if m and m.group(1).strip():
                return _html.unescape(m.group(1).strip())
    return ""


def _ld_price(html):
    for blk in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.S | re.I)[:8]:
        m = re.search(r'"price"\s*:\s*"?(\d+(?:\.\d{1,2})?)', blk)
        if m:
            return float(m.group(1))
    return None


def sku_info(req):
    raw = str(req.get("sku") or "").strip()[:500]
    store = str(req.get("store") or "").strip()
    if not raw:
        raise UserError("Type a SKU or paste a product link.")
    url, tcin = "", ""
    m = re.search(r"https?://[^\s<>\"']+", raw)
    if m:
        url = m.group(0)
        t = re.search(r"/A-(\d{6,12})", url)
        if t and _sku_store(urllib.parse.urlsplit(url).hostname) == "Target":
            tcin = t.group(1)
    elif re.fullmatch(r"\d{6,12}", raw) and store.lower() in ("", "target"):
        tcin = raw
    elif re.fullmatch(r"\d{12,14}", re.sub(r"\D", "", raw)) and re.fullmatch(r"[\d\s-]+", raw):
        r = upc_lookup({"code": raw})
        return {"ok": True, "found": bool(r.get("found")), "sku": re.sub(r"\D", "", raw), "store": store, "name": r.get("name") or "",
                "image": r.get("image") or "", "price": r.get("msrp"), "priceFrom": "barcode lookup" if r.get("msrp") else "", "url": ""}
    if tcin:
        url = SKU_TARGET_URL + "/p/-/A-" + tcin
    if not url:
        return {"ok": True, "found": False, "sku": raw, "store": store, "why": "Paste the product link for %s items so Kingpin can read it." % (store or "this store's")}
    u = urllib.parse.urlsplit(url)
    sname = _sku_store(u.hostname) or ("Target" if tcin else "")
    local_ok = os.environ.get("CROWN_TARGET_URL") and url.startswith(SKU_TARGET_URL)
    if not local_ok and (u.scheme != "https" or not sname):
        raise UserError("Kingpin can only read product pages from big stores (Target, Walmart, Best Buy, Pokémon Center…).")
    key = url.split("#")[0]
    hit = _SKUCACHE.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    rq = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; CrownTools/%s; +https://crowntools.vercel.app)" % VERSION,
                                              "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9"})
    try:
        with urllib.request.urlopen(rq, timeout=20, context=ssl_context()) as resp:
            html = resp.read(900_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            out = {"ok": True, "found": False, "sku": tcin or raw, "store": sname, "url": url, "why": "%s says this product doesn't exist (any more)." % sname}
            _SKUCACHE[key] = (time.time() + 6 * 3600, out)
            return out
        return {"ok": True, "found": False, "sku": tcin or raw, "store": sname, "url": url, "why": "%s didn't answer (%s). Try again later or type the name." % (sname, e.code)}
    except urllib.error.URLError as e:
        return {"ok": True, "found": False, "sku": tcin or raw, "store": sname, "url": url, "why": "Couldn't reach %s (%s)." % (sname, e.reason)}
    name = _meta(html, "og:title", "twitter:title")
    if not name:
        t = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
        name = _html.unescape(t.group(1)).strip() if t else ""
    name = re.sub(r"\s*[:|\-–]\s*(Target|Walmart\.com|Best Buy|Pok[eé]mon Center|GameStop|Costco|Amazon\.com)\s*$", "", name, flags=re.I).strip()
    img = _meta(html, "og:image", "twitter:image")
    price = None
    pm = _meta(html, "product:price:amount", "og:price:amount", "price")
    try:
        price = float(re.sub(r"[^\d.]", "", pm)) if pm else None
    except ValueError:
        price = None
    if price is None:
        price = _ld_price(html)
    found = bool(name) and not re.search(r"(page not found|product not found|access denied|robot|captcha)", name, re.I)
    out = {"ok": True, "found": found, "sku": tcin or raw, "store": sname, "url": url, "name": _clip(name, 200) if found else "",
           "image": img if found and img.startswith("https://") else "", "price": price if found and price and 0 < price < 100000 else None,
           "priceFrom": sname if found and price else ""}
    if not found:
        out["why"] = "%s didn't show this product's details." % sname
    else:
        _SKUCACHE[key] = (time.time() + 6 * 3600, out)
    return out


# ---------------------------------------------------------------- Pokémon news (public RSS feeds from news sites)
# Only public feeds that the sites publish for readers. Each feed is read at most every 20 minutes per server.
NEWS_FEEDS = [
    # id, name, url, only items that mention Pokémon (for general gaming sites)
    ("pokebeach", "PokéBeach", "https://www.pokebeach.com/forums/forum/-/index.rss", False),
    ("pokemon", "Pokémon (official)", "https://www.pokemon.com/us/pokemon-news/rss", False),
    ("pokeguardian", "PokéGuardian", "https://www.pokeguardian.com/feed", False),
    ("pokejungle", "PokéJungle", "https://pokejungle.net/feed/", False),
    ("pokemondb", "Pokémon Database", "https://pokemondb.net/news/feed", False),
    ("pokemonblog", "Pokémon Blog", "https://pokemonblog.com/feed/", False),
    ("nintendolife", "Nintendo Life", "https://www.nintendolife.com/feeds/latest/tags/pokemon", False),
    ("polygon", "Polygon", "https://www.polygon.com/rss/pokemon/index.xml", False),
    ("gamerant", "Game Rant", "https://gamerant.com/feed/category/pokemon-news/", False),
    ("siliconera", "Siliconera", "https://www.siliconera.com/feed/", True),
    ("dexerto", "Dexerto", "https://www.dexerto.com/pokemon/feed/", False),
    ("bleedingcool", "Bleeding Cool", "https://bleedingcool.com/tag/pokemon/feed/", False),
    ("reddit-tcg", "r/PokemonTCG", "https://www.reddit.com/r/PokemonTCG/new/.rss", False),
]
if os.environ.get("CROWN_NEWS_FEEDS"):  # tests point the built-in list at a local mock
    NEWS_FEEDS = [tuple(x) for x in json.loads(os.environ["CROWN_NEWS_FEEDS"])]
NEWS_EXTRA = {  # other addresses tried by the health check, to find feeds that moved
    "pokeguardian": ["https://www.pokeguardian.com/rss", "https://www.pokeguardian.com/feed.xml", "https://pokeguardian.com/feed/"],
    "pokebeach": ["https://www.pokebeach.com/feed"],
    "trackalacker": ["https://www.trackalacker.com/feed", "https://www.trackalacker.com/rss.xml", "https://www.trackalacker.com/articles/rss"],
    "tcgdropradar": ["https://tcgdropradar.com/rss.xml", "https://tcgdropradar.com/feed.xml", "https://tcgdropradar.com/blog/rss.xml"],
    "serebii": ["https://www.serebii.net/rss.xml", "https://www.serebii.net/news.rss"],
    "reddit-pi": ["https://www.reddit.com/r/PokeInvesting/new/.rss"],
}
_NEWSCACHE = {}
NEWS_TTL = 20 * 60
_POKE = re.compile(r"pok[eé]mon|pikachu|\btcg\b|elite trainer|booster", re.I)


def _news_get(url, ttl=NEWS_TTL):
    hit = _NEWSCACHE.get(url)
    if hit and hit[0] > time.time():
        return hit[1]
    u = urllib.parse.urlsplit(url)
    local_ok = os.environ.get("CROWN_NEWS_ALLOW_LOCAL") and u.scheme == "http" and u.hostname in ("127.0.0.1", "localhost")
    if not (u.scheme == "https" or local_ok) or not u.hostname or (not local_ok and not _public_host(u.hostname)):
        raise UserError("That feed address can't be used.")
    rq = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; Kingpin/%s news reader)" % VERSION,
                                              "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5"})
    try:
        with urllib.request.urlopen(rq, timeout=12, context=ssl_context()) as resp:
            data = resp.read(3_000_000)
    except urllib.error.HTTPError as e:
        raise UserError("The site answered %s." % e.code)
    except (urllib.error.URLError, OSError) as e:
        raise UserError("Couldn't reach the site (%s)." % getattr(e, "reason", e))
    _NEWSCACHE[url] = (time.time() + ttl, data)
    return data


def _strip_html(h):
    h = re.sub(r"(?is)<(script|style|iframe|noscript)[^>]*>.*?</\1>", " ", h or "")
    h = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>|</h[1-6]>", "\n", h)
    h = re.sub(r"(?i)<li[^>]*>", "\n• ", h)
    t = re.sub(r"<[^>]+>", "", h)
    t = html_unescape(t).replace("\xa0", " ")
    t = re.sub(r"[ \t]+", " ", t)
    paras = [p.strip() for p in re.split(r"\n\s*", t) if p.strip()]
    return "\n\n".join(paras)


def html_unescape(t):
    import html as _h
    return _h.unescape(t or "")


# retailer product links → store + SKU
_SKU_PATTERNS = [
    ("Target", re.compile(r"target\.com/p/(?:[^\s\"'<>?#]*?/)?-?/?A-(\d{6,10})", re.I)),
    ("Walmart", re.compile(r"walmart\.com/ip/(?:[^\s\"'<>?#]*/)?(\d{6,12})(?=[/?#\"'\s<]|$)", re.I)),
    ("Best Buy", re.compile(r"bestbuy\.com/site/[^\s\"'<>]*?(?:/(\d{7})\.p|skuId=(\d{7}))", re.I)),
    ("Pokémon Center", re.compile(r"pokemoncenter\.com/(?:[a-z-]+/)?product/(\d{2,3}-\d{5}(?:-\d+)?)", re.I)),
    ("GameStop", re.compile(r"gamestop\.com/[^\s\"'<>]*?/(\d{5,8})\.html", re.I)),
    ("Amazon", re.compile(r"amazon\.com/(?:[^\s\"'<>]*?/)?(?:dp|gp/product)/([A-Z0-9]{10})", re.I)),
]


def _unwrap(href):
    # affiliate and tracking links carry the real address inside them
    for _ in range(3):
        try:
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(href).query)
        except ValueError:
            return href
        inner = next((v[0] for k, v in q.items() if k.lower() in ("url", "u", "murl", "dest", "destination", "redirect", "target", "r") and v and v[0].startswith("http")), "")
        if not inner:
            return href
        href = inner
    return href


def _skus_in(html):
    out, seen = [], set()
    for m in re.finditer(r"(?is)<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", html or ""):
        href, label = _unwrap(html_unescape(m.group(1))), _strip_html(m.group(2)).strip()
        for store, rx in _SKU_PATTERNS:
            mm = rx.search(href)
            if mm:
                sku = next(g for g in mm.groups() if g)
                if (store, sku) in seen:
                    break
                seen.add((store, sku))
                bad = not label or len(label) < 6 or label.lower() in ("here", "link", "this link", "click here", "buy now", "shop now") or label.lower().startswith(("http", "www."))
                out.append({"store": store, "sku": sku, "url": href.split("#")[0][:500], "name": "" if bad or store.lower() in label.lower() and len(label) < 20 else label[:160]})
                break
    # plain "TCIN: 12345678" written in the text
    for mm in re.finditer(r"\bTCIN[:#\s]*?(\d{8,10})\b", _strip_html(html or ""), re.I):
        if ("Target", mm.group(1)) not in seen:
            seen.add(("Target", mm.group(1)))
            out.append({"store": "Target", "sku": mm.group(1), "url": "https://www.target.com/p/-/A-" + mm.group(1), "name": ""})
    return out[:40]


_KIND_RULES = [
    ("raffle", re.compile(r"\braffle|\blottery\b|\bdrawing\b|enter (?:for|to win) a chance|chance to (?:buy|purchase)|sign[- ]?ups? (?:are )?open", re.I)),
    ("change", re.compile(r"\blimit(?:s|ed|ing)? (?:of |to )?\d|per (?:customer|guest|household|person)|purchase limit|policy|no longer|\bbann?(?:ed|ing)\b|\bbots?\b|cancel(?:s|led|ling)? (?:orders|preorders)|crack(?:s|ing)? down|new rule", re.I)),
    ("restock", re.compile(r"\brestock|back in stock|in stock (?:now|again)|\breprint", re.I)),
    ("drop", re.compile(r"\bdrop(?:s|ping|ped)?\b|release date|releas(?:e|es|ing) (?:on|in|this|today|tomorrow|next)|launch(?:es|ing)?\b|pre-?orders?|goes live|available (?:now|today|on)|on sale", re.I)),
]


def _news_kind(title, text):
    t = title or ""
    for k, rx in _KIND_RULES:
        if rx.search(t):
            return k
    head = (text or "")[:600]
    for k, rx in _KIND_RULES:
        if k != "drop" and rx.search(head):
            return k
    return "drop" if _KIND_RULES[3][1].search(head) and re.search(r"target|walmart|best buy|pok[eé]mon center|gamestop|amazon", t + " " + head, re.I) else "news"


def _news_date(s):
    from email.utils import parsedate_to_datetime
    s = (s or "").strip()
    if not s:
        return 0
    try:
        return int(parsedate_to_datetime(s).timestamp() * 1000)
    except (TypeError, ValueError, IndexError):
        pass
    try:
        s2 = re.sub(r"Z$", "+00:00", s)
        return int(datetime.datetime.fromisoformat(s2).timestamp() * 1000)
    except ValueError:
        return 0


def _parse_feed(data, src, name, poke_only):
    import xml.etree.ElementTree as ET
    txt = data.decode("utf-8", "replace") if isinstance(data, bytes) else data
    txt = re.sub(r"^[^<]+", "", txt)
    try:
        root = ET.fromstring(txt.encode("utf-8"))
    except ET.ParseError:
        # a few sites send slightly broken XML: drop characters XML doesn't allow and try once more
        try:
            root = ET.fromstring(re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", txt).replace("&nbsp;", "&#160;").encode("utf-8"))
        except ET.ParseError:
            raise UserError("The feed couldn't be read.")
    loc = lambda tag: tag.rsplit("}", 1)[-1].lower() if isinstance(tag, str) else ""
    entries = [e for e in root.iter() if loc(e.tag) in ("item", "entry")]
    if not entries and loc(root.tag) not in ("rss", "feed", "rdf"):
        raise UserError("That address isn't a news feed.")
    out = []
    for e in entries[:60]:
        f = {}
        for c in e:
            k = loc(c.tag)
            if k == "link":
                href = c.get("href")
                if href and (c.get("rel") in (None, "alternate")):
                    f.setdefault("link", href)
                elif (c.text or "").strip():
                    f.setdefault("link", c.text.strip())
            elif k in ("encoded", "content") and (c.text or "").strip():
                f["content"] = c.text if len(c.text) > len(f.get("content", "")) else f["content"]
            elif k in ("description", "summary") and (c.text or "").strip():
                f.setdefault("desc", c.text)
            elif k in ("pubdate", "published", "updated", "date"):
                f.setdefault("date", (c.text or "").strip())
            elif k == "title":
                f["title"] = _strip_html(c.text or "").replace("\n\n", " ")
            elif k in ("thumbnail", "content") and c.get("url"):
                f.setdefault("image", c.get("url"))
            elif k == "enclosure" and str(c.get("type") or "").startswith("image") and c.get("url"):
                f.setdefault("image", c.get("url"))
            elif k == "group":
                for g in c:
                    if loc(g.tag) in ("thumbnail", "content") and g.get("url"):
                        f.setdefault("image", g.get("url"))
            elif k == "category":
                f.setdefault("cats", []).append((c.text or c.get("term") or "").strip())
        body = f.get("content") or f.get("desc") or ""
        title = (f.get("title") or "").strip()
        if not title or not f.get("link"):
            continue
        text = _strip_html(body)
        if poke_only and not _POKE.search(title + " " + text[:1500] + " " + " ".join(f.get("cats", []))):
            continue
        img = f.get("image") or ""
        if not img:
            m = re.search(r"(?is)<img\b[^>]*\bsrc=[\"'](https://[^\"']+)[\"']", body)
            img = html_unescape(m.group(1)) if m else ""
        link = f["link"].strip()
        if not link.startswith("https://") and not link.startswith("http://"):
            continue
        ts = _news_date(f.get("date")) or 0
        # removing "[...]" stubs and "The post X appeared first on Y" footers
        text = re.sub(r"\s*(?:\[(?:…|\.\.\.|&hellip;)\]|The post .{0,200} appeared first on .{0,80}\.)\s*$", "", text).strip()
        out.append({"id": src + ":" + hashlib.sha1(link.encode()).hexdigest()[:16], "src": src, "srcName": name, "title": title[:240], "link": link[:600],
                    "date": ts, "text": text[:12000], "image": img[:600] if img.startswith("https://") else "", "skus": _skus_in(body),
                    "kind": _news_kind(title, text), "tcg": bool(re.search(r"\btcg\b|trading card|booster|elite trainer|\betb\b|collection box|\bpacks?\b|card game|\bset\b", title + " " + text[:800], re.I))})
    return out


def news_fetch(req):
    """Reads the news feeds (built-in ones the person kept switched on, plus their own), newest first."""
    from concurrent.futures import ThreadPoolExecutor
    off = set(str(x) for x in (req.get("off") or []))
    feeds = [(i, n, u, p) for (i, n, u, p) in NEWS_FEEDS if i not in off]
    for c in (req.get("custom") or [])[:15]:
        u = str((c or {}).get("url") or "").strip()
        if u.startswith(("https://", "http://")) and len(u) < 600:
            feeds.append(("c-" + hashlib.sha1(u.encode()).hexdigest()[:8], str(c.get("name") or urllib.parse.urlsplit(u).hostname or "Feed")[:60], u, bool(c.get("pokeOnly"))))
    fresh = bool(req.get("fresh"))

    def one(f):
        i, n, u, p = f
        try:
            if fresh:
                hit = _NEWSCACHE.get(u)
                if hit and hit[0] - NEWS_TTL + 5 * 60 < time.time():  # "refresh now" re-reads anything older than 5 minutes
                    _NEWSCACHE.pop(u, None)
            items = _parse_feed(_news_get(u), i, n, p)
            return {"id": i, "name": n, "url": u, "ok": True, "count": len(items)}, items
        except UserError as e:
            return {"id": i, "name": n, "url": u, "ok": False, "error": str(e)}, []
        except Exception as e:  # one bad feed never breaks the rest
            return {"id": i, "name": n, "url": u, "ok": False, "error": "Couldn't read it (%s)." % type(e).__name__}, []
    with ThreadPoolExecutor(max_workers=8) as ex:
        res = list(ex.map(one, feeds))
    items = [it for _, its in res for it in its]
    since = int(req.get("since") or 0)
    if since:
        items = [it for it in items if not it["date"] or it["date"] >= since]
    items.sort(key=lambda x: -(x["date"] or 0))
    return {"ok": True, "at": int(time.time() * 1000), "sources": [s for s, _ in res], "items": items[:400],
            "builtin": [{"id": i, "name": n, "url": u} for (i, n, u, p) in NEWS_FEEDS]}


def news_status(req=None):
    """Health check of every built-in feed and the other addresses tried (for finding moved feeds)."""
    from concurrent.futures import ThreadPoolExecutor
    cands = [(i, u, p) for (i, n, u, p) in NEWS_FEEDS] + [(i, u, False) for i, us in NEWS_EXTRA.items() for u in us]

    def one(c):
        i, u, p = c
        try:
            items = _parse_feed(_news_get(u, 300), i, i, p)
            return {"id": i, "url": u, "ok": True, "count": len(items), "newest": items and max(x["date"] for x in items), "skus": sum(len(x["skus"]) for x in items),
                    "sample": [x["title"][:80] for x in items[:2]], "kinds": sorted({x["kind"] for x in items})}
        except Exception as e:
            return {"id": i, "url": u, "ok": False, "error": str(e)[:120]}
    with ThreadPoolExecutor(max_workers=10) as ex:
        return {"ok": True, "feeds": list(ex.map(one, cands))}


# ---------------------------------------------------------------- Pokémon product catalog (Target's public product sitemap)
# Target publishes a sitemap of every product page for search engines (listed in its robots.txt). Kingpin reads the
# Pokémon ones from it once a day: the TCIN, the name in the page address and the product picture. Sets and their
# release dates come from TCGplayer's public set list (tcgcsv.com). The online server keeps one shared copy, so the
# sitemap is read once a day in total, not once per person; the Mac/PC app gets the list from the online server.
PK_TARGET_INDEX = os.environ.get("CROWN_TARGET_SITEMAP") or "https://www.target.com/sitemap_pdp-index.xml.gz"
PK_REMOTE = (os.environ.get("CROWN_PK_URL") or "https://crowntools.vercel.app/api/pk/catalog").rstrip("/")
PK_MAX_AGE = 20 * 3600
_PK_URL = re.compile(r"<loc>https://www\.target\.com/p/([^<]*?)/-/A-(\d{6,12})</loc>(?:\s*<image:image>\s*<image:loc>([^<]+)</image:loc>)?", re.I)
_PK_POKE = re.compile(r"(?:^|-)pok(?:e|-233-|%c3%a9)mon(?:-|$)", re.I)
_PK_TCG = re.compile(r"\b(?:tcg|trading card|booster|elite trainer|etb|tin|blister|collection|card game|deck|sleeved|build battle|premium|bundle|box set|binder|portfolio|display|surprise box)\b", re.I)
_PK_MERCH = re.compile(r"\b(?:plush|figure|shirt|t shirt|hoodie|pajama|sock|hat|cap|backpack|lunch|bottle|mug|cup|towel|blanket|pillow|bedding|sheet|costume|toy|lego|mega construx|squishmallow|nintendo switch|switch 2|video game|game for|amiibo|book|puzzle|keychain|key chain|sticker|watch|lamp|night light|ornament|poster frame|wallet|bag|jacket|shoes|slippers|figurine|battle figure|action figure|clip n go|clip 'n' go|funko)\b", re.I)
_PK_IMPORT = re.compile(r"\b(?:psa|cgc|bgs|graded|gem mint|acrylic|jpn|kor|pack kit|single multicolor|ages 13|japanese|japan|korean|chinese|thai|indonesian|simplified|traditional|import|\d+ ?(?:pack|pk)s? lot|lot of|set of \d|bundle of \d|\d+[- ]pack(?! (?:blister|booster))|case of|sealed case|(?:2|3|4|5|6|8|10|12|24|36) ?x)\b", re.I)
PK_TYPES = [
    ("Elite Trainer Box", r"elite trainer|\betb\b"),
    ("Booster Bundle", r"booster bundle"),
    ("Booster Box", r"booster (?:box|display)|display box|36 pack|36 booster"),
    ("Premium Collection", r"(?:ultra|super)[- ]premium|premium collection|\bupc\b|\bspc\b"),
    ("Sleeved Booster", r"sleeved booster"),
    ("Blister", r"blister|checklane|3 pack booster|3 booster|three booster|2 pack booster"),
    ("Mini Tin", r"mini tin"),
    ("Tin", r"\btin\b|\btins\b"),
    ("Build & Battle", r"build (?:&|and|n)? ?battle|build battle"),
    ("Deck", r"\bdeck\b|battle academy|league battle|world championships"),
    ("Binder / Poster", r"binder|portfolio|poster collection|poster box"),
    ("Surprise Box", r"surprise box|mystery"),
    ("Booster Pack", r"booster pack|\bbooster\b"),
    ("Collection Box", r"collection|\bbox\b|chest|bundle|gift set|pin|figure collection|\bex & [\w’]+ ex\b|\bv & [\w’]+ v\b"),
]
_PK_TYPES = [(n, re.compile(rx, re.I)) for n, rx in PK_TYPES]
_PK_WORDS = {"pokemon": "Pokémon", "pokémon": "Pokémon", "tcg": "TCG", "etb": "ETB", "ex": "ex", "gx": "GX", "vmax": "VMAX", "vstar": "VSTAR", "v": "V", "sv": "SV",
             "me": "ME", "upc": "UPC", "spc": "SPC", "go": "GO", "xy": "XY", "sm": "SM", "swsh": "SWSH", "and": "&", "n": "n", "of": "of", "the": "the", "with": "with", "a": "a",
             "in": "in", "for": "for", "to": "to"}


_PK_ENT = {"8212": " — ", "8211": " – ", "8217": "’", "8216": "‘", "39": "’", "38": " & ", "233": "é", "174": "", "8482": ""}


def _pk_words(slug):
    # Target writes punctuation in its page addresses as numbers: —, &, é and ’ become -8212-, -38-, -233-, -8217-
    s = urllib.parse.unquote(slug).lower()
    s = re.sub(r"(?<=[a-z])-233-(?=[a-z])", "é", s)
    s = re.sub(r"-(8212|8211|8217|8216|39|38|233|174|8482)-(?=[a-z])", lambda m: "-" + _PK_ENT[m.group(1)].strip() + "-" if _PK_ENT[m.group(1)].strip() in ("—", "–", "&") else _PK_ENT[m.group(1)] + "-" if m.group(1) in ("8217", "39") else "-", s)
    s = s.replace("-’-", "’").replace("’-s-", "’s-")
    return re.sub(r"\s+", " ", re.sub(r"[-_]+", " ", s)).strip()


def _pk_name(words):
    out = []
    for i, w in enumerate(words.split()):
        out.append(_PK_WORDS.get(w, w if re.match(r"^\d", w) else w[:1].upper() + w[1:]) if (i == 0 or w not in ("and", "of", "the", "with", "a", "in", "for", "to")) else _PK_WORDS[w])
    n = " ".join(out)
    n = re.sub(r"\bPokémon Pokémon\b", "Pokémon", n)
    return n[:160]


def _pk_sets():
    """English Pokémon TCG sets, newest first: id, name, the words to look for in a product name, release date."""
    try:
        groups = _groups("3")
    except UserError:
        return []
    out = []
    for g in groups:
        name = re.sub(r"^[A-Z0-9.]{1,8}:\s*", "", g["name"]).strip()
        if not name or re.search(r"promo|trainer kit|jumbo|prize pack|world championship|deck exclusive|battle academy|code card|miscellaneous|league|alternate art|blister exclusive", name, re.I):
            continue
        if g["date"] and g["date"] < "2016":
            continue  # Target's online list is all recent products; old set names (Jungle, Team Rocket…) only cause wrong matches
        key = re.sub(r"[^a-z0-9 ]+", " ", name.lower().replace("é", "e").replace("&", " ")).split()
        key = [w for w in key if w not in ("sword", "shield", "scarlet", "violet", "sun", "moon", "mega", "evolution", "xy") or len(key) <= 2]
        if not key:
            continue
        out.append({"id": str(g["id"]), "name": name, "key": " ".join(key), "date": g["date"]})
    return out


def _pk_classify(words, sets):
    words = words.replace("é", "e")
    t = next((n for n, rx in _PK_TYPES if rx.search(words)), "")
    merch = bool(_PK_MERCH.search(words)) and not re.search(r"elite trainer|booster|\btcg\b|trading card", words)
    tcg = not merch and bool(_PK_TCG.search(words) or t)
    s = ""
    for st in sets:  # newest set first, longest names win ties by checking full phrase
        if re.search(r"(?:^|\s)" + re.escape(st["key"]) + r"(?:\s|$)", words):
            s = st["id"]
            break
    return {"ty": t if tcg else ("Merch" if merch else "Other"), "s": s, "tcg": tcg, "imp": bool(_PK_IMPORT.search(words)),
            "o": words.startswith("pokémon trading card game") or words.startswith("pokemon trading card game")}


def pk_scan_target(prev=None):
    """Reads Target's product sitemap for Pokémon products. Takes about a minute (100+ files read in parallel)."""
    from concurrent.futures import ThreadPoolExecutor
    import gzip

    def get(url):
        rq = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; Kingpin/%s; daily catalog read of the public sitemap)" % VERSION})
        with urllib.request.urlopen(rq, timeout=60, context=ssl_context()) as r:
            data = r.read(80_000_000)
        return gzip.decompress(data) if data[:2] == b"\x1f\x8b" else data
    idx = get(PK_TARGET_INDEX).decode("utf-8", "replace")
    files = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", idx)
    if not files:
        raise UserError("Target's product list was empty.")

    def scan(u):
        try:
            t = get(u).decode("utf-8", "replace")
        except Exception:
            return None
        return [(m.group(1), m.group(2), m.group(3) or "") for m in _PK_URL.finditer(t) if _PK_POKE.search(m.group(1))]
    with ThreadPoolExecutor(max_workers=10) as ex:
        parts = list(ex.map(scan, files))
    failed = sum(1 for p in parts if p is None)
    if failed > len(files) // 4:
        raise UserError("Couldn't read enough of Target's product list (%d of %d parts failed)." % (failed, len(files)))
    sets = _pk_sets()
    old = {x["t"]: x for x in ((prev or {}).get("items") or [])}
    now_ms = int(time.time() * 1000)
    first_scan = not old
    items, seen = [], set()
    for p in parts:
        for slug, tcin, img in p or []:
            if tcin in seen:
                continue
            seen.add(tcin)
            w = _pk_words(slug)
            c = _pk_classify(w, sets)
            if not c["tcg"]:
                continue  # trading-card products only (no shirts, plush or games)
            o = old.get(tcin) or {}
            im = img.rsplit("/", 1)[-1] if img.startswith("https://target.scene7.com/is/image/Target/") else ""
            items.append({"t": tcin, "n": _pk_name(w), "s": c["s"], "ty": c["ty"] or "Other", "o": c["o"], "imp": c["imp"], "img": im,
                          "f": o.get("f") if "f" in o else (0 if first_scan else now_ms)})
    # products no longer on Target's list are kept for a while, marked gone (so they still show up in your history)
    for t, o in old.items():
        if t not in seen and now_ms - (o.get("gone") or now_ms) < 60 * 86400000:
            o = dict(o); o.setdefault("gone", now_ms); items.append(o)
    items.sort(key=lambda x: -int(x["t"]))
    return {"at": now_ms, "items": items, "sets": [{"id": s["id"], "name": s["name"], "date": s["date"]} for s in sets],
            "files": len(files), "failed": failed, "src": "Target product sitemap"}


def pk_catalog(req=None):
    """The Mac/PC app: the shared list from Kingpin Online (or a local read when testing)."""
    req = req or {}
    if os.environ.get("CROWN_PK_LOCAL"):
        hit = _NEWSCACHE.get("pk:local")
        if hit and hit[0] > time.time() and not req.get("fresh"):
            return hit[1]
        out = dict(pk_scan_target(hit[1] if hit else None), ok=True)
        _NEWSCACHE["pk:local"] = (time.time() + PK_MAX_AGE, out)
        return out
    hit = _NEWSCACHE.get("pk:remote")
    if hit and hit[0] > time.time() and not req.get("fresh"):
        return hit[1]
    rq = urllib.request.Request(PK_REMOTE + ("?fresh=1" if req.get("fresh") else ""), headers={"Accept": "application/json", "X-Crown": "1", "User-Agent": "Kingpin/%s" % VERSION})
    try:
        with urllib.request.urlopen(rq, timeout=280, context=ssl_context()) as r:
            out = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if hit:
            return hit[1]
        raise UserError("Couldn't get the product list from Kingpin Online (%s)." % e.code)
    except (urllib.error.URLError, OSError) as e:
        if hit:
            return hit[1]
        raise UserError("Couldn't reach Kingpin Online for the product list (%s)." % getattr(e, "reason", e))
    _NEWSCACHE["pk:remote"] = (time.time() + 3 * 3600, out)
    return out


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


# ---------------------------------------------------------------- StockX (prices for sneakers, LEGO, consoles...)
# Uses StockX's official API. The app owner registers a StockX developer app and sets STOCKX_CLIENT_ID,
# STOCKX_CLIENT_SECRET and STOCKX_API_KEY; each person then signs in to StockX once (OAuth) and their tokens are kept
# inside their own encrypted Kingpin data, sent along with each price request.
STOCKX_API = (os.environ.get("CROWN_STOCKX_API") or "https://api.stockx.com/v2").rstrip("/")
STOCKX_AUTH = (os.environ.get("CROWN_STOCKX_AUTH") or "https://accounts.stockx.com").rstrip("/")


def stockx_conf():
    return {"id": os.environ.get("STOCKX_CLIENT_ID", ""), "secret": os.environ.get("STOCKX_CLIENT_SECRET", ""), "key": os.environ.get("STOCKX_API_KEY", "")}


def stockx_ready():
    c = stockx_conf()
    return bool(c["id"] and c["secret"] and c["key"])


def stockx_status(req):
    return {"ok": True, "configured": stockx_ready()}


def stockx_login_url(redirect_uri, state):
    c = stockx_conf()
    if not stockx_ready():
        raise UserError("StockX isn't set up on this Kingpin yet.")
    q = urllib.parse.urlencode({"response_type": "code", "client_id": c["id"], "redirect_uri": redirect_uri, "scope": "offline_access openid",
                                "audience": "gateway.stockx.com", "state": state})
    return STOCKX_AUTH + "/authorize?" + q


def _stockx_token(data):
    c = stockx_conf()
    data = dict(data, client_id=c["id"], client_secret=c["secret"])
    try:
        j = _api_json(STOCKX_AUTH + "/oauth/token", data, form=True)
    except CarrierError as e:
        raise UserError("StockX sign-in didn't work (%s). Connect StockX again in Settings." % (e.args[1] if len(e.args) > 1 else e))
    if not j.get("access_token"):
        raise UserError("StockX sign-in didn't work. Connect StockX again in Settings.")
    return {"access": j["access_token"], "refresh": j.get("refresh_token") or data.get("refresh_token") or "", "exp": int(time.time()) + int(j.get("expires_in") or 3600) - 60}


def stockx_exchange(code, redirect_uri):
    return _stockx_token({"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri})


def _stockx_auth(req):
    """The caller's tokens, refreshed when they're about to run out. Returns (tokens, changed)."""
    a = req.get("auth") or {}
    if not stockx_ready():
        raise UserError("StockX isn't set up on this Kingpin yet.")
    if not a.get("refresh") and not a.get("access"):
        raise UserError("Connect StockX in Settings first.")
    if a.get("access") and int(a.get("exp") or 0) > time.time():
        return a, False
    if not a.get("refresh"):
        raise UserError("Your StockX sign-in ran out. Connect StockX again in Settings.")
    return _stockx_token({"grant_type": "refresh_token", "refresh_token": a["refresh"]}), True


def _stockx_get(path, tok):
    try:
        return _api_json(STOCKX_API + path, headers={"Authorization": "Bearer " + tok["access"], "x-api-key": stockx_conf()["key"]})
    except CarrierError as e:
        if e.args and e.args[0] in (401, 403):
            raise UserError("StockX turned the request down. Connect StockX again in Settings.")
        if e.args and e.args[0] == 429:
            raise UserError("StockX is busy - try again in a minute.")
        raise UserError("StockX didn't answer (%s)." % (e.args[0] if e.args else "error"))


def stockx_search(req):
    q = str(req.get("q") or "").strip()[:120]
    if len(q) < 2:
        raise UserError("Type what to search for.")
    tok, changed = _stockx_auth(req)
    j = _stockx_get("/catalog/search?" + urllib.parse.urlencode({"query": q, "pageNumber": 1, "pageSize": 12}), tok)
    out = []
    for p in (j.get("products") or [])[:12]:
        a = p.get("productAttributes") or {}
        out.append({"id": p.get("productId"), "title": p.get("title") or "", "brand": p.get("brand") or "", "type": p.get("productType") or "",
                    "urlKey": p.get("urlKey") or "", "style": p.get("styleId") or "", "retail": a.get("retailPrice"), "released": a.get("releaseDate") or ""})
    r = {"ok": True, "results": [x for x in out if x["id"]]}
    if changed:
        r["auth"] = tok
    return r


def _num(v):
    try:
        f = float(v)
        return f if f > 0 else None
    except (TypeError, ValueError):
        return None


def stockx_prices(req):
    ids = [str(i) for i in (req.get("ids") or []) if re.fullmatch(r"[A-Za-z0-9\-]{6,64}", str(i))][:60]
    if not ids:
        return {"ok": True, "prices": {}}
    tok, changed = _stockx_auth(req)
    prices = {}
    for pid in ids:
        try:
            j = _stockx_get("/catalog/products/%s/market-data?currencyCode=USD" % pid, tok)
        except UserError:
            continue
        rows = j if isinstance(j, list) else (j.get("variants") or j.get("marketData") or [j])
        vals, asks, bids = [], [], []
        for v in rows:
            ask, bid = _num(v.get("lowestAskAmount")), _num(v.get("highestBidAmount"))
            if ask:
                asks.append(ask)
            if bid:
                bids.append(bid)
            if ask and bid:
                vals.append(min(ask, (ask + bid) / 2))
            elif ask or bid:
                vals.append(ask or bid)
        if vals:
            vals.sort()
            mid = vals[len(vals) // 2]
            prices[pid] = {"value": round(mid, 2), "ask": round(min(asks), 2) if asks else None, "bid": round(max(bids), 2) if bids else None, "at": int(time.time())}
    r = {"ok": True, "prices": prices}
    if changed:
        r["auth"] = tok
    return r


def stockx_done_page(payload):
    """After StockX sign-in: back to Kingpin with the tokens in the part of the link that never reaches a server."""
    frag = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return ("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><title>Kingpin</title>"
            "<meta http-equiv=refresh content='0;url=/#stockx=%s'><p style='font:16px system-ui;padding:24px'>Connecting StockX...</p>" % frag)


# ---------------------------------------------------------------- ACO invoices: card payments through the user's Stripe
ACO_STRIPE = (os.environ.get("CROWN_ACO_STRIPE_API") or os.environ.get("STRIPE_API_BASE") or "https://api.stripe.com").rstrip("/")


def _aco_key(req):
    k = str(req.get("key") or "").strip()
    if not re.fullmatch(r"(sk|rk)_(live|test)_[A-Za-z0-9]{10,200}", k):
        raise UserError("That doesn't look like a Stripe secret key (sk_live_... or rk_live_...).")
    return k


def _aco_stripe(key, method, path, params=None):
    def flat(d, prefix=""):
        out = []
        for k, v in (d or {}).items():
            name = "%s[%s]" % (prefix, k) if prefix else k
            if isinstance(v, dict):
                out += flat(v, name)
            elif isinstance(v, list):
                for i, x in enumerate(v):
                    out += flat(x, "%s[%d]" % (name, i)) if isinstance(x, dict) else [("%s[%d]" % (name, i), str(x))]
            elif v is not None:
                out.append((name, "true" if v is True else "false" if v is False else str(v)))
        return out
    body = urllib.parse.urlencode(flat(params)).encode() if method == "POST" else None
    url = ACO_STRIPE + path + ("?" + urllib.parse.urlencode(flat(params)) if method == "GET" and params else "")
    req = urllib.request.Request(url, data=body, method=method, headers={"Authorization": "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": "2024-06-20"})
    try:
        with urllib.request.urlopen(req, timeout=20, context=ssl_context()) as r:
            return json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            msg = (json.loads(e.read().decode("utf-8", "replace")).get("error") or {}).get("message") or ""
        except Exception:
            msg = ""
        if e.code == 401:
            raise UserError("Stripe didn't accept that key.")
        if e.code == 403:
            raise UserError("That Stripe key isn't allowed to do this - give it write access to Prices and Payment Links and read access to Checkout Sessions.")
        raise UserError("Stripe: " + (msg[:200] or "error %d" % e.code))
    except (urllib.error.URLError, socket.timeout, OSError):
        raise UserError("Couldn't reach Stripe - check the internet connection.")


def aco_stripe_test(req):
    key = _aco_key(req)
    j = _aco_stripe(key, "GET", "/v1/payment_links", {"limit": 1})
    acct = ""
    try:
        a = _aco_stripe(key, "GET", "/v1/account")
        acct = (a.get("settings") or {}).get("dashboard", {}).get("display_name") or a.get("business_profile", {}).get("name") or ""
    except UserError:
        pass
    return {"ok": True, "account": acct, "live": key.split("_")[1] == "live", "links": len(j.get("data") or [])}


def aco_stripe_link(req):
    key = _aco_key(req)
    amount = int(req.get("amount") or 0)
    if amount < 50 or amount > 5000000:
        raise UserError("Card payments need an amount between $0.50 and $50,000.")
    name = str(req.get("name") or "Invoice")[:120]
    inv = str(req.get("invoice") or "")[:40]
    price = _aco_stripe(key, "POST", "/v1/prices", {"currency": "usd", "unit_amount": amount, "product_data": {"name": name}})
    link = _aco_stripe(key, "POST", "/v1/payment_links", {"line_items": [{"price": price["id"], "quantity": 1}], "metadata": {"crown_invoice": inv, "client": str(req.get("client") or "")[:80]},
                                                           "payment_intent_data": {"description": name}, "after_completion": {"type": "hosted_confirmation", "hosted_confirmation": {"custom_message": "Thanks! Your payment for %s went through." % (inv or "the invoice")}}})
    return {"ok": True, "id": link.get("id"), "url": link.get("url")}


def aco_stripe_check(req):
    key = _aco_key(req)
    link = str(req.get("link") or "")
    if not re.fullmatch(r"plink_[A-Za-z0-9]{3,120}", link):
        raise UserError("No card payment link on this invoice.")
    j = _aco_stripe(key, "GET", "/v1/checkout/sessions", {"payment_link": link, "limit": 10})
    paid = [x for x in (j.get("data") or []) if x.get("payment_status") == "paid" or x.get("status") == "complete"]
    if not paid:
        return {"ok": True, "paid": False}
    when = max(int(x.get("created") or 0) for x in paid)
    try:
        _aco_stripe(key, "POST", "/v1/payment_links/" + link, {"active": False})  # so it can't be paid twice
    except UserError:
        pass
    return {"ok": True, "paid": True, "paidAt": datetime.datetime.fromtimestamp(when, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if when else ""}


# ---- 17TRACK: tracks any package by its number (also ones shipped to you), for UPS, FedEx, USPS, OnTrac, LaserShip,
# DHL and 3,000+ more. Each package is registered once (that uses one unit of your 17TRACK quota); 17TRACK then keeps
# following it and Kingpin reads the latest. Your Security Key is sent with each request and never stored here.
S17_BASE = os.environ.get("CROWN_17TRACK_URL", "https://api.17track.net/track/v2.2")
S17_CARRIER = {"ups": 100002, "fedex": 100003, "usps": 21051}
S17_STATUS = {"InfoReceived": "pre_transit", "InTransit": "in_transit", "OutForDelivery": "out_for_delivery", "Delivered": "delivered",
              "AvailableForPickup": "exception", "DeliveryFailure": "exception", "Exception": "exception", "Expired": "exception"}
S17_WHY = {"AvailableForPickup": "Waiting at a pickup point", "Expired": "The carrier hasn't updated it in a long time", "DeliveryFailure": "Delivery attempt failed"}


def _s17(key, path, body):
    for attempt in range(3):
        req = urllib.request.Request(S17_BASE + path, data=json.dumps(body).encode(), method="POST",
                                     headers={"17token": key, "Content-Type": "application/json", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30, context=ssl_context()) as r:
                j = json.loads(r.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 2:  # 17TRACK allows 3 requests a second
                time.sleep(1.2)
                continue
            if e.code == 429:
                raise UserError("17TRACK is busy — too many checks right now. Kingpin will try again later.")
            if e.code in (401, 403):
                raise UserError("17TRACK rejected the Security Key. Check it in Settings → Carrier tracking.")
            raise UserError("17TRACK error %s." % e.code)
        except urllib.error.URLError as e:
            raise UserError("Couldn't reach 17TRACK (%s)." % e.reason)
        code = j.get("code")
        if code not in (0, None):
            msg = str(j.get("message") or ((j.get("data") or {}).get("errors") or [{}])[0].get("message") or "")
            if re.search(r"token|security key|unauthori|access", msg, re.I):
                raise UserError("17TRACK rejected the Security Key. Check it in Settings → Carrier tracking.")
            raise UserError("17TRACK: %s" % (msg or "error %s" % code))
        return j.get("data") or {}
    raise UserError("17TRACK is busy right now.")


def _s17_err(code, msg):
    code = int(code or 0)
    if code == -18019908:
        return "Your 17TRACK quota is used up. Add more at 17track.net (about 2¢ a package)."
    if code == -18019907:
        return "17TRACK's daily limit is reached. Kingpin will try again tomorrow."
    if code == -18019903:
        return "17TRACK couldn't tell which carrier this is."
    if code in (-18010012, -18010013):
        return "17TRACK says this isn't a valid tracking number."
    return "17TRACK: %s" % (msg or "couldn't track this number")


def _s17_place(a):
    a = a or {}
    return _place(a.get("city"), a.get("state"))


def _s17_parse(code, kind, ti):
    ls = ti.get("latest_status") or {}
    main = str(ls.get("status") or "")
    provs = ((ti.get("tracking") or {}).get("providers") or [])
    prov = provs[0] if provs else {}
    evs_raw = []
    for p in provs:
        evs_raw.extend(p.get("events") or [])
    evs_raw.sort(key=lambda e: str(e.get("time_utc") or e.get("time_iso") or ""))
    events, deliv = [], ""
    for e in evs_raw[-TRACK_EVENTS:]:
        sub = str(e.get("sub_status") or e.get("stage") or "")
        when = e.get("time_iso") or e.get("time_utc") or ""
        if sub.startswith("Delivered"):
            deliv = _ymd(when)
        events.append({"date": when, "message": str(e.get("description") or "").strip(), "status": "",
                       "x": sub.startswith(("DeliveryFailure", "Exception")),
                       "location": _s17_place(e.get("address")) or str(e.get("location") or "").strip()})
    if main == "NotFound" or not main:
        return {"ok": True, "status": "unknown", "pending": True, "carrier": CARRIER_NAMES.get(kind, ""), "est": "", "deliveredOn": "",
                "statusText": "17TRACK is still looking this up at the carrier", "events": events, "publicUrl": "", "source": "17track"}
    status = S17_STATUS.get(main, "in_transit")
    le = ti.get("latest_event") or {}
    text = str(le.get("description") or "").strip() or main
    ed = ((ti.get("time_metrics") or {}).get("estimated_delivery_date") or {})
    est = "" if status == "delivered" else _ymd(ed.get("to") or ed.get("from"))
    window = ["", ""]
    if ed.get("from") and ed.get("to") and _ymd(ed["from"]) == _ymd(ed["to"]) and "T" in str(ed["from"]):
        window = [ed["from"], ed["to"]]
    misc = ti.get("misc_info") or {}
    wm = re.match(r"\s*([\d.]+)\s*([A-Za-z]+)", str(misc.get("weight_raw") or ""))
    weight = _weight(wm.group(1), wm.group(2)) if wm else (_weight(misc.get("weight_kg"), "kg") if misc.get("weight_kg") else "")
    si = ti.get("shipping_info") or {}
    left = ""
    if status == "delivered":
        m = re.search(r"(?:delivered,?\s*(?:to\s+|at\s+)?|left at\s+)([A-Za-z/ ]{3,40})$", text, re.I)
        if m and not re.fullmatch(r"\s*(delivered|package|individual)\s*", m.group(1), re.I):
            left = m.group(1).strip()
    cname = str((prov.get("provider") or {}).get("name") or "").strip() or CARRIER_NAMES.get(kind, "")
    pub = {"ups": "https://www.ups.com/track?loc=en_US&tracknum=", "fedex": "https://www.fedex.com/fedextrack/?trknbr=",
           "usps": "https://tools.usps.com/go/TrackConfirmAction?tLabels="}.get(kind)
    out = {"status": status, "carrier": cname, "est": est, "deliveredOn": deliv or (_ymd(le.get("time_iso")) if status == "delivered" else ""),
           "window": window, "statusText": text, "service": str(misc.get("service_type") or prov.get("service_type") or "").strip(), "weight": weight,
           "from": _s17_place(si.get("shipper_address")), "to": _s17_place(si.get("recipient_address")), "leftAt": left,
           "problem": (S17_WHY.get(main, "") + (": " if S17_WHY.get(main) and text else "") + text) if status == "exception" else "",
           "publicUrl": (pub + code) if pub else "https://t.17track.net/en#nums=" + urllib.parse.quote(code), "source": "17track"}
    return _finish(out, events)


def s17_lookup(key, items):
    """items: [{"number", "kind"}] -> {number: result or {"ok": False, "error": message}}. Registers numbers 17TRACK doesn't know yet."""
    key = str(key or "").strip()
    if not key:
        raise UserError("Add your 17TRACK Security Key in Settings → Carrier tracking first.")
    out, kinds = {}, {}
    for it in items[:200]:
        n = re.sub(r"\s+", "", str(it.get("number") or "")).upper()
        if n:
            kinds[n] = str(it.get("kind") or "other")
    nums = list(kinds)
    body = lambda ns: [dict({"number": n}, **({"carrier": S17_CARRIER[kinds[n]]} if kinds[n] in S17_CARRIER else {})) for n in ns]
    unreg = []
    for i in range(0, len(nums), 40):
        d = _s17(key, "/gettrackinfo", body(nums[i:i + 40]))
        for a in d.get("accepted") or []:
            n = str(a.get("number") or "").upper()
            if n in kinds:
                out[n] = _s17_parse(n, kinds[n], a.get("track_info") or {})
        for r in d.get("rejected") or []:
            n, e = str(r.get("number") or "").upper(), r.get("error") or {}
            if n not in kinds:
                continue
            if int(e.get("code") or 0) == -18019902:  # not registered yet
                unreg.append(n)
            else:
                out[n] = {"ok": False, "error": _s17_err(e.get("code"), e.get("message"))}
    registered = 0
    for i in range(0, len(unreg), 40):
        d = _s17(key, "/register", body(unreg[i:i + 40]))
        for a in d.get("accepted") or []:
            n = str(a.get("number") or "").upper()
            if n in kinds:
                registered += 1
                out[n] = {"ok": True, "status": "unknown", "pending": True, "carrier": CARRIER_NAMES.get(kinds[n], ""), "est": "", "deliveredOn": "",
                          "statusText": "Added to 17TRACK — the first scans show up in a few minutes", "events": [], "publicUrl": "", "source": "17track"}
        for r in d.get("rejected") or []:
            n, e = str(r.get("number") or "").upper(), r.get("error") or {}
            if n not in kinds:
                continue
            if int(e.get("code") or 0) == -18019901:  # registered meanwhile
                out[n] = {"ok": True, "status": "unknown", "pending": True, "carrier": CARRIER_NAMES.get(kinds[n], ""), "est": "", "deliveredOn": "",
                          "statusText": "17TRACK is still looking this up at the carrier", "events": [], "publicUrl": "", "source": "17track"}
            else:
                out[n] = {"ok": False, "error": _s17_err(e.get("code"), e.get("message"))}
    for n in nums:
        out.setdefault(n, {"ok": False, "error": "17TRACK didn't return anything for this number."})
    res = {"ok": True, "results": out}
    if registered:
        try:
            q = _s17(key, "/getquota", [])
            res["quotaLeft"] = q.get("quota_remain")
        except UserError:
            pass
    return res


def track17(req):
    items = req.get("items") or []
    if not isinstance(items, list) or not items:
        raise UserError("No tracking numbers.")
    return s17_lookup(req.get("key"), items)


def s17_test(req):
    key = str(req.get("key") or "").strip()
    if not key:
        raise UserError("Paste your 17TRACK Security Key.")
    q = _s17(key, "/getquota", [])
    return {"ok": True, "quotaLeft": q.get("quota_remain"), "quotaTotal": q.get("quota_total")}


def free_track(code, carrier):
    carrier = (carrier or "").upper()
    if carrier == "UPS" or code.upper().startswith("1Z"):
        return ups_track(code)
    raise UserError("Live tracking for %s needs an EasyPost key (Settings)." % (carrier or "this carrier"))


def track(req):
    """Live tracking. Order: the carrier's official API (free developer keys) -> 17TRACK -> EasyPost -> UPS's website."""
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
    if str(req.get("s17Key") or "").strip():
        kind = "ups" if is_ups else "usps" if is_usps else "fedex" if is_fedex else "other"
        r = s17_lookup(req["s17Key"], [{"number": code0, "kind": kind}])
        one = r["results"].get(code0) or {}
        if not one.get("ok"):
            raise UserError(one.get("error") or "17TRACK couldn't track this number.")
        if r.get("quotaLeft") is not None:
            one["quotaLeft"] = r["quotaLeft"]
        return one
    if not key:
        if is_ups:
            try:
                return ups_track(code0)
            except UserError:
                raise
            except Exception:
                raise UserError("Add a 17TRACK key in Settings → Carrier tracking to track UPS packages.")
        raise UserError("Add a 17TRACK key in Settings → Carrier tracking to track %s packages." % ("FedEx" if is_fedex else "USPS" if is_usps else "these"))
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
        if e.code == 429:
            raise UserError("EasyPost is busy — too many checks this hour. Kingpin will try again later.")
        raise UserError("EasyPost error %s%s" % (e.code, (": " + detail) if detail else ""))
    except urllib.error.URLError as e:
        raise UserError("Couldn't reach EasyPost (%s)." % e.reason)
    events = []
    for ev in (j.get("tracking_details") or [])[-TRACK_EVENTS:]:
        loc = ev.get("tracking_location") or {}
        events.append({"date": ev.get("datetime"), "message": ev.get("message") or "", "status": ev.get("status") or "",
                       "x": ev.get("status") in ("failure", "error", "return_to_sender"), "location": _place(loc.get("city"), loc.get("state"))})
    epst = j.get("status") or "unknown"
    status = "exception" if epst in ("failure", "error", "return_to_sender", "available_for_pickup", "cancelled") else epst
    cd = j.get("carrier_detail") or {}
    ol, dl = cd.get("origin_tracking_location") or {}, cd.get("destination_tracking_location") or {}
    last = (j.get("tracking_details") or [{}])[-1] or {}
    out = {"status": status, "carrier": j.get("carrier") or "", "est": "" if status == "delivered" else _ymd(j.get("est_delivery_date")),
           "deliveredOn": _ymd(last.get("datetime")) if status == "delivered" else "", "statusText": last.get("message") or "",
           "service": str(cd.get("service") or "").strip(), "weight": _weight(j.get("weight"), "oz"),
           "from": _place(ol.get("city"), ol.get("state")), "to": _place(dl.get("city"), dl.get("state")),
           "signedBy": str(j.get("signed_by") or "").strip(), "problem": (last.get("message") or epst.replace("_", " ")) if status == "exception" else "",
           "publicUrl": j.get("public_url") or "", "source": "easypost"}
    return _finish(out, events)


# ---------------------------------------------------------------- HTTP

TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json",
         ".wasm": "application/wasm", ".traineddata": "application/octet-stream", ".txt": "text/plain; charset=utf-8"}


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
        if path in ("/api/stockx/login", "/api/stockx/callback"):
            return self._stockx_nav(path)
        if path.startswith("/api/"):
            if not self._api_guard():
                return
            if path == "/api/ping":
                return self._run(lambda: {"ok": True, "version": VERSION, "dataDir": DATA_DIR})
            if path == "/api/vault":
                return self._run(lambda: {"ok": True, "vault": read_vault()})
            if path == "/api/backups":
                return self._run(lambda: {"ok": True, "backups": list_backups()})
            if path == "/api/update":
                return self._run(lambda: dict(update_status(), ok=True))
            if path.startswith("/api/backups/"):
                name = path[len("/api/backups/"):]
                return self._run(lambda: {"ok": True, "vault": read_backup(name)})
            return self._send(404, {"ok": False, "error": "Not found"})
        if not self._host_ok():
            return self._send(403, "Forbidden", "text/plain")
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        root = SERVE_DIR
        full = os.path.realpath(os.path.join(root, rel))
        if not full.startswith(os.path.realpath(root) + os.sep) or not os.path.isfile(full):
            return self._send(404, "Not found", "text/plain")
        with open(full, "rb") as f:
            data = f.read()
        self._send(200, data, TYPES.get(os.path.splitext(full)[1].lower(), "application/octet-stream"))

    def _stockx_nav(self, path):
        if not self._host_ok():
            return self._send(403, "Forbidden", "text/plain")
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        redirect = "http://%s/api/stockx/callback" % (self.headers.get("Host") or "%s:%d" % (HOST, PORT))
        try:
            if path.endswith("/login"):
                url = stockx_login_url(redirect, (q.get("state") or [""])[0][:80])
                self.send_response(302)
                self.send_header("Location", url)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return
            if q.get("error"):
                raise UserError("StockX sign-in was cancelled.")
            tok = stockx_exchange((q.get("code") or [""])[0], redirect)
            page = stockx_done_page({"auth": tok, "state": (q.get("state") or [""])[0]})
        except UserError as e:
            page = stockx_done_page({"error": str(e)})
        self._send(200, page.encode(), "text/html; charset=utf-8")

    def do_PUT(self):
        if not self._api_guard():
            return
        if self.path == "/api/vault":
            # screens from before this engine (an old tab) mustn't overwrite newer data; the ones it's serving (maybe a
            # newer self-updated set) are fine
            if self.headers.get("X-Crown-App") not in (VERSION, UPD.get("active")):
                return self._send(200, {"ok": False, "outdated": True, "error": "Kingpin was updated. Reload this tab to keep going."})

            def fn():
                write_vault(self._json())
                return {"ok": True, "savedAt": time.time()}
            return self._run(fn)
        self._send(404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        if not self._api_guard():
            return
        if self.path == "/api/update/check":
            return self._run(lambda: dict(check_update(), ok=True, **{k: v for k, v in update_status().items() if k not in UPD}))
        if self.path == "/api/update/apply":
            return self._run(lambda: {"ok": True, "active": use_newest_screens()})
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
            "/api/track17": track17,
            "/api/skuinfo": sku_info,
            "/api/news": news_fetch,
            "/api/news/status": news_status,
            "/api/pk/catalog": pk_catalog,
            "/api/s17test": s17_test,
            "/api/discord": discord_send,
            "/api/discord/check": discord_check,
            "/api/img": image_fetch,
            "/api/discord/read": discord_read,
            "/api/upc": upc_lookup,
            "/api/market/categories": market_categories,
            "/api/market/groups": market_groups,
            "/api/market/search": market_search,
            "/api/market/prices": market_prices,
            "/api/stockx/status": stockx_status,
            "/api/stockx/search": stockx_search,
            "/api/stockx/prices": stockx_prices,
            "/api/aco/stripe/test": aco_stripe_test,
            "/api/aco/stripe/link": aco_stripe_link,
            "/api/aco/stripe/check": aco_stripe_check,
        }
        fn = routes.get(self.path)
        if not fn:
            return self._send(404, {"ok": False, "error": "Not found"})
        self._run(lambda: fn(self._json()))


def port_free(port):
    """Nothing is listening here (checked by trying to take the port, which is instant - asking a closed port over
    HTTP takes ~2 seconds on Windows, and checking 12 ports that way made Kingpin slow to open)."""
    sk = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            sk.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        sk.bind((HOST, port))
        return True
    except OSError:
        return False
    finally:
        sk.close()


def running_version(port):
    """Version of a Kingpin already running on this port ("" if it's an old one that doesn't say), or None."""
    if port_free(port):
        return None
    try:
        req = urllib.request.Request("http://%s:%d/api/ping" % (HOST, port), headers={"X-Crown": "1"})
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(req, timeout=2) as r:
            j = json.loads(r.read().decode())
            return str(j.get("version") or "") if j.get("ok") else None
    except Exception:
        return None


def stop_old_crown(port):
    """Close an older Kingpin that's still running, so the new version can take over."""
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



# ---------------------------------------------------------------- updates
# The screens (everything in app/) update themselves: Kingpin downloads the newest set from the website into the data
# folder, checks every file against the website's list of fingerprints, and shows it from the next start (or right
# away when you say so). This part - the engine - only changes with a new download, so a set of screens is only used
# when everything it can ask the engine for is here (the engine's /api routes, and ENGINE for changes in how they work).
ENGINE = 1  # bump when the screens need an existing /api route to work differently
UPDATE_BASE = (os.environ.get("CROWN_UPDATE_URL") or "https://crowntools.vercel.app/").rstrip("/") + "/"
UPDATE_DIR = os.path.join(DATA_DIR, "app-updates")
RELEASES_URL = "https://github.com/caulenmomo-star/Crown-app/releases/latest"
UPD = {"state": "idle", "checked": 0, "latest": "", "ready": "", "error": "", "needsDownload": "", "active": VERSION}
_upd_lock = threading.Lock()


def engine_routes(src=None):
    """The /api routes this engine answers (read from its own code, so it can't drift)."""
    if src is None:
        try:
            with open(os.path.abspath(__file__), encoding="utf-8") as f:
                src = f.read()
        except Exception:
            return set()
    return set(re.findall(r'"(/api/[a-z0-9/_\-]+)"', src))


_MY_ROUTES = None


def _vt(v):
    return tuple(int(x) for x in re.findall(r"\d+", str(v or ""))[:4]) or (0,)


def _fits_engine(m):
    global _MY_ROUTES
    if _MY_ROUTES is None:
        _MY_ROUTES = engine_routes()
    try:
        need = int(m.get("engine", 1))
    except Exception:
        return False
    return need <= ENGINE and set(m.get("routes") or []) <= _MY_ROUTES


def _sha_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _upd_valid(d):
    """A finished download (its list is written last) that this engine can run, with every file present."""
    try:
        with open(os.path.join(d, "app-manifest.json"), encoding="utf-8") as f:
            m = json.load(f)
    except Exception:
        return None
    if not isinstance(m.get("files"), dict) or not _fits_engine(m):
        return None
    for rel in m["files"]:
        if not os.path.isfile(os.path.join(d, *rel.split("/"))):
            return None
    return m


def newest_update():
    best = None
    try:
        names = os.listdir(UPDATE_DIR)
    except Exception:
        return None
    for n in names:
        if n.startswith("."):
            continue
        d = os.path.join(UPDATE_DIR, n)
        m = _upd_valid(d)
        if m and _vt(m.get("version")) > _vt(VERSION) and (best is None or _vt(m["version"]) > _vt(best[1]["version"])):
            best = (d, m)
    return best


def use_newest_screens():
    """Show the newest downloaded screens (from the next page load)."""
    global SERVE_DIR
    b = newest_update()
    SERVE_DIR = b[0] if b else APP_DIR
    UPD["active"] = b[1]["version"] if b else VERSION
    if UPD["ready"] and _vt(UPD["ready"]) <= _vt(UPD["active"]):
        UPD["ready"] = ""
    return UPD["active"]


def _upd_get(url, timeout=30):
    rq = urllib.request.Request(url, headers={"User-Agent": "Kingpin/%s" % VERSION, "Cache-Control": "no-cache"})
    with urllib.request.urlopen(rq, timeout=timeout, context=ssl_context()) as r:
        return r.read()


_SAFE_REL = re.compile(r"[A-Za-z0-9_\-][A-Za-z0-9_.\-]*(/[A-Za-z0-9_\-][A-Za-z0-9_.\-]*)*")


def check_update():
    """Look for newer screens on the website and download them (only files that changed)."""
    if os.environ.get("CROWN_NO_UPDATE"):
        UPD["state"] = "off"
        return dict(UPD)
    if not _upd_lock.acquire(blocking=False):
        return dict(UPD)
    stage = None
    try:
        UPD.update(state="checking", error="")
        m = json.loads(_upd_get(UPDATE_BASE + "app-manifest.json?t=%d" % int(time.time()), 20).decode("utf-8"))
        ver, files = str(m.get("version") or ""), m.get("files")
        if not ver or not isinstance(files, dict) or not files:
            raise ValueError("the website's update list looks wrong")
        UPD["latest"] = ver
        have = max(_vt(UPD["active"]), _vt(UPD["ready"]))
        if _vt(ver) <= have:
            UPD.update(state="current", needsDownload="")
            return dict(UPD)
        if not _fits_engine(m):
            UPD.update(state="download", needsDownload=ver)
            return dict(UPD)
        target = os.path.join(UPDATE_DIR, ver)
        if not _upd_valid(target):
            stage = os.path.join(UPDATE_DIR, ".dl-" + ver)
            shutil.rmtree(stage, ignore_errors=True)
            os.makedirs(stage, exist_ok=True)
            UPD["state"] = "downloading"
            for rel, info in files.items():
                want = str((info or {}).get("sha256") or "")
                if not _SAFE_REL.fullmatch(rel) or ".." in rel.split("/") or len(want) != 64:
                    raise ValueError("unexpected file in the update: %s" % rel[:80])
                dst = os.path.join(stage, *rel.split("/"))
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                src = None
                for base in (SERVE_DIR, APP_DIR):  # an identical file we already have doesn't need downloading
                    p = os.path.join(base, *rel.split("/"))
                    if os.path.isfile(p) and _sha_file(p) == want:
                        src = p
                        break
                if src:
                    shutil.copyfile(src, dst)
                    continue
                data = _upd_get(UPDATE_BASE + urllib.parse.quote(rel) + "?v=" + urllib.parse.quote(ver), 60)
                if hashlib.sha256(data).hexdigest() != want:
                    raise ValueError("%s didn't download correctly - will try again later" % rel)
                with open(dst, "wb") as f:
                    f.write(data)
            with open(os.path.join(stage, "app-manifest.json"), "w", encoding="utf-8") as f:
                json.dump(m, f)
            shutil.rmtree(target, ignore_errors=True)
            for i in range(8):  # Windows virus scanning can hold new files for a moment
                try:
                    os.replace(stage, target)
                    break
                except OSError:
                    if i == 7:
                        raise
                    time.sleep(1 + i)
            stage = None
        UPD.update(state="ready", ready=ver, needsDownload="")
        # keep only the set being shown and the new one
        keep = {os.path.basename(target), os.path.basename(SERVE_DIR)}
        for n in os.listdir(UPDATE_DIR):
            if n not in keep:
                shutil.rmtree(os.path.join(UPDATE_DIR, n), ignore_errors=True)
    except Exception as e:
        UPD.update(state="error", error=str(e)[:200])
    finally:
        if stage:
            shutil.rmtree(stage, ignore_errors=True)
        UPD["checked"] = time.time()
        _upd_lock.release()
    return dict(UPD)


def update_status():
    return dict(UPD, engine=ENGINE, bundled=VERSION, releases=RELEASES_URL, auto=not os.environ.get("CROWN_NO_UPDATE"))


def update_loop():
    time.sleep(2)
    while True:
        r = check_update()
        # couldn't reach the website (asleep, offline, starting up): try again soon instead of in 6 hours
        time.sleep(600 if r.get("state") == "error" else 6 * 3600)


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
            os.system("title Kingpin")
        except Exception:
            pass
    os.makedirs(BACKUP_DIR, exist_ok=True)
    httpd = None
    for port in range(BASE_PORT, BASE_PORT + 12):  # an old Kingpin may still be running from the previous version
        v = running_version(port)
        if v is not None and v != VERSION:
            print("Closing the older Kingpin (%s) that's still running..." % (v or "1.x"))
            stop_old_crown(port)
    moved = import_old_data()
    if moved:
        print("  Brought your data over from %s" % moved)
    for port in range(BASE_PORT, BASE_PORT + 12):
        v = running_version(port)
        if v is not None and v != VERSION:
            print("Closing the older Kingpin (%s) that's still running..." % (v or "1.x"))
            stop_old_crown(port)
        if already_running(port):
            url = "http://%s:%d/" % (HOST, port)
            print("Kingpin is already running - opening %s" % url)
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
    use_newest_screens()
    threading.Thread(target=update_loop, daemon=True).start()
    url = "http://%s:%d/" % (HOST, PORT)
    print("")
    print("  Kingpin %s is running at %s" % (UPD["active"], url))
    print("  Your data folder: %s" % DATA_DIR)
    print("  Keep this window open while you use Kingpin. Close it (or press Ctrl+C) to stop.")
    print("")
    if not os.environ.get("CROWN_NO_BROWSER"):
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nKingpin stopped.")



# =====================================================================
# Kingpin Online - Vercel serverless handler (appended to server.py at build time).
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
                    "requireVerify": True, "announcement": "", "productName": "Kingpin"}
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


class NeedCode(Exception):
    """Two-step sign-in is on and this device hasn't been approved with a code yet."""
    pass


class NoAccess(Exception):
    def __init__(self, status):
        Exception.__init__(self, "no access")
        self.status = status


def kv(*cmd):
    if not KV_URL or not KV_TOKEN:
        raise UserError("Kingpin Online's storage isn't connected yet.")
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


def pk_shared(fresh=False, cron=False):
    """One copy of the Pokémon product list for everyone, re-read from Target's sitemap at most about once a day."""
    cur = kv_json("pk:catalog")
    age = time.time() - (cur["at"] / 1000.0) if cur else 1e9
    want = age > PK_MAX_AGE or (fresh and age > 1800) or (cron and age > 6 * 3600)
    if want and kv("SET", "pk:lock", "1", "NX", "EX", "290"):
        try:
            cur = pk_scan_target(cur)
            kv_set_json("pk:catalog", cur)
        finally:
            kv("DEL", "pk:lock")
    elif not cur:
        raise UserError("The product list is being put together right now. Try again in a minute.")
    return dict(cur, ok=True)


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
    """Can this account use Kingpin right now? Returns (allowed, reason)."""
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
            "billingReady": billing_ready(), "mailReady": mail_ready(), "announcement": s.get("announcement") or "",
            "tfa": tfa_on(u), "recoveryLeft": len((u.get("tfa") or {}).get("recovery") or []), "devices": len(u.get("devices") or {})}


def client_ip(headers):
    return (headers.get("X-Forwarded-For") or headers.get("X-Real-Ip") or "").split(",")[0].strip() or "?"


# ---------------------------------------------------------------- two-step sign-in (authenticator app)
# With it on, the password alone isn't enough: each new phone / computer / browser also needs a 6-digit code from an
# authenticator app (or a one-time recovery code) once. That device is then remembered until it's removed in Settings
# or goes 60 days without being used.
DEVICE_IDLE_DAYS = 60
MAX_DEVICES = 25


def _dev_id(tok):
    return sha("dev:" + str(tok or ""))[:32]


def tfa_on(u):
    return bool((u.get("tfa") or {}).get("on"))


def device_of(u, headers):
    tok = headers.get("X-Crown-Device") or ""
    if not tok:
        return None
    did = _dev_id(tok)
    d = (u.get("devices") or {}).get(did)
    if not d or float(d.get("lastSeen") or d.get("at") or 0) < now() - DEVICE_IDLE_DAYS * DAY:
        return None
    return did


def _recovery_codes():
    codes = ["%s-%s" % (_secrets.token_hex(2), _secrets.token_hex(2)) for _ in range(8)]
    return codes, [sha("rc:" + c) for c in codes]


def tfa_check(u, code):
    """A current authenticator code, or an unused recovery code (used up). Counts wrong tries."""
    t = u.get("tfa") or {}
    rate_limit("tfa", u["id"], 10, 900)
    raw = str(code or "").strip().lower()
    if re.fullmatch(r"[0-9a-f]{4}-?[0-9a-f]{4}", raw):
        h_ = sha("rc:" + raw[:4] + "-" + raw[-4:])
        if h_ in (t.get("recovery") or []):
            t["recovery"] = [x for x in t["recovery"] if x != h_]
            u["tfa"] = t
            clear_limit("tfa", u["id"])
            return "recovery"
    step = totp_ok(t.get("secret") or "", raw, t.get("lastStep"))
    if step:
        t["lastStep"] = step
        u["tfa"] = t
        clear_limit("tfa", u["id"])  # a right code resets the wrong-tries count
        return "code"
    time.sleep(0.4)
    raise UserError("That code didn’t work. Use the newest 6-digit code from your authenticator app.")


def add_device(u, name, headers):
    tok = _secrets.token_urlsafe(32)
    devs = u.get("devices") or {}
    devs[_dev_id(tok)] = {"name": str(name or "A device")[:60], "at": now(), "lastSeen": now(), "ip": client_ip(headers)[:64]}
    if len(devs) > MAX_DEVICES:
        for k in sorted(devs, key=lambda k: devs[k].get("lastSeen") or 0)[:len(devs) - MAX_DEVICES]:
            devs.pop(k, None)
    u["devices"] = devs
    return tok


def require_user(headers, need_access=True, need_device=True):
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
    if need_device and tfa_on(u):
        did = device_of(u, headers)
        if not did:
            raise NeedCode()
        d = u["devices"][did]
        if now() - float(d.get("lastSeen") or 0) > 6 * 3600:
            d["lastSeen"] = now()
            put_user(u)
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
        raise UserError("That doesn't look like a Kingpin vault.")
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
    msg["From"] = "%s <%s>" % (settings().get("productName") or "Kingpin", MAIL_FROM)
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
    return send_mail(u["email"], "Confirm your Kingpin email",
                     "Confirm your email for Kingpin by opening this link:\n\n%s\n\nThe link works for 3 days." % url,
                     mail_html("Confirm your email", "Tap the button to confirm the email address for your Kingpin account.", "Confirm email", url))


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
        prod = stripe("POST", "/v1/products", {"name": s.get("productName") or "Kingpin", "metadata": {"app": "crowntools"}})["id"]
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
            "tfa": tfa_on(u), "devices": len(u.get("devices") or {}),
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
            self._send(200, {"ok": False, "conflict": True, "rev": c.rev, "error": "Kingpin was changed on another device."})
        except TooMany:
            self._send(200, {"ok": False, "error": "Too many tries. Wait 15 minutes and try again."})
        except NeedCode:
            self._send(200, {"ok": False, "needCode": True, "error": "Enter the 6-digit code from your authenticator app to sign in on this device."})
        except NoAccess as e:
            self._send(200, {"ok": False, "noAccess": True, "reason": e.status, "error": "Your Kingpin subscription isn't active."})
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
        if r in ("/pk/catalog", "/pk/cron"):  # the shared Pokémon product list (public; read by the app and the Mac/PC app)
            def pkcat():
                q = self._query()
                if r == "/pk/cron" and "vercel-cron" not in (h.get("User-Agent") or "").lower():
                    rate_limit("pkcron", client_ip(h), 4, 3600)
                elif r == "/pk/catalog":
                    rate_limit("pkcat", client_ip(h), 120, 3600)
                return pk_shared(bool(q.get("fresh")), r == "/pk/cron")
            return self._run(pkcat)
        if r == "/news/status":  # public health check of the news feeds (rate-limited)
            def nstatus():
                rate_limit("nstat", client_ip(h), 20, 3600)
                return news_status()
            return self._run(nstatus)
        if r in ("/stockx/login", "/stockx/callback"):  # browser sign-in with StockX (no app headers on these)
            q = self._query()
            redirect = app_url(h).rstrip("/") + "/api/stockx/callback"
            try:
                if r == "/stockx/login":
                    rate_limit("sxl", client_ip(h), 30, 3600)
                    url = stockx_login_url(redirect, (q.get("state") or "")[:80])
                    self.send_response(302)
                    self.send_header("Location", url)
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    return
                if q.get("error"):
                    raise UserError("StockX sign-in was cancelled.")
                page = stockx_done_page({"auth": stockx_exchange(q.get("code") or "", redirect), "state": q.get("state") or ""})
            except (UserError, TooMany) as e:
                page = stockx_done_page({"error": str(e) or "Too many tries. Wait a bit and try again."})
            body = page.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
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
            return self._send(200, {"ok": False, "outdated": True, "error": "Kingpin was updated. Reload this page to keep going."})
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

        if r == "/auth/device":  # approve this device with a code (only needed when two-step sign-in is on)
            def approve():
                b = self._body()
                u = require_user(h, need_access=False, need_device=False)
                if not tfa_on(u):
                    return {"ok": True, "token": ""}
                how = tfa_check(u, b.get("code"))
                tok = add_device(u, b.get("name"), h)
                put_user(u)
                audit(u["email"], "approved a device", u["id"], detail=("%s · %s" % (str(b.get("name") or "")[:60], client_ip(h)[:64])) + (" · recovery code" if how == "recovery" else ""))
                try:
                    send_mail(u["email"], "Kingpin: a new device signed in",
                              "Your Kingpin account was just opened on a new device: %s.\n\nIf that wasn't you or someone you trust, change your password right away and remove the device in Settings → Security." % (str(b.get("name") or "A device")[:60]))
                except Exception:
                    pass
                return {"ok": True, "token": tok, "recoveryLeft": len(u["tfa"].get("recovery") or []), "usedRecovery": how == "recovery"}
            return self._run(approve)
        if r == "/auth/tfa/start":
            def start():
                u = require_user(h, need_access=False)
                if tfa_on(u):
                    raise UserError("Two-step sign-in is already on.")
                t = u.get("tfa") or {}
                t["pending"] = b32secret()
                u["tfa"] = t
                put_user(u)
                return {"ok": True, "secret": t["pending"], "uri": "otpauth://totp/Kingpin:%s?secret=%s&issuer=Kingpin" % (_urlencode({"": u["email"]})[1:], t["pending"])}
            return self._run(start)
        if r == "/auth/tfa/enable":
            def enable():
                b = self._body()
                u = require_user(h, need_access=False)
                t = u.get("tfa") or {}
                if tfa_on(u) or not t.get("pending"):
                    raise UserError("Start setting it up again.")
                rate_limit("tfa", u["id"], 10, 900)
                step = totp_ok(t["pending"], b.get("code"))
                if not step:
                    raise UserError("That code didn’t work. Check your phone’s time is set automatically, and use the newest code.")
                clear_limit("tfa", u["id"])
                codes, hashes = _recovery_codes()
                u["tfa"] = {"on": True, "secret": t["pending"], "lastStep": step, "recovery": hashes, "since": now()}
                u["devices"] = {}
                tok = add_device(u, b.get("name"), h)
                put_user(u)
                audit(u["email"], "turned on two-step sign-in", u["id"])
                return {"ok": True, "token": tok, "recovery": codes}
            return self._run(enable)
        if r == "/auth/tfa/disable":
            def disable():
                b = self._body()
                u = require_user(h, need_access=False)
                if not tfa_on(u):
                    return {"ok": True}
                tfa_check(u, b.get("code"))
                u.pop("tfa", None)
                u.pop("devices", None)
                put_user(u)
                audit(u["email"], "turned off two-step sign-in", u["id"])
                return {"ok": True}
            return self._run(disable)
        if r == "/auth/tfa/recovery":  # a fresh set of recovery codes (the old ones stop working)
            def recovery():
                b = self._body()
                u = require_user(h, need_access=False)
                if not tfa_on(u):
                    raise UserError("Turn on two-step sign-in first.")
                tfa_check(u, b.get("code"))
                codes, hashes = _recovery_codes()
                u["tfa"]["recovery"] = hashes
                put_user(u)
                audit(u["email"], "made new recovery codes", u["id"])
                return {"ok": True, "recovery": codes}
            return self._run(recovery)
        if r == "/auth/devices":
            def devices():
                b = self._body()
                u = require_user(h, need_access=False)
                me = device_of(u, h)
                devs = u.get("devices") or {}
                rm = str(b.get("remove") or "")
                if rm:
                    for k in list(devs):
                        if (rm == "others" and k != me) or k == rm:
                            devs.pop(k, None)
                    u["devices"] = devs
                    put_user(u)
                    audit(u["email"], "removed devices", u["id"], detail=rm[:40])
                return {"ok": True, "devices": sorted([{"id": k, "name": d.get("name") or "A device", "at": d.get("at"), "lastSeen": d.get("lastSeen"), "me": k == me}
                                                       for k, d in devs.items()], key=lambda x: (not x["me"], -(x["lastSeen"] or 0)))}
            return self._run(devices)
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
                        raise PermissionError("That isn't the password your earlier Kingpin data used.")
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
                    send_mail(email, "Reset your Kingpin password",
                              "Open this link to choose a new password:\n\n%s\n\nImportant: your saved data is locked with your old password, so a reset starts you with empty data. If you remember your old password later, you can restore a backup.\n\nThe link works for 1 hour." % url,
                              mail_html("Reset your password", "Choose a new password for Kingpin. Your saved data is locked with your old password, so a reset starts you with empty data (backups made with the old password can still be restored if you remember it).", "Choose a new password", url))
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
                u.pop("devices", None)  # every device signs in again (and still needs a code if two-step is on)
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
            "/track17": track17,
            "/skuinfo": sku_info,
            "/news": news_fetch,
            "/pk/catalog": lambda b: pk_shared(bool(b.get("fresh"))),
            "/s17test": s17_test,
            "/discord": discord_send,
            "/discord/check": discord_check,
            "/img": image_fetch,
            "/discord/read": discord_read,
            "/upc": upc_lookup,
            "/market/categories": market_categories,
            "/market/groups": market_groups,
            "/market/search": market_search,
            "/market/prices": market_prices,
            "/stockx/status": stockx_status,
            "/stockx/search": stockx_search,
            "/stockx/prices": stockx_prices,
            "/aco/stripe/test": aco_stripe_test,
            "/aco/stripe/link": aco_stripe_link,
            "/aco/stripe/check": aco_stripe_check,
        }
        fn = routes.get(r)
        if not fn:
            return self._send(404, {"ok": False, "error": "Not found"})

        def go():
            b = self._body()
            u = require_user(h)
            limits = {"/img": (1500, 3600), "/discord": (300, 3600), "/discord/check": (60, 3600), "/discord/read": (400, 3600), "/upc": (60, 3600), "/market/search": (150, 3600), "/market/prices": (60, 3600), "/stockx/search": (150, 3600), "/stockx/prices": (60, 3600), "/aco/stripe/test": (30, 3600), "/aco/stripe/link": (120, 3600), "/aco/stripe/check": (600, 3600)}
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
        m = re.fullmatch(r"/admin/user/([a-f0-9]{24})/(grant|revoke|suspend|unsuspend|verify|note|delete|resend|sync|tfaoff)", r)
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
                elif what == "tfaoff":  # lost their phone and recovery codes
                    u.pop("tfa", None)
                    u.pop("devices", None)
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
