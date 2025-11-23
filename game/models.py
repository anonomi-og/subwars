import math
import random
import time
from .constants import (
    WORLD_SIZE,
    MAX_DEPTH,
    TORPEDO_SPEED,
    SUB_MAX_SPEED,
    MAX_TURN_RATE,
    MAX_ACCELERATION,
    BASE_DIVE_RATE,
    DIVE_RATE_PER_SPEED,
    RESPAWN_TIME,
)
from .physics import (
    wrap_position,
    clamp,
    angular_difference,
    move_towards,
    interpret_speed_command,
)


class Torpedo:
    def __init__(self, owner_id, x, y, depth, heading):
        self.id = f"torp-{time.time()}-{random.randint(0, 9999)}"
        self.owner_id = owner_id
        self.x = x
        self.y = y
        self.depth = depth
        self.heading = heading
        self.created_at = time.time()
        self.expires_at = self.created_at + 20.0

    def update(self, dt: float):
        heading_rad = math.radians(self.heading)
        self.x = wrap_position(self.x + math.sin(heading_rad) * TORPEDO_SPEED * dt)
        self.y = wrap_position(self.y - math.cos(heading_rad) * TORPEDO_SPEED * dt)

    def is_expired(self, now: float) -> bool:
        return now >= self.expires_at

    def to_dict(self):
        return {
            "id": self.id,
            "owner": self.owner_id,
            "x": self.x,
            "y": self.y,
            "depth": self.depth,
            "heading": self.heading,
            "created_at": self.created_at,
            "expires_at": self.expires_at,
        }


class Submarine:
    def __init__(self, sid, username):
        self.id = sid
        self.username = username
        self.x = 0.0
        self.y = 0.0
        self.depth = 50.0
        self.heading = 0.0
        self.speed = 0.0
        self.target_heading = None
        self.target_speed = 0.0
        self.target_depth = 50.0
        self.alive = True
        self.last_sonar_ping = 0.0
        self.respawn_at = None
        self.respawn_ready = False
        self.randomize_position()

    def randomize_position(self):
        self.x = random.uniform(0, WORLD_SIZE)
        self.y = random.uniform(0, WORLD_SIZE)
        self.heading = random.uniform(0, 359)

    def respawn(self):
        self.randomize_position()
        self.depth = 50.0
        self.speed = 0.0
        self.target_heading = None
        self.target_speed = 0.0
        self.target_depth = 50.0
        self.alive = True
        self.respawn_at = None
        self.respawn_ready = False

    def update(self, dt: float):
        if not self.alive:
            return

        # Heading inertia
        target_h = self.target_heading if self.target_heading is not None else self.heading
        turn_amount = clamp(MAX_TURN_RATE * dt, 0.0, 360.0)
        diff = angular_difference(target_h, self.heading)
        if abs(diff) < turn_amount:
            self.heading = target_h % 360.0
        else:
            self.heading = (self.heading + math.copysign(turn_amount, diff)) % 360.0

        # Speed inertia
        target_s = clamp(self.target_speed, 0.0, SUB_MAX_SPEED)
        self.speed = move_towards(self.speed, target_s, MAX_ACCELERATION * dt)

        # Depth change
        target_d = clamp(self.target_depth, 0.0, MAX_DEPTH)
        dive_rate = BASE_DIVE_RATE + self.speed * DIVE_RATE_PER_SPEED
        self.depth = move_towards(self.depth, target_d, dive_rate * dt)
        self.depth = clamp(self.depth, 0.0, MAX_DEPTH)

        # Movement
        speed = clamp(self.speed, 0.0, SUB_MAX_SPEED)
        heading_rad = math.radians(self.heading)
        dx = math.sin(heading_rad) * speed * dt
        dy = -math.cos(heading_rad) * speed * dt
        self.x = wrap_position(self.x + dx)
        self.y = wrap_position(self.y + dy)

    def set_controls(self, heading, speed_command, depth):
        if heading is not None:
            self.target_heading = float(heading) % 360.0
        if speed_command is not None:
            self.target_speed = interpret_speed_command(speed_command)
        if depth is not None:
            self.target_depth = clamp(float(depth), 0.0, MAX_DEPTH)

    def take_hit(self):
        self.alive = False
        self.respawn_at = time.time() + RESPAWN_TIME
        self.respawn_ready = False

    def to_dict(self):
        return {
            "id": self.id,
            "username": self.username,
            "x": self.x,
            "y": self.y,
            "depth": self.depth,
            "heading": self.heading,
            "speed": self.speed,
            "target_heading": self.target_heading,
            "target_speed": self.target_speed,
            "target_depth": self.target_depth,
            "alive": self.alive,
            "last_sonar_ping": self.last_sonar_ping,
            "respawn_at": self.respawn_at,
            "respawn_ready": self.respawn_ready,
        }
