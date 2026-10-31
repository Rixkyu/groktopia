import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CollisionSystem } from '../src/client/engine/CollisionSystem';
import { PhysicsEngine, PhysicsState } from '../src/client/engine/PhysicsEngine';
import { SeedSystem } from '../src/client/engine/SeedSystem';
import { WorldManager } from '../src/client/engine/WorldManager';
import {
  BEDROCK_START_Y,
  PLAYER_HEIGHT,
  SURFACE_Y,
  TILE_SIZE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../src/shared/constants';
import { findSpliceResult, ITEM_IDS } from '../src/shared/ItemRegistry';
import { generateWorld } from '../src/shared/WorldGenerator';

describe('Phase 1 Foundation: World, Tile System, Physics & Collision', () => {
  it('generates authentic 100x60 Growtopia world with White Door, Bedrock floor, Dirt, Rock, and Lava', () => {
    const world = generateWorld('START');
    assert.equal(world.width, WORLD_WIDTH);
    assert.equal(world.height, WORLD_HEIGHT);
    assert.equal(world.tiles.length, 6000);

    const spawnTile = world.tiles[world.spawnY * WORLD_WIDTH + world.spawnX];
    assert.equal(spawnTile.fg, ITEM_IDS.WHITE_DOOR);

    const belowSpawn = world.tiles[(world.spawnY + 1) * WORLD_WIDTH + world.spawnX];
    assert.equal(belowSpawn.fg, ITEM_IDS.BEDROCK);

    for (let y = BEDROCK_START_Y; y < WORLD_HEIGHT; y++) {
      assert.equal(world.tiles[y * WORLD_WIDTH + 10].fg, ITEM_IDS.BEDROCK);
    }

    const hasRock = world.tiles.some((t) => t.fg === ITEM_IDS.ROCK);
    const hasLava = world.tiles.some((t) => t.fg === ITEM_IDS.LAVA);
    assert.equal(hasRock, true);
    assert.equal(hasLava, true);
  });

  it('resolves gravity, solid ground landing, jumping, and wing double-jump accurately', () => {
    const gen = generateWorld('TESTWORLD');
    const wm = new WorldManager();
    wm.loadWorld({
      ...gen,
      ownerId: null,
      ownerName: null,
      drops: [],
      players: [],
    });

    const col = new CollisionSystem();
    const phys = new PhysicsEngine(col);

    const state: PhysicsState = {
      x: wm.spawnX * TILE_SIZE + 4,
      y: (SURFACE_Y - 1) * TILE_SIZE,
      vx: 0,
      vy: 0,
      grounded: false,
      doubleJumpUsed: false,
      dropThroughTimer: 0,
      hurtTimer: 0,
    };

    for (let i = 0; i < 60; i++) {
      phys.step(
        state,
        { moveDir: 0, jumpHeld: false, jumpJustPressed: false, downHeld: false, hasDoubleJump: true },
        1 / 60,
        (tx, ty) => wm.getTile(tx, ty)
      );
    }

    assert.equal(state.grounded, true);
    assert.equal(Math.round(state.y + PLAYER_HEIGHT), (SURFACE_Y + 1) * TILE_SIZE);

    const jumpEv = phys.step(
      state,
      { moveDir: 1, jumpHeld: true, jumpJustPressed: true, downHeld: false, hasDoubleJump: true },
      1 / 60,
      (tx, ty) => wm.getTile(tx, ty)
    );
    assert.equal(jumpEv.jumped, true);
    assert.ok(state.vy < 0);
    assert.equal(state.grounded, false);

    const djEv = phys.step(
      state,
      { moveDir: 1, jumpHeld: true, jumpJustPressed: true, downHeld: false, hasDoubleJump: true },
      1 / 60,
      (tx, ty) => wm.getTile(tx, ty)
    );
    assert.equal(djEv.doubleJumped, true);
    assert.equal(state.doubleJumpUsed, true);

    // Test Coyote Time: walking off ledge allows jumping within coyote window
    state.grounded = true;
    state.coyoteTimer = 0.08;
    state.grounded = false; // walked into air
    const coyoteEv = phys.step(
      state,
      { moveDir: 1, jumpHeld: false, jumpJustPressed: true, downHeld: false, hasDoubleJump: false },
      1 / 60,
      (tx, ty) => wm.getTile(tx, ty)
    );
    assert.equal(coyoteEv.jumped, true);
    assert.ok(state.vy < 0);
  });

  it('supports one-way Wooden Platforms (stand on top, drop through with S/Down)', () => {
    const gen = generateWorld('PLATTEST');
    const wm = new WorldManager();
    wm.loadWorld({ ...gen, ownerId: null, ownerName: null, drops: [], players: [] });

    const px = 20;
    const py = 30;
    wm.setTile(px, py, { fg: ITEM_IDS.PLATFORM, bg: 0 });

    const col = new CollisionSystem();
    const phys = new PhysicsEngine(col);
    const state: PhysicsState = {
      x: px * TILE_SIZE + 2,
      y: py * TILE_SIZE - PLAYER_HEIGHT - 8,
      vx: 0,
      vy: 0,
      grounded: false,
      doubleJumpUsed: false,
      dropThroughTimer: 0,
      hurtTimer: 0,
    };

    for (let i = 0; i < 30; i++) {
      phys.step(
        state,
        { moveDir: 0, jumpHeld: false, jumpJustPressed: false, downHeld: false, hasDoubleJump: false },
        1 / 60,
        (tx, ty) => wm.getTile(tx, ty)
      );
    }
    assert.equal(state.grounded, true);
    assert.equal(Math.round(state.y + PLAYER_HEIGHT), py * TILE_SIZE);

    for (let i = 0; i < 15; i++) {
      phys.step(
        state,
        { moveDir: 0, jumpHeld: false, jumpJustPressed: false, downHeld: true, hasDoubleJump: false },
        1 / 60,
        (tx, ty) => wm.getTile(tx, ty)
      );
    }
    assert.ok(state.y + PLAYER_HEIGHT > py * TILE_SIZE + 6);
  });

  it('verifies seed splicing recipes and growth stages', () => {
    const woodSeed = findSpliceResult(ITEM_IDS.DIRT_SEED, ITEM_IDS.LAVA_SEED);
    assert.equal(woodSeed?.id, ITEM_IDS.WOOD_SEED);

    const chandelierSeed = findSpliceResult(ITEM_IDS.GOLD_SEED, ITEM_IDS.GLASS_SEED);
    assert.equal(chandelierSeed?.id, ITEM_IDS.CHANDELIER_SEED);

    const ss = new SeedSystem();
    const now = 100_000;
    const tile = {
      fg: ITEM_IDS.DIRT_SEED,
      bg: 0,
      meta: { plantedAt: now - 4000, growTimeMs: 8000 },
    };
    assert.ok(Math.abs(ss.getGrowthProgress(tile, now) - 0.5) < 0.01);
    assert.equal(ss.isMature(tile, now), false);
    assert.equal(ss.isMature(tile, now + 4500), true);
  });
});
