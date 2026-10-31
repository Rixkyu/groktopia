import {
  AIR_ACCEL,
  AIR_DECEL,
  BUMPER_BOUNCE_VELOCITY,
  DOUBLE_JUMP_VELOCITY,
  GRAVITY,
  GROUND_ACCEL,
  GROUND_DECEL,
  JUMP_VELOCITY,
  LAVA_BOUNCE_VELOCITY,
  MOVE_SPEED,
  TERMINAL_VELOCITY,
} from '../../shared/constants';
import { TileData } from '../../shared/types';
import { CollisionSystem } from './CollisionSystem';

export interface PhysicsState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  doubleJumpUsed: boolean;
  dropThroughTimer: number;
  hurtTimer: number;
  coyoteTimer?: number;
  jumpBufferTimer?: number;
  landSquashTimer?: number;
}

export interface PhysicsInput {
  moveDir: -1 | 0 | 1;
  jumpHeld: boolean;
  jumpJustPressed: boolean;
  downHeld: boolean;
  hasDoubleJump: boolean;
}

export interface PhysicsEvents {
  jumped: boolean;
  doubleJumped: boolean;
  lavaHit: boolean;
  spikeHit: boolean;
  bumperHit: boolean;
  landed: boolean;
}

export class PhysicsEngine {
  constructor(private collision: CollisionSystem) {}

  public step(
    state: PhysicsState,
    input: PhysicsInput,
    dt: number,
    getTile: (tx: number, ty: number) => TileData | undefined
  ): PhysicsEvents {
    const events: PhysicsEvents = {
      jumped: false,
      doubleJumped: false,
      lavaHit: false,
      spikeHit: false,
      bumperHit: false,
      landed: false,
    };

    const wasGrounded = state.grounded;

    if (state.hurtTimer > 0) {
      state.hurtTimer = Math.max(0, state.hurtTimer - dt);
    }
    if (state.landSquashTimer && state.landSquashTimer > 0) {
      state.landSquashTimer = Math.max(0, state.landSquashTimer - dt);
    }

    if (input.downHeld) {
      state.dropThroughTimer = 0.2;
    } else if (state.dropThroughTimer > 0) {
      state.dropThroughTimer = Math.max(0, state.dropThroughTimer - dt);
    }

    // Jump buffer timer: remembers jump press for up to 120ms before landing
    if (input.jumpJustPressed) {
      state.jumpBufferTimer = 0.12;
    } else if (state.jumpBufferTimer && state.jumpBufferTimer > 0) {
      state.jumpBufferTimer = Math.max(0, state.jumpBufferTimer - dt);
    }

    // Coyote timer: allows jump within 100ms after stepping off a ledge
    if (state.grounded) {
      state.coyoteTimer = 0.1;
    } else if (state.coyoteTimer && state.coyoteTimer > 0) {
      state.coyoteTimer = Math.max(0, state.coyoteTimer - dt);
    }

    // Horizontal movement with snappy acceleration, deceleration & instant turnaround
    const accel = state.grounded ? GROUND_ACCEL : AIR_ACCEL;
    const decel = state.grounded ? GROUND_DECEL : AIR_DECEL;

    if (input.moveDir !== 0) {
      const targetVx = input.moveDir * MOVE_SPEED;
      // Instant turn: if pressing opposite to current velocity, apply 1.6x accel
      const turning = (state.vx > 0 && input.moveDir < 0) || (state.vx < 0 && input.moveDir > 0);
      const effectiveAccel = accel * (turning ? 1.6 : 1.0);

      if (state.vx < targetVx) {
        state.vx = Math.min(targetVx, state.vx + effectiveAccel * dt);
      } else if (state.vx > targetVx) {
        state.vx = Math.max(targetVx, state.vx - effectiveAccel * dt);
      }
    } else {
      if (state.vx > 0) {
        state.vx = Math.max(0, state.vx - decel * dt);
      } else if (state.vx < 0) {
        state.vx = Math.min(0, state.vx + decel * dt);
      }
    }

    // Jumping & Wing Double-Jumping (supports coyote time + jump buffer!)
    const canGroundJump = state.grounded || (state.coyoteTimer !== undefined && state.coyoteTimer > 0);
    const wantsJump =
      input.jumpJustPressed ||
      (state.jumpBufferTimer !== undefined && state.jumpBufferTimer > 0) ||
      (state.grounded && input.jumpHeld);

    if (canGroundJump && wantsJump && !input.downHeld) {
      state.vy = JUMP_VELOCITY;
      state.grounded = false;
      state.coyoteTimer = 0;
      state.jumpBufferTimer = 0;
      state.doubleJumpUsed = false;
      events.jumped = true;
    } else if (
      !state.grounded &&
      input.jumpJustPressed &&
      input.hasDoubleJump &&
      !state.doubleJumpUsed
    ) {
      state.vy = DOUBLE_JUMP_VELOCITY;
      state.doubleJumpUsed = true;
      events.doubleJumped = true;
    }

    // Variable jump height: releasing jump early softens upward velocity
    if (!input.jumpHeld && state.vy < -160 && state.hurtTimer <= 0) {
      state.vy += GRAVITY * 1.35 * dt;
    }

    // Gravity
    state.vy = Math.min(TERMINAL_VELOCITY, state.vy + GRAVITY * dt);

    // Sweep collision against world tiles
    const res = this.collision.resolveMovement(
      state.x,
      state.y,
      state.vx,
      state.vy,
      dt,
      getTile,
      state.dropThroughTimer > 0
    );

    state.x = res.x;
    state.y = res.y;
    state.vx = res.vx;
    state.vy = res.vy;
    state.grounded = res.grounded;

    if (state.grounded) {
      state.doubleJumpUsed = false;
      if (!wasGrounded) {
        events.landed = true;
      }
    }

    // Classic Growtopia Lava bounce!
    if (res.touchedLava && state.hurtTimer <= 0) {
      state.vy = LAVA_BOUNCE_VELOCITY;
      state.vx = (Math.random() < 0.5 ? -1 : 1) * 140;
      state.grounded = false;
      state.hurtTimer = 0.45;
      events.lavaHit = true;
    }

    // Pinball Bumper bounce!
    if (res.touchedBumper) {
      state.vy = BUMPER_BOUNCE_VELOCITY;
      state.grounded = false;
      state.doubleJumpUsed = false;
      events.bumperHit = true;
    }

    // Spike hazard!
    if (res.touchedSpike) {
      events.spikeHit = true;
    }

    return events;
  }
}
