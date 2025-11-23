import time
from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, emit

from game.engine import GameEngine
from game.constants import TICK_RATE

# -----------------------------------------------------------------------------
# Flask + Socket.IO setup
# -----------------------------------------------------------------------------
app = Flask(__name__, static_folder="static", static_url_path="/static")
app.config["SECRET_KEY"] = "u-boat-secret"
socketio = SocketIO(app, async_mode="threading")

# -----------------------------------------------------------------------------
# Game Engine Instance
# -----------------------------------------------------------------------------
game_engine = GameEngine()
game_loop_started = False


# -----------------------------------------------------------------------------
# Game Loop
# -----------------------------------------------------------------------------
def game_loop():
    while True:
        # Update game state
        events = game_engine.update()

        # Process events
        for event in events:
            if event["type"] == "respawn_ready":
                socketio.emit(
                    "respawn_ready",
                    {"message": "You may respawn when ready."},
                    room=event["sid"],
                )
            elif event["type"] == "hit":
                socketio.emit(
                    "sub_hit",
                    {
                        "victim_id": event["victim_id"],
                        "victim_username": event["victim_name"],
                        "attacker_username": event["attacker_name"],
                    },
                )
                socketio.emit(
                    "hit_confirmed",
                    {
                        "victim_id": event["victim_id"],
                        "victim_username": event["victim_name"],
                    },
                    room=event["attacker_id"],
                )
                socketio.emit(
                    "you_were_hit",
                    {
                        "by_username": event["attacker_name"],
                        "respawn_available_at": event["respawn_at"],
                    },
                    room=event["victim_id"],
                )

        # Broadcast state to all players
        # Note: In a real large-scale game, we wouldn't iterate all players here.
        # We might only send updates to players who need them.
        # But for this MVP, we iterate the known sockets or just the engine players.
        # Since we don't have a list of all connected SIDs easily accessible without
        # tracking them, we can iterate the players in the engine.
        for sid in list(game_engine.submarines.keys()):
            state = game_engine.get_state(sid)
            if state:
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
    sub = game_engine.remove_player(sid)
    if sub:
        socketio.emit(
            "system_message",
            {"message": f"{sub.username} has left the hunt."},
            skip_sid=sid,
        )


@socketio.on("join_game")
def on_join_game(data):
    sid = request.sid
    username = data.get("username", "Captain")
    game_engine.add_player(sid, username)
    emit("joined", {"id": sid, "username": username})
    socketio.emit(
        "system_message",
        {"message": f"{username} has joined the hunt."},
        skip_sid=sid,
    )


@socketio.on("update_controls")
def on_update_controls(data):
    sid = request.sid
    game_engine.update_controls(sid, data)


@socketio.on("sonar_ping")
def on_sonar_ping():
    sid = request.sid
    result = game_engine.perform_sonar_ping(sid)
    
    # Send results to the pinger
    emit("sonar_result", {"contacts": result["contacts"]})
    
    # Notify those who were pinged
    if "detected_by" in result:
        for detection in result["detected_by"]:
            socketio.emit(
                "sonar_ping_detected",
                {
                    "pinging_id": detection["pinger_id"],
                    "pinging_username": detection["pinger_name"],
                    "approx_distance": detection["dist"],
                },
                room=detection["target_id"],
            )


@socketio.on("fire_torpedo")
def on_fire_torpedo():
    sid = request.sid
    torp_id = game_engine.fire_torpedo(sid)
    if torp_id:
        emit("torpedo_fired", {"id": torp_id})


@socketio.on("request_respawn")
def on_request_respawn():
    sid = request.sid
    success = game_engine.request_respawn(sid)
    if success:
        sub = game_engine.get_player(sid)
        socketio.emit(
            "system_message",
            {"message": f"{sub.username} has re-entered the hunt."},
            skip_sid=sid,
        )
        # The state update loop will pick up the new position and send it
        # But we can also send a confirmation message
        emit(
            "respawn_confirmed",
            {"message": "You are back in the fight.", "x": sub.x, "y": sub.y},
        )
    else:
        emit(
            "respawn_not_ready",
            {"message": "Hold tight, the crew is still preparing a new sub."},
        )


# -----------------------------------------------------------------------------
if __name__ == "__main__":
    if not game_loop_started:
        socketio.start_background_task(game_loop)
        game_loop_started = True
    socketio.run(app, host="0.0.0.0", port=5000)
