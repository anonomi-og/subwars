import math
import time
from typing import Dict, List, Optional

from .constants import (
    WORLD_SIZE,
    MAX_DEPTH,
    SONAR_RANGE,
    PASSIVE_SONAR_RANGE,
    PASSIVE_SONAR_NOISE_BEARING,
    PASSIVE_SONAR_NOISE_DISTANCE,
    SUB_MAX_SPEED,
    RESPAWN_TIME,
)
import random
from .models import Submarine, Torpedo
from .physics import torpedo_hits_sub


class GameEngine:
    def __init__(self):
        self.submarines: Dict[str, Submarine] = {}
        self.torpedoes: List[Torpedo] = []
        self.last_tick = time.time()

    def add_player(self, sid: str, username: str) -> Submarine:
        sub = Submarine(sid, username)
        self.submarines[sid] = sub
        return sub

    def remove_player(self, sid: str) -> Optional[Submarine]:
        return self.submarines.pop(sid, None)

    def get_player(self, sid: str) -> Optional[Submarine]:
        return self.submarines.get(sid)

    def update_controls(self, sid: str, data: dict):
        sub = self.submarines.get(sid)
        if sub and sub.alive:
            sub.set_controls(
                data.get("heading"), data.get("speed"), data.get("depth")
            )

    def fire_torpedo(self, sid: str) -> Optional[str]:
        sub = self.submarines.get(sid)
        if sub and sub.alive:
            torp = Torpedo(sid, sub.x, sub.y, sub.depth, sub.heading)
            self.torpedoes.append(torp)
            return torp.id
        return None

    def request_respawn(self, sid: str) -> bool:
        sub = self.submarines.get(sid)
        if not sub or sub.alive:
            return False
        
        now = time.time()
        if sub.respawn_at and now >= sub.respawn_at:
            sub.respawn()
            return True
        return False

    def update(self) -> List[dict]:
        """
        Updates game state. Returns a list of events (e.g. hits) to be broadcasted.
        """
        now = time.time()
        dt = now - self.last_tick
        self.last_tick = now
        events = []

        # Update submarines
        for sub in self.submarines.values():
            sub.update(dt)
            # Check respawn ready
            if (
                not sub.alive
                and sub.respawn_at
                and now >= sub.respawn_at
                and not sub.respawn_ready
            ):
                sub.respawn_ready = True
                events.append({"type": "respawn_ready", "sid": sub.id})

        # Update torpedoes
        surviving_torps = []
        for torp in self.torpedoes:
            torp.update(dt)
            if torp.is_expired(now):
                continue

            hit = False
            for sub in self.submarines.values():
                if not sub.alive or sub.id == torp.owner_id:
                    continue

                if torpedo_hits_sub(
                    torp.x, torp.y, torp.depth, sub.x, sub.y, sub.depth, sub.heading
                ):
                    sub.take_hit()
                    attacker = self.submarines.get(torp.owner_id)
                    attacker_name = attacker.username if attacker else "Unknown"
                    
                    events.append(
                        {
                            "type": "hit",
                            "victim_id": sub.id,
                            "victim_name": sub.username,
                            "attacker_id": torp.owner_id,
                            "attacker_name": attacker_name,
                            "respawn_at": sub.respawn_at,
                        }
                    )
                    hit = True
                    break
            
            if not hit:
                surviving_torps.append(torp)
        
        self.torpedoes = surviving_torps
        return events

    def get_state(self, sid: str) -> dict:
        sub = self.submarines.get(sid)
        if not sub:
            return {}

        now = time.time()
        
        # Build "you" state
        if sub.alive:
            you = {
                "id": sub.id,
                "username": sub.username,
                "x": sub.x,
                "y": sub.y,
                "depth": sub.depth,
                "heading": sub.heading,
                "speed": sub.speed,
                "alive": True,
            }
        else:
            you = {
                "id": sub.id,
                "username": sub.username,
                "alive": False,
                "respawn_at": sub.respawn_at,
                "respawn_ready": sub.respawn_ready,
            }

        # Build sonar contacts
        contacts = []
        if sub.alive:
            for other in self.submarines.values():
                if other.id == sid or not other.alive:
                    continue
                
                dx = other.x - sub.x
                dy = other.y - sub.y
                dz = other.depth - sub.depth
                dist = math.sqrt(dx * dx + dy * dy + dz * dz)
                
                if dist <= SONAR_RANGE:
                    recent_ping = (now - sub.last_sonar_ping <= 5.0) or (
                        now - other.last_sonar_ping <= 5.0
                    )
                    if recent_ping:
                        contacts.append({
                            "id": other.id,
                            "username": other.username,
                            "x": other.x,
                            "y": other.y,
                            "depth": other.depth,
                        })

        # Build passive sonar contacts
        passive_contacts = []
        if sub.alive:
            for other in self.submarines.values():
                if other.id == sid or not other.alive:
                    continue
                
                dx = other.x - sub.x
                dy = other.y - sub.y
                dz = other.depth - sub.depth
                dist = math.sqrt(dx * dx + dy * dy + dz * dz)
                
                if dist <= PASSIVE_SONAR_RANGE:
                    # Calculate true bearing
                    true_bearing = (math.degrees(math.atan2(dx, -dy)) + 360.0) % 360.0
                    
                    # Apply noise
                    bearing_noise = random.uniform(-PASSIVE_SONAR_NOISE_BEARING, PASSIVE_SONAR_NOISE_BEARING)
                    dist_noise_factor = random.uniform(1.0 - PASSIVE_SONAR_NOISE_DISTANCE, 1.0 + PASSIVE_SONAR_NOISE_DISTANCE)
                    
                    noisy_bearing = (true_bearing + bearing_noise + 360.0) % 360.0
                    noisy_dist = dist * dist_noise_factor
                    
                    passive_contacts.append({
                        "id": other.id, # Identifying info might be too much, but useful for client tracking if needed. 
                                        # For strict realism, maybe hide ID, but for game feel, knowing who it *might* be is okay?
                                        # Let's keep ID for now so client can track blips, but maybe UI shouldn't show name?
                                        # Re-reading request: "identify another sub... spot a sub". 
                                        # Let's include username but maybe UI can choose to hide it or show it with uncertainty.
                        "username": other.username,
                        "distance": round(noisy_dist, 1),
                        "bearing": round(noisy_bearing, 1),
                        "depth": round(other.depth, 1), # Maybe depth should be noisy too? Plan didn't specify, keeping accurate for now or maybe just don't send it?
                                                        # Plan said "reduced accuracy". Let's send it for now.
                    })

        return {
            "you": you,
            "torpedoes": [t.to_dict() for t in self.torpedoes],
            "sonar_contacts": contacts,
            "passive_contacts": passive_contacts,
            "world_size": WORLD_SIZE,
            "max_depth": MAX_DEPTH,
            "sonar_range": SONAR_RANGE,
            "passive_sonar_range": PASSIVE_SONAR_RANGE,
            "sub_max_speed": SUB_MAX_SPEED,
        }

    def perform_sonar_ping(self, sid: str) -> dict:
        sub = self.submarines.get(sid)
        if not sub or not sub.alive:
            return {"contacts": []}
        
        now = time.time()
        sub.last_sonar_ping = now
        
        contacts = []
        pings_detected = []

        for other in self.submarines.values():
            if other.id == sid or not other.alive:
                continue
            
            dx = other.x - sub.x
            dy = other.y - sub.y
            dz = other.depth - sub.depth
            dist = math.sqrt(dx * dx + dy * dy + dz * dz)
            
            if dist <= SONAR_RANGE:
                bearing = (math.degrees(math.atan2(dx, -dy)) + 360.0) % 360.0
                contacts.append({
                    "id": other.id,
                    "username": other.username,
                    "distance": round(dist, 1),
                    "bearing": round(bearing, 1),
                    "depth": round(other.depth, 1),
                })
                pings_detected.append({
                    "target_id": other.id,
                    "pinger_id": sub.id,
                    "pinger_name": sub.username,
                    "dist": round(dist, 1)
                })
        
        return {"contacts": contacts, "detected_by": pings_detected}
