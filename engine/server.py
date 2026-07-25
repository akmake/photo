"""Local AI tool engine (sidecar).

A tiny dependency-light HTTP server the desktop app talks to over localhost.
In the packaged Electron app this process is spawned as a sidecar; images never
leave the machine. Each AI tool is dispatched under /tools/{id}/apply.
"""

import base64
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import abpn
import common
import raw
import render
import skin
import background
import cleanup

PORT = 8756

# Tool registry (mirrors the front-end registry; source of truth for the engine).
TOOLS = [
    {
        "id": "face-retouch",
        "kind": "ai",
        "category": "local-ai",
        "params": [{"id": "strength", "min": 0, "max": 100, "default": 70}],
    },
    {
        "id": "skin-cleanup",
        "kind": "ai",
        "category": "local-ai",
        "params": [{"id": "strength", "min": 0, "max": 100, "default": 60}],
    },
    {
        "id": "skin",
        "kind": "ai",
        "category": "local-ai",
        "params": [{"id": "strength", "min": 0, "max": 100, "default": 60}],
    },
    {
        "id": "background-blur",
        "kind": "ai",
        "category": "scene",
        "params": [
            {"id": "amount", "min": 0, "max": 100, "default": 60},
            {"id": "feather", "min": 0, "max": 100, "default": 40},
        ],
    },
]

# id -> callable(image_b64, params) -> (out_b64, meta)
DISPATCH = {
    "face-retouch": abpn.process,
    "skin-cleanup": cleanup.process,
    "skin": skin.process,
    "background-blur": background.process,
}


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"status": "ok", "tools": [t["id"] for t in TOOLS]})
        elif self.path == "/tools":
            self._json(200, {"tools": TOOLS})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/decode":
            self._decode()
            return
        if self.path == "/render":
            self._render()
            return
        if self.path == "/export":
            self._export()
            return
        parts = self.path.strip("/").split("/")
        if len(parts) == 3 and parts[0] == "tools" and parts[2] == "apply":
            tool_id = parts[1]
            fn = DISPATCH.get(tool_id)
            if fn is None:
                self._json(404, {"error": f"unknown tool {tool_id}"})
                return
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length))
                out_b64, meta = fn(body["image"], body.get("params", {}))
                self._json(
                    200,
                    {"image": "data:image/png;base64," + out_b64, "meta": meta},
                )
            except Exception as e:  # noqa: BLE001 - surface errors to the client
                self._json(500, {"error": str(e)})
        else:
            self._json(404, {"error": "not found"})

    def _body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length))

    def _render(self):
        """Run a whole recipe in one pass. { image|path, recipe:[...] }"""
        try:
            body = self._body()
            if body.get("path"):
                img = common.load_image(body["path"])
            else:
                img = common.b64_to_image(body["image"])
            out, meta = render.render(img, body.get("recipe", []))
            self._json(
                200,
                {
                    "image": "data:image/jpeg;base64," + common.image_to_jpeg_b64(out),
                    "meta": meta,
                },
            )
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _export(self):
        """Render files from disk and save them. { files:[paths], recipe|perFile,
        dest, format, quality }"""
        try:
            body = self._body()
            files = body.get("files", [])
            dest = body["dest"]
            fmt = body.get("format", "jpeg")
            quality = int(body.get("quality", render.DEFAULT_QUALITY))
            per_file = body.get("perFile") or {}
            default_recipe = body.get("recipe", [])

            written, errors = [], []
            for path in files:
                try:
                    recipe = per_file.get(path, default_recipe)
                    out_path, _ = render.export(path, recipe, dest, fmt, quality)
                    written.append(out_path)
                except Exception as e:  # noqa: BLE001 - one bad file must not
                    errors.append({"file": path, "error": str(e)})  # kill the batch
            self._json(
                200, {"written": written, "errors": errors, "count": len(written)}
            )
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _decode(self):
        """RAW -> preview JPEG. Accepts { path } or { image: base64 }, maxDim."""
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            max_dim = int(body.get("maxDim", 0))
            if body.get("path"):
                img = raw.decode_path(body["path"], max_dim)
            else:
                data = base64.b64decode(body["image"].split(",", 1)[-1])
                img = raw.decode_bytes(data, max_dim)
            self._json(
                200,
                {
                    "image": "data:image/jpeg;base64," + common.image_to_jpeg_b64(img),
                    "width": img.width,
                    "height": img.height,
                },
            )
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _json(self, code, obj):
        payload = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass  # keep the console quiet


if __name__ == "__main__":
    print(f"engine listening on http://127.0.0.1:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
