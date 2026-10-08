import json
import mimetypes
import os
import secrets
import string
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit


ROOT = Path(__file__).resolve().parent
ROOMS = {}
ROOMS_LOCK = threading.Lock()
ROOM_TTL_SECONDS = 180
VALID_INPUTS = {"left", "right", "jump", "attack", "skill", "hook", "decoy", "restart"}
MAX_REQUEST_BYTES = 512 * 1024


class FightHandler(SimpleHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": "Invalid request content length."})
            return None
        if length <= 0 or length > MAX_REQUEST_BYTES:
            self.send_json(413, {"error": "Request body is empty or exceeds the size limit."})
            return None
        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": "Request body must be valid JSON."})
            return None
        if not isinstance(payload, dict):
            self.send_json(400, {"error": "Request body must be a JSON object."})
            return None
        return payload

    @staticmethod
    def valid_room_code(value):
        return (
            isinstance(value, str)
            and len(value) == 6
            and value.isascii()
            and value.isdigit()
        )

    @staticmethod
    def clean_expired_rooms():
        now = time.monotonic()
        expired = [
            code for code, room in ROOMS.items()
            if now - room["last_seen"] > ROOM_TTL_SECONDS
        ]
        for code in expired:
            del ROOMS[code]

    @staticmethod
    def new_room_code():
        while True:
            room_code = "".join(secrets.choice(string.digits) for _ in range(6))
            if room_code not in ROOMS:
                return room_code

    def do_GET(self):
        request = urlsplit(self.path)
        path = unquote(request.path)

        if path == "/healthz":
            self.send_json(200, {"status": "ok"})
            return

        if path == "/api/poll":
            query = parse_qs(request.query)
            room_code = query.get("roomCode", [""])[0]
            role = query.get("role", [""])[0]
            if not self.valid_room_code(room_code) or role not in {"host", "guest"}:
                self.send_json(400, {"error": "Invalid room code or player role."})
                return

            with ROOMS_LOCK:
                self.clean_expired_rooms()
                room = ROOMS.get(room_code)
                if room is None:
                    self.send_json(404, {"error": "Room not found or expired."})
                    return
                room["last_seen"] = time.monotonic()
                if role == "guest" and not room["guest"]:
                    self.send_json(404, {"error": "The room host has left."})
                    return
                if role == "host":
                    inputs = room["inputs"]
                    room["inputs"] = []
                    result = {"connected": room["guest"], "inputs": inputs}
                else:
                    result = {"connected": True, "snapshot": room["snapshot"]}
            self.send_json(200, result)
            return

        if path.startswith("/api/"):
            self.send_json(404, {"error": "API endpoint not found."})
            return

        relative_path = path.lstrip("/") or "index.html"
        file_path = (ROOT / relative_path).resolve()
        if file_path != ROOT and ROOT not in file_path.parents:
            self.send_json(404, {"error": "File not found."})
            return
        if not file_path.is_file():
            self.send_json(404, {"error": "File not found."})
            return

        content_type, _ = mimetypes.guess_type(str(file_path))
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type or 'application/octet-stream'}; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        payload = self.read_json()
        if payload is None:
            return
        path = urlsplit(self.path).path

        with ROOMS_LOCK:
            self.clean_expired_rooms()

            if path == "/api/rooms":
                room_code = self.new_room_code()
                ROOMS[room_code] = {
                    "guest": False,
                    "snapshot": None,
                    "inputs": [],
                    "last_seen": time.monotonic(),
                }
                self.send_json(201, {"roomCode": room_code})
                return

            room_code = payload.get("roomCode")
            if not self.valid_room_code(room_code):
                self.send_json(400, {"error": "Provide a valid 6-digit room code."})
                return

            room = ROOMS.get(room_code)
            if path == "/api/rooms/join":
                if room is None:
                    self.send_json(404, {"error": "Room not found. Check the room code."})
                    return
                if room["guest"]:
                    self.send_json(409, {"error": "This room already has a second player."})
                    return
                room["guest"] = True
                room["last_seen"] = time.monotonic()
                self.send_json(200, {"joined": True})
                return

            if room is None:
                self.send_json(404, {"error": "Room not found or expired."})
                return
            room["last_seen"] = time.monotonic()

            if path == "/api/input":
                action = payload.get("action")
                pressed = payload.get("pressed")
                if not room["guest"]:
                    self.send_json(409, {"error": "The room is waiting for a second player."})
                    return
                if not isinstance(action, str) or action not in VALID_INPUTS or not isinstance(pressed, bool):
                    self.send_json(400, {"error": "Invalid player input."})
                    return
                if len(room["inputs"]) >= 1000:
                    self.send_json(429, {"error": "Input queue is full. Try again shortly."})
                    return
                room["inputs"].append({"action": action, "pressed": pressed})
                self.send_json(202, {"accepted": True})
                return

            if path == "/api/state":
                snapshot = payload.get("snapshot")
                if not room["guest"]:
                    self.send_json(409, {"error": "The opponent is not connected."})
                    return
                if not isinstance(snapshot, dict):
                    self.send_json(400, {"error": "Invalid game state."})
                    return
                room["snapshot"] = snapshot
                self.send_json(202, {"synced": True})
                return

            if path == "/api/rooms/leave":
                role = payload.get("role")
                if role == "host":
                    del ROOMS[room_code]
                elif role == "guest":
                    room["guest"] = False
                    room["snapshot"] = None
                    room["inputs"] = []
                else:
                    self.send_json(400, {"error": "Invalid player role."})
                    return
                self.send_json(200, {"left": True})
                return

            self.send_json(404, {"error": "API endpoint not found."})


if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), FightHandler)
    print(f"Fight server listening on {host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Fight server stopped.", flush=True)
    finally:
        server.server_close()
