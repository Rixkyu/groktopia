export const TILE_SIZE = 32;
export const WORLD_WIDTH = 100;
export const WORLD_HEIGHT = 60;

export const MAX_STACK = 200;
export const INITIAL_INVENTORY_SLOTS = 20;
export const MAX_INVENTORY_SLOTS = 36;
export const HOTBAR_SLOTS = 4;

// Player hitbox inside 32x32 tile space (allows fitting cleanly into 1x1 gaps!)
export const PLAYER_WIDTH = 20;
export const PLAYER_HEIGHT = 27;

// Physics constants (pixels per second, authentic Growtopia values)
export const GRAVITY = 1150;
export const TERMINAL_VELOCITY = 620;
export const MOVE_SPEED = 216;
export const GROUND_ACCEL = 2600;
export const GROUND_DECEL = 3200;
export const AIR_ACCEL = 1600;
export const AIR_DECEL = 1050;
export const JUMP_VELOCITY = -430;
export const DOUBLE_JUMP_VELOCITY = -390;
export const LAVA_BOUNCE_VELOCITY = -460;
export const BUMPER_BOUNCE_VELOCITY = -580;

// Interaction & anti-cheat constants
export const PUNCH_REACH_TILES = 2.85; // ~2-3 tiles from player center
export const PUNCH_COOLDOWN_MS = 210;
export const PLACE_COOLDOWN_MS = 140;
export const BLOCK_HEAL_DELAY_MS = 5500;
export const PICKUP_RADIUS_PX = 38;
export const MAGNET_RADIUS_PX = 58;

// Spawn terrain layers (0-indexed from top of 60-high world)
export const SURFACE_Y = 36; // White Door stands here
export const DIRT_START_Y = 37;
export const BEDROCK_START_Y = 54;
