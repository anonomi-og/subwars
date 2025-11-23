# Game tuning constants
WORLD_SIZE = 2000.0
MAX_DEPTH = 300.0
TICK_RATE = 5  # updates per second
TORPEDO_SPEED = 30.0  # world units per second
SUB_MAX_SPEED = 20.0  # world units per second
SONAR_RANGE = 500.0
PASSIVE_SONAR_RANGE = 750.0
PASSIVE_SONAR_NOISE_BEARING = 15.0
PASSIVE_SONAR_NOISE_DISTANCE = 0.2
HIT_RADIUS = 12.0  # cylindrical radius of the submarine hull
RESPAWN_TIME = 10.0

# Movement modelling
MAX_TURN_RATE = 25.0  # degrees per second
MAX_ACCELERATION = 20.0  # speed change per second
BASE_DIVE_RATE = 8.0  # meters per second when stopped
DIVE_RATE_PER_SPEED = 0.15  # extra dive rate per unit of speed

# Hull modelling (used for collisions)
SUB_LENGTH = 55.0  # meters
SPEED_ORDER_MAX = 4.0
