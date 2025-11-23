import math
import random
from .constants import (
    WORLD_SIZE,
    SPEED_ORDER_MAX,
    SUB_MAX_SPEED,
    SUB_LENGTH,
    HIT_RADIUS,
)


def random_position():
    return random.uniform(0, WORLD_SIZE), random.uniform(0, WORLD_SIZE)


def wrap_position(value: float) -> float:
    if value < 0:
        value += WORLD_SIZE
    elif value >= WORLD_SIZE:
        value -= WORLD_SIZE
    return value


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def angular_difference(target: float, current: float) -> float:
    diff = (target - current + 180.0) % 360.0 - 180.0
    return diff


def move_towards(current: float, target: float, max_delta: float) -> float:
    if current < target:
        return min(target, current + max_delta)
    return max(target, current - max_delta)


def interpret_speed_command(command: float) -> float:
    command = float(command)
    if command <= SPEED_ORDER_MAX:
        fraction = command / SPEED_ORDER_MAX
        return clamp(fraction * SUB_MAX_SPEED, 0.0, SUB_MAX_SPEED)
    return clamp(command, 0.0, SUB_MAX_SPEED)


def torpedo_hits_sub(torp_x, torp_y, torp_depth, sub_x, sub_y, sub_depth, sub_heading) -> bool:
    # Represent the submarine as a horizontal capsule to account for length/orientation
    heading_rad = math.radians(sub_heading)
    dir_x = math.sin(heading_rad)
    dir_y = -math.cos(heading_rad)
    half_length = SUB_LENGTH / 2.0

    rel_x = torp_x - sub_x
    rel_y = torp_y - sub_y
    along = rel_x * dir_x + rel_y * dir_y
    along_clamped = clamp(along, -half_length, half_length)
    closest_x = sub_x + dir_x * along_clamped
    closest_y = sub_y + dir_y * along_clamped

    cross_x = torp_x - closest_x
    cross_y = torp_y - closest_y
    horizontal_dist = math.sqrt(cross_x * cross_x + cross_y * cross_y)
    dz = torp_depth - sub_depth
    distance = math.sqrt(horizontal_dist * horizontal_dist + dz * dz)
    return distance <= HIT_RADIUS
