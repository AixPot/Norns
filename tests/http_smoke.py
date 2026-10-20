"""Isolated release-binary HTTP smoke; no third-party dependencies or production data."""
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import time
import urllib.error
import urllib.request

root = Path(os.environ.get("NORNS_ROOT", Path(__file__).resolve().parents[1]))
evidence = Path(os.environ.get("EVIDENCE_ROOT", root / "target/http-evidence")) / f"http-{time.time_ns()}"
evidence.mkdir(parents=True, mode=0o700)
password = secrets.token_urlsafe(24)
(evidence / "synthetic-password").write_text(password)
(evidence / "synthetic-password").chmod(0o600)
base = "http://127.0.0.1:48732"
env = dict(os.environ, DATABASE_URL=f"sqlite://{evidence}/norns.sqlite", BIND_ADDR="127.0.0.1:48732", APP_ORIGIN=base, COOKIE_SECURE="false", STATIC_DIR=str(root / "frontend/dist"))
binary = str(root / "target/release/norns")
subprocess.run([binary, "init-admin", "admin"], input=password, text=True, env=env, cwd=evidence, check=True, capture_output=True)
jar = http.cookiejar.CookieJar()
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
csrf = ""
results = []
server = None

def start():
    global server
    with (evidence / "server.log").open("a") as log:
        server = subprocess.Popen([binary], env=env, cwd=evidence, stdout=log, stderr=log)
    for _ in range(100):
        try:
            if urllib.request.urlopen(base, timeout=1).status == 200:
                return
        except (OSError, urllib.error.URLError):
            time.sleep(0.05)
    raise RuntimeError("release service failed readiness")

def stop():
    global server
    if server and server.poll() is None:
        server.send_signal(signal.SIGINT)
        server.wait(timeout=10)

def request(method, path, data=None, expected=200, origin=base, token=None):
    headers = {"Origin": origin, "Content-Type": "application/json", "X-CSRF-Token": csrf if token is None else token}
    req = urllib.request.Request(base + path, method=method, headers=headers, data=json.dumps(data).encode() if data is not None else None)
    try:
        response = client.open(req, timeout=10)
    except urllib.error.HTTPError as e:
        response = e
    status = response.status
    body = response.read()
    assert status == expected, (method, path, status, body)
    results.append({"method": method, "path": path, "status": status})
    return json.loads(body) if body and response.headers.get("Content-Type", "").startswith("application/json") else body

try:
    start()
    request("GET", "/api/me", expected=401)
    request("POST", "/api/bootstrap", {}, expected=404)
    request("POST", "/api/login", {"username": "admin", "password": password}, expected=403, origin="https://evil.invalid")
    login = request("POST", "/api/login", {"username": "admin", "password": password})
    csrf = login["csrf"]
    request("POST", "/api/boards", {"title": "CSRF rejected"}, expected=403, token="invalid")
    board = request("POST", "/api/boards", {"title": "Release HTTP validation"}, expected=201)
    path = f"/api/boards/{board['id']}"
    board = request("POST", path + "/mutate", {"expected_revision": board["revision"], "action": "list_create", "title": "计划"})
    old = board["revision"]
    board = request("POST", path + "/mutate", {"expected_revision": old, "action": "card_create", "list_id": board["lists"][0]["id"], "title": "真实HTTP卡片", "description": "重启仍保留"})
    request("POST", path + "/mutate", {"expected_revision": old, "action": "list_create", "title": "过时"}, expected=409)
    assert request("GET", path) == board
    cid = board["cards"][0]["id"]
    for data in [
        {"action":"checklist_create","card_id":cid,"title":"HTTP checklist"},
        {"action":"card_details","card_id":cid,"assignee_id":login["user"]["id"],"due_date":"2028-02-29"},
        {"action":"comment_create","card_id":cid,"body":"HTTP comment"},
    ]:
        board = request("POST", path+"/mutate", {"expected_revision":board["revision"], **data})
    assert board["checklist"][0]["title"] == "HTTP checklist"
    assert board["comments"][0]["author"] == "admin"
    assert board["cards"][0]["due_date"] == "2028-02-29"
    assert request("GET", path) == board
    stop()
    start()
    assert request("GET", path) == board
    request("POST", "/api/logout", {}, expected=204)
    request("GET", "/api/me", expected=401)
    (evidence / "result.json").write_text(json.dumps({"passed": True, "checks": results, "restart_persistence": True}, ensure_ascii=False, indent=2))
    print(f"HTTP_SMOKE_PASS {evidence} ({len(results)} HTTP assertions)")
finally:
    stop()
