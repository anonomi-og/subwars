import math
import random
import time
from typing import Dict, List

from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, emit

# -----------------------------------------------------------------------------
# Game tuning constants (easy to tweak for balancing experiments)
# -----------------------------------------------------------------------------
WORLD_SIZE = 2000.0
MAX_DEPTH = 300.0
TICK_RATE = 5  # updates per second
TORPEDO_SPEED = 6.0
SUB_MAX_SPEED = 4.0
SONAR_RANGE = 500.0
HIT_RADIUS = 30.0
RESPAWN_TIME = 10.0

# -----------------------------------------------------------------------------
# Flask + Socket.IO setup
# -----------------------------------------------------------------------------
app = Flask(__name__, static_folder="static", static_url_path="/static")
app.config["SECRET_KEY"] = "u-boat-secret"
socketio = SocketIO(app, async_mode="threading")

# -----------------------------------------------------------------------------
# Global game state containers
# -----------------------------------------------------------------------------
submarines: Dict[str, dict] = {}
torpedoes: List[dict] = []
game_loop_started = False


# -----------------------------------------------------------------------------
def random_position():
    return random.uniform(0, WORLD_SIZE), random.uniform(0, WORLD_SIZE)


def spawn_submarine(username: str, sid: str) -> dict:
    """Create and return a new submarine model."""
    x, y = random_position()
    sub = {
        "id": sid,
        "username": username,
        "x": x,
        "y": y,
        "depth": 50.0,
        "heading": random.uniform(0, 359),
        "speed": 0.0,
        "alive": True,
        "last_sonar_ping": 0.0,
        "respawn_at": None,
    }
    return sub


def wrap_position(value: float) -> float:
    if value < 0:
        value += WORLD_SIZE
    elif value >= WORLD_SIZE:
        value -= WORLD_SIZE
    return value


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


# -----------------------------------------------------------------------------
def update_submarine(sub: dict, dt: float, now: float):
    if sub["alive"]:
        speed = clamp(sub["speed"], 0.0, SUB_MAX_SPEED)
        heading_rad = math.radians(sub["heading"])
        dx = math.cos(heading_rad) * speed
        dy = math.sin(heading_rad) * speed
        sub["x"] = wrap_position(sub["x"] + dx)
        sub["y"] = wrap_position(sub["y"] + dy)
        sub["depth"] = clamp(sub["depth"], 0.0, MAX_DEPTH)
    else:
        if sub["respawn_at"] and now >= sub["respawn_at"]:
            x, y = random_position()
            sub.update({
                "x": x,
                "y": y,
                "depth": 50.0,
                "heading": random.uniform(0, 359),
                "speed": 0.0,
                "alive": True,
                "respawn_at": None,
            })


def update_torpedo(torp: dict):
    heading_rad = math.radians(torp["heading"])
    torp["x"] = wrap_position(torp["x"] + math.cos(heading_rad) * TORPEDO_SPEED)
    torp["y"] = wrap_position(torp["y"] + math.sin(heading_rad) * TORPEDO_SPEED)


def handle_torpedo_hits(now: float):
    global torpedoes
    surviving_torps = []
    for torp in torpedoes:
        if torp["expires_at"] <= now:
            continue
        hit = False
        for sub in submarines.values():
            if not sub["alive"]:
                continue
            if sub["id"] == torp["owner"]:
                continue
            dx = torp["x"] - sub["x"]
            dy = torp["y"] - sub["y"]
            dz = torp["depth"] - sub["depth"]
            dist = math.sqrt(dx * dx + dy * dy + dz * dz)
            if dist <= HIT_RADIUS:
                sub["alive"] = False
                sub["respawn_at"] = now + RESPAWN_TIME
                emit(
                    "sub_hit",
                    {
                        "victim_id": sub["id"],
                        "victim_username": sub["username"],
                        "by_owner": torp["owner"],
                    },
                    broadcast=True,
                )
                hit = True
                break
        if not hit:
            surviving_torps.append(torp)
    torpedoes = surviving_torps


def visible_contacts(sub: dict, now: float):
    contacts = []
    for other in submarines.values():
        if other["id"] == sub["id"] or not other["alive"]:
            continue
        dx = other["x"] - sub["x"]
        dy = other["y"] - sub["y"]
        dz = other["depth"] - sub["depth"]
        dist = math.sqrt(dx * dx + dy * dy + dz * dz)
        if dist <= SONAR_RANGE:
            recent_ping = (now - sub["last_sonar_ping"] <= 5.0) or (
                now - other["last_sonar_ping"] <= 5.0
            )
            if recent_ping:
                contacts.append(
                    {
                        "id": other["id"],
                        "username": other["username"],
                        "x": other["x"],
                        "y": other["y"],
                        "depth": other["depth"],
                    }
                )
    return contacts


def build_state_for(sub: dict, now: float):
    if sub["alive"]:
        you = {
            "id": sub["id"],
            "username": sub["username"],
            "x": sub["x"],
            "y": sub["y"],
            "depth": sub["depth"],
            "heading": sub["heading"],
            "speed": sub["speed"],
            "alive": True,
        }
    else:
        you = {
            "id": sub["id"],
            "username": sub["username"],
            "alive": False,
            "respawn_at": sub["respawn_at"],
        }

    state = {
        "you": you,
        "torpedoes": [
            {"id": t["id"], "x": t["x"], "y": t["y"], "depth": t["depth"]}
            for t in torpedoes
        ],
        "sonar_contacts": visible_contacts(sub, now),
        "world_size": WORLD_SIZE,
        "max_depth": MAX_DEPTH,
        "sonar_range": SONAR_RANGE,
    }
    return state


def game_loop():
    last_tick = time.time()
    while True:
        now = time.time()
        dt = now - last_tick
        last_tick = now

        for sub in list(submarines.values()):
            update_submarine(sub, dt, now)

        for torp in torpedoes:
            update_torpedo(torp)

        handle_torpedo_hits(now)

        for sid, sub in list(submarines.items()):
            state = build_state_for(sub, now)
            socketio.emit("state_update", state, room=sid)

        socketio.sleep(1.0 / TICK_RATE)


# -----------------------------------------------------------------------------
# Flask routes
# -----------------------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory("static", "index.html")


# -----------------------------------------------------------------------------
# Socket.IO events
# -----------------------------------------------------------------------------
@socketio.on("connect")
def on_connect():
    emit("connected", {"message": "Connected to U-Boat server"})


@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    sub = submarines.pop(sid, None)
    if sub:
        emit(
            "system_message",
            {"message": f"{sub['username']} has left the hunt."},
            broadcast=True,
        )


@socketio.on("join_game")
def on_join_game(data):
    sid = request.sid
    username = data.get("username", "Captain")
    sub = spawn_submarine(username, sid)
    submarines[sid] = sub
    emit("joined", {"id": sid, "username": username})
    emit(
        "system_message",
        {"message": f"{username} has joined the hunt."},
        broadcast=True,
        include_self=False,
    )


@socketio.on("update_controls")
def on_update_controls(data):
    sid = request.sid
    sub = submarines.get(sid)
    if not sub or not sub["alive"]:
        return
    sub["heading"] = float(data.get("heading", sub["heading"])) % 360.0
    sub["speed"] = clamp(float(data.get("speed", sub["speed"])), 0.0, SUB_MAX_SPEED)
    sub["depth"] = clamp(float(data.get("depth", sub["depth"])), 0.0, MAX_DEPTH)


@socketio.on("sonar_ping")
def on_sonar_ping():
    sid = request.sid
    sub = submarines.get(sid)
    if not sub or not sub["alive"]:
        return
    now = time.time()
    sub["last_sonar_ping"] = now

    contacts = []
    for other in submarines.values():
        if other["id"] == sid or not other["alive"]:
            continue
        dx = other["x"] - sub["x"]
        dy = other["y"] - sub["y"]
        dz = other["depth"] - sub["depth"]
        dist = math.sqrt(dx * dx + dy * dy + dz * dz)
        if dist <= SONAR_RANGE:
            bearing = (math.degrees(math.atan2(dy, dx)) + 360.0) % 360.0
            contacts.append(
                {
                    "id": other["id"],
                    "username": other["username"],
                    "distance": round(dist, 1),
                    "bearing": round(bearing, 1),
                    "depth": round(other["depth"], 1),
                }
            )
            emit(
                "sonar_ping_detected",
                {
                    "pinging_id": sub["id"],
                    "pinging_username": sub["username"],
                    "approx_distance": round(dist, 1),
                },
                room=other["id"],
            )

    emit("sonar_result", {"contacts": contacts})


@socketio.on("fire_torpedo")
def on_fire_torpedo():
    sid = request.sid
    sub = submarines.get(sid)
    if not sub or not sub["alive"]:
        return
    now = time.time()
    torpedo = {
        "id": f"torp-{now}-{random.randint(0, 9999)}",
        "owner": sid,
        "x": sub["x"],
        "y": sub["y"],
        "depth": sub["depth"],
        "heading": sub["heading"],
        "created_at": now,
        "expires_at": now + 20.0,
    }
    torpedoes.append(torpedo)
    emit("torpedo_fired", {"id": torpedo["id"]})


# -----------------------------------------------------------------------------
if __name__ == "__main__":
    if not game_loop_started:
        socketio.start_background_task(game_loop)
        game_loop_started = True
    socketio.run(app, host="0.0.0.0", port=5000)
