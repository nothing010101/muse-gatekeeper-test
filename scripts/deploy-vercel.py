#!/usr/bin/env python3
"""Multi-file Vercel deploy for muse-gatekeeper-test.

Same auth mechanism as the custom.vercel connector helper (surrogate
exchange via dynamic_credentials); uploads the whole project as a
base64 file array to POST /v13/deployments, then polls until READY.
"""
import base64
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

API = "https://api.vercel.com"
ALLOWED_HOSTS = ["api.vercel.com"]
PROJECT = "muse-gatekeeper-test"
ROOT = os.path.expanduser("~/workspace/agent-games/muse-gatekeeper-test")

# Files to include in the deployment (relative paths).
INCLUDE = [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vercel.json",
    "api/agent.ts",
    "src/config.ts",
    "src/decision.ts",
    "src/handler.ts",
    "src/hmac.ts",
    "src/kurier.ts",
    "src/local-server.ts",
    "src/prover.ts",
    "src/seen.ts",
    "src/server.ts",
    "src/types.ts",
    "src/snarkjs.d.ts",
    "circuits/gatekeeper.wasm",
    "circuits/gatekeeper_final.zkey",
    "circuits/verification_key.json",
]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise RuntimeError("redirect refused, verify the endpoint")


def call(method, path, body=None):
    url = API + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Accept", "application/json")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    add_surrogate_to_request(request, "custom.vercel", allowed_hosts=ALLOWED_HOSTS)
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=120) as response:
            return response.status, read_json_response(response)
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8", "replace")
        except Exception:
            detail = ""
        return e.code, {"error": detail}


def main():
    files = []
    total = 0
    for rel in INCLUDE:
        p = os.path.join(ROOT, rel)
        with open(p, "rb") as f:
            content = f.read()
        total += len(content)
        files.append({
            "file": rel,
            "data": base64.b64encode(content).decode("ascii"),
            "encoding": "base64",
        })
        print(f"  {rel} ({len(content)} bytes, sha1 {hashlib.sha1(content).hexdigest()[:12]})")
    print(f"total {total} bytes across {len(files)} files")

    body = {
        "name": PROJECT,
        "files": files,
        "projectSettings": {"framework": None},
        "target": "production",
    }
    status, payload = call("POST", "/v13/deployments", body)
    print("deploy:", status, json.dumps(payload)[:600])
    if status not in (200, 201):
        return 1
    dep_id = payload.get("id")
    url = payload.get("url")
    print("deployment:", dep_id, "url:", url)

    # Poll until READY / ERROR (up to ~5 min; build runs npm install).
    for _ in range(60):
        time.sleep(5)
        s, p = call("GET", f"/v13/deployments/{dep_id}")
        state = p.get("readyState")
        print("  state:", state)
        if state == "READY":
            print(json.dumps({"id": dep_id, "url": url, "readyState": state}))
            return 0
        if state == "ERROR":
            print("deployment failed:", json.dumps(p)[:1000])
            return 1
    print("timed out waiting for READY")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
