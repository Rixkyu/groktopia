import {
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  TILE_SIZE,
} from '../../shared/constants';
import { getItemDef, ITEM_IDS } from '../../shared/ItemRegistry';
import {
  PlayerAnimState,
  PlayerNetState,
  PlayerProfile,
} from '../../shared/types';
import { AudioManager } from './AudioManager';
import { BlockSystem } from './BlockSystem';
import { ChatManager } from './ChatManager';
import { CollisionSystem } from './CollisionSystem';
import { InventorySystem } from './InventorySystem';
import { ItemSystem } from './ItemSystem';
import { MultiplayerManager } from './MultiplayerManager';
import { PhysicsEngine, PhysicsState } from './PhysicsEngine';
import { PlayerController } from './PlayerController';
import { Renderer } from './Renderer';
import { SeedSystem } from './SeedSystem';
import { SpriteAtlas } from './SpriteAtlas';
import { UIManager } from './UIManager';
import { WorldManager } from './WorldManager';

export class GameEngine {
  public atlas = new SpriteAtlas();
  public collision = new CollisionSystem();
  public physics = new PhysicsEngine(this.collision);
  public seedSystem = new SeedSystem();
  public world = new WorldManager();
  public inventory = new InventorySystem();
  public itemSystem = new ItemSystem();
  public blockSystem = new BlockSystem(this.collision, this.seedSystem);
  public controller = new PlayerController();
  public chat = new ChatManager();
  public audio = new AudioManager();
  public renderer: Renderer;
  public mp: MultiplayerManager;
  public ui: UIManager;

  private profile: PlayerProfile | null = null;
  private physState: PhysicsState = {
    x: 1600,
    y: 1152,
    vx: 0,
    vy: 0,
    grounded: false,
    doubleJumpUsed: false,
    dropThroughTimer: 0,
    hurtTimer: 0,
  };
  private localAnim: PlayerAnimState = 'idle';
  private localChatBubble: { text: string; expiresAt: number } | undefined;
  private localPunchTarget: { tx: number; ty: number; at: number } | undefined;
  private lastFrameMs = performance.now();
  private lastHudTickMs = 0;
  private deniedCooldownMs = 0;
  private warping = false;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.atlas.init();
    this.renderer = new Renderer(canvas, this.atlas, this.seedSystem);

    this.mp = new MultiplayerManager({
      onProfileSync: (prof) => {
        this.profile = prof;
        this.inventory.loadFromProfile(prof.inventory, prof.maxSlots, prof.gems, prof.equipped);
      },
      onTileUpdated: (ev) => {
        this.world.setTile(ev.tx, ev.ty, ev.tile);
        if (ev.harvested) {
          this.audio.play('harvest');
          const def = ev.brokenId ? getItemDef(ev.brokenId) : undefined;
          this.blockSystem.spawnBlockParticles(
            ev.tx,
            ev.ty,
            def?.primaryColor ?? '#4ef55c',
            def?.secondaryColor ?? '#ffe44d',
            14
          );
        } else if (ev.brokenId) {
          this.audio.play('break');
          const def = getItemDef(ev.brokenId);
          this.blockSystem.spawnBlockParticles(
            ev.tx,
            ev.ty,
            def?.primaryColor ?? '#8b5a2b',
            def?.secondaryColor ?? '#633d19',
            12
          );
        } else if (ev.splicedName) {
          this.audio.play('splice');
          this.blockSystem.spawnSparkles(
            (ev.tx + 0.5) * TILE_SIZE,
            (ev.ty + 0.5) * TILE_SIZE,
            '#ffe44d',
            16
          );
          this.blockSystem.spawnFloatingText(
            (ev.tx + 0.5) * TILE_SIZE,
            ev.ty * TILE_SIZE - 4,
            `Spliced ${ev.splicedName}!`,
            '#4ef55c'
          );
        } else if (ev.placedId) {
          const pDef = getItemDef(ev.placedId);
          if (pDef?.category === 'lock') {
            this.audio.play('lock');
          } else if (pDef?.category === 'seed') {
            this.audio.play('seed');
          } else {
            this.audio.play('place');
          }
        }
      },
      onTileDamaged: (ev) => {
        const tile = this.world.getTile(ev.tx, ev.ty);
        if (tile) {
          tile.damage = ev.damage;
          tile.lastHitAt = Date.now();
          const targetId = tile.fg || tile.bg;
          const def = getItemDef(targetId);
          if (targetId === ITEM_IDS.ROCK || targetId === ITEM_IDS.GOLD || targetId === ITEM_IDS.CRYSTAL) {
            this.audio.play('rock_hit');
          } else {
            this.audio.play('punch');
          }
          this.blockSystem.spawnBlockParticles(
            ev.tx,
            ev.ty,
            def?.primaryColor ?? '#8b5a2b',
            def?.secondaryColor ?? '#cccccc',
            4
          );
        }
      },
      onDropsAdded: (drops) => {
        for (const d of drops) {
          this.world.drops.set(d.uid, d);
        }
      },
      onDropRemoved: (ev) => {
        const existing = this.world.drops.get(ev.uid);
        this.world.drops.delete(ev.uid);
        if (this.profile && ev.pickedById === this.profile.id) {
          if (ev.itemId === 0) {
            this.audio.play('gem');
            this.blockSystem.spawnFloatingText(
              this.physState.x + PLAYER_WIDTH * 0.5,
              this.physState.y - 6,
              `+${ev.count} Gem${ev.count > 1 ? 's' : ''}`,
              '#ffe44d'
            );
          } else {
            this.audio.play('pickup');
            const name = getItemDef(ev.itemId)?.name ?? 'Item';
            this.blockSystem.spawnFloatingText(
              this.physState.x + PLAYER_WIDTH * 0.5,
              this.physState.y - 6,
              `+${ev.count} ${name}`,
              '#82f78e'
            );
          }
        } else if (existing) {
          this.blockSystem.spawnSparkles(existing.x, existing.y, '#ffffff', 5);
        }
      },
      onWeatherChanged: (ev) => {
        this.world.weather = ev.weather;
        this.audio.play('splice');
        this.ui.showToast(`Weather changed to ${ev.weather.toUpperCase()} by ${ev.by}!`);
      },
      onLockChanged: (ev) => {
        this.world.ownerId = ev.ownerId;
        this.world.ownerName = ev.ownerName;
        this.audio.play('lock');
        this.ui.updateDynamicWorldBadge();
      },
      onDenied: (ev) => {
        const now = performance.now();
        if (now - this.deniedCooldownMs > 650) {
          this.deniedCooldownMs = now;
          this.audio.play('rock_hit');
          this.blockSystem.spawnFloatingText(
            (ev.tx + 0.5) * TILE_SIZE,
            ev.ty * TILE_SIZE,
            ev.reason,
            '#ff6666'
          );
        }
      },
      onChatMessage: (pkt) => {
        if (pkt.type === 'player' && this.profile && pkt.senderId === this.profile.id) {
          this.localChatBubble = {
            text: pkt.text,
            expiresAt: performance.now() + 5500,
          };
        }
        this.chat.pushMessage(pkt);
      },
      onTeleported: (ev) => {
        if (this.profile && ev.id === this.profile.id) {
          this.physState.x = ev.x;
          this.physState.y = ev.y;
          this.physState.vx = 0;
          this.physState.vy = 0;
          this.blockSystem.spawnSparkles(ev.x + 10, ev.y + 14, '#75e6ff', 14);
        }
      },
      onLocalEmote: (emote) => {
        this.controller.triggerEmote(emote, 4);
      },
      onWarpRequest: (worldName) => {
        this.enterWorld(worldName);
      },
      onDisconnected: (reason) => {
        this.controller.clearInput();
        this.ui.showDisconnected(reason);
      },
    });

    this.ui = new UIManager(
      uiRoot,
      this.atlas,
      this.inventory,
      this.world,
      this.chat,
      this.audio,
      {
        onLoginSubmit: async (username, password, skinColor) => {
          try {
            const res = await this.mp.login(username, password, skinColor);
            if (!res.ok || !res.profile) {
              return res.error || 'Login failed.';
            }
            this.profile = res.profile;
            this.inventory.loadFromProfile(
              res.profile.inventory,
              res.profile.maxSlots,
              res.profile.gems,
              res.profile.equipped
            );
            this.ui.showWorldSelect(res.profile, res.worlds ?? []);
            return null;
          } catch (err) {
            return err instanceof Error ? err.message : 'Unable to reach server.';
          }
        },
        onRefreshWorlds: () => this.mp.fetchWorlds(),
        onSelectWorld: (worldName) => this.enterWorld(worldName),
        onLogout: () => {
          this.mp.disconnect();
          this.profile = null;
          this.ui.showLoginScreen();
        },
        onSendChat: (text) => this.mp.sendChat(text),
        onDropItem: (itemId, count) => this.mp.sendDrop(itemId, count),
        onTrashItem: (itemId, count) => this.mp.sendTrash(itemId, count),
        onEquipItem: (itemId) => this.mp.sendEquip(itemId),
        onStoreBuy: async (listingId) => {
          const res = await this.mp.buyStoreItem(listingId);
          if (res.ok && res.profile) {
            this.profile = res.profile;
            this.inventory.loadFromProfile(
              res.profile.inventory,
              res.profile.maxSlots,
              res.profile.gems,
              res.profile.equipped
            );
          }
          return res;
        },
        onWrenchSave: (tx, ty, label, targetWorld) => {
          this.mp.sendWrenchEdit(tx, ty, label, targetWorld);
        },
        onRespawn: () => this.respawnAtDoor('Respawned!'),
        onLeaveWorld: () => this.leaveToWorldSelect(),
        onDisconnectToTitle: () => {
          this.mp.disconnect();
          this.profile = null;
          this.ui.showLoginScreen();
        },
        onChangeZoom: (zoom) => {
          this.renderer.setZoomScale(zoom);
        },
        onToggleGrid: (show) => {
          this.renderer.showGrid = show;
        },
        getOnlinePlayerNames: () => {
          const names: string[] = [];
          if (this.profile) names.push(this.profile.username);
          for (const rp of this.mp.remotePlayers.values()) {
            names.push(rp.username);
          }
          return names;
        },
        onVirtualKey: (code, down) => this.controller.setVirtualKey(code, down),
        onVirtualAction: (down) => {
          this.controller.actionHeld = down;
        },
        getPingMs: () => this.mp.pingMs,
        getPlayerTileCoords: () => ({
          tx: Math.floor((this.physState.x + PLAYER_WIDTH * 0.5) / TILE_SIZE),
          ty: Math.floor((this.physState.y + PLAYER_HEIGHT * 0.5) / TILE_SIZE),
        }),
      }
    );

    this.controller.attachListeners(
      canvas,
      () => {
        this.audio.play('ui');
        this.inventory.toggleTool();
      },
      (prefill) => this.ui.focusChatInput(prefill),
      () => this.ui.handleEscapeKey(),
      (dir) => {
        const next = this.renderer.zoomScale * (dir > 0 ? 1 / 1.1 : 1.1);
        this.renderer.setZoomScale(Math.max(0.5, Math.min(2, next)));
      }
    );
  }

  public start(): void {
    this.ui.showLoginScreen();
    void this.atlas.loadAssets().then(() => {
      this.ui.refreshAfterAssetsLoaded();
    });
    this.lastFrameMs = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrameMs) / 1000));
      this.lastFrameMs = now;
      this.update(dt, now);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  public async enterWorld(worldName: string): Promise<string | null> {
    if (this.warping) return null;
    this.warping = true;
    try {
      const prevMessages = [...this.chat.messages];
      this.chat.clear();
      const res = await this.mp.joinWorld(worldName);
      if (!res.ok || !res.world) {
        for (const msg of prevMessages) {
          this.chat.pushMessage(msg);
        }
        return res.error || 'Could not join world.';
      }
      this.world.loadWorld(res.world);
      this.physState.x = res.world.spawnX * TILE_SIZE + (TILE_SIZE - PLAYER_WIDTH) * 0.5;
      this.physState.y = res.world.spawnY * TILE_SIZE + (TILE_SIZE - PLAYER_HEIGHT);
      this.physState.vx = 0;
      this.physState.vy = 0;
      this.physState.grounded = false;
      this.physState.hurtTimer = 0;
      this.controller.clearInput();

      this.renderer.updateCamera(this.physState.x, this.physState.y, this.world, 0.016, true);
      this.ui.showGameHUD();
      this.blockSystem.spawnSparkles(this.physState.x + 10, this.physState.y + 14, '#ffffff', 16);
      return null;
    } finally {
      this.warping = false;
    }
  }

  private async leaveToWorldSelect(): Promise<void> {
    if (!this.profile) return;
    this.mp.leaveWorld();
    this.controller.clearInput();
    const worlds = await this.mp.fetchWorlds();
    this.ui.showWorldSelect(this.profile, worlds);
  }

  private respawnAtDoor(msg: string): void {
    this.physState.x = this.world.spawnX * TILE_SIZE + (TILE_SIZE - PLAYER_WIDTH) * 0.5;
    this.physState.y = this.world.spawnY * TILE_SIZE + (TILE_SIZE - PLAYER_HEIGHT);
    this.physState.vx = 0;
    this.physState.vy = 0;
    this.physState.hurtTimer = 0.35;
    this.mp.sendRespawn();
    this.blockSystem.spawnFloatingText(this.physState.x + 10, this.physState.y - 8, msg, '#ff8080');
  }

  private update(dt: number, nowPerfMs: number): void {
    if (this.ui.screen !== 'playing' || !this.profile) {
      this.renderer.renderMenuBackdrop(nowPerfMs);
      return;
    }

    this.controller.uiBlockingInput = this.ui.isModalBlockingInput();

    // 1. Physics & Movement
    const physInput = this.controller.consumePhysicsInput(this.inventory.hasDoubleJump());
    const events = this.physics.step(
      this.physState,
      physInput,
      dt,
      (tx, ty) => this.world.getTile(tx, ty)
    );

    if (events.jumped) {
      this.audio.play('jump');
    }
    if (events.doubleJumped) {
      this.audio.play('wing');
      this.blockSystem.spawnSparkles(
        this.physState.x + PLAYER_WIDTH * 0.5,
        this.physState.y + PLAYER_HEIGHT,
        '#ffd6e0',
        8
      );
    }
    if (events.lavaHit) {
      this.audio.play('hurt');
      this.blockSystem.spawnFloatingText(
        this.physState.x + 10,
        this.physState.y - 6,
        'OUCH! Hot Lava!',
        '#ff6338'
      );
      this.blockSystem.spawnBlockParticles(
        Math.floor((this.physState.x + 10) / TILE_SIZE),
        Math.floor((this.physState.y + PLAYER_HEIGHT) / TILE_SIZE),
        '#ff521b',
        '#ffe042',
        10
      );
    }
    if (events.bumperHit) {
      this.audio.play('bumper');
      this.blockSystem.spawnSparkles(
        this.physState.x + 10,
        this.physState.y + PLAYER_HEIGHT,
        '#ff3877',
        12
      );
    }
    if (events.spikeHit) {
      this.audio.play('hurt');
      this.respawnAtDoor('Ouch! Spiked!');
    }

    // 2. Door Warp / Exit Interaction (Pressing W / Up while grounded on a Door!)
    const doorPressed = this.controller.consumeDoorInteract();
    if (doorPressed && this.physState.grounded) {
      const ptx = Math.floor((this.physState.x + PLAYER_WIDTH * 0.5) / TILE_SIZE);
      const pty = Math.floor((this.physState.y + PLAYER_HEIGHT * 0.5) / TILE_SIZE);
      const standingTile = this.world.getTile(ptx, pty);
      if (standingTile?.fg === ITEM_IDS.WHITE_DOOR) {
        this.audio.play('warp');
        this.leaveToWorldSelect();
        return;
      }
      if (standingTile?.fg === ITEM_IDS.DOOR && standingTile.meta?.targetWorld) {
        this.audio.play('warp');
        this.enterWorld(standingTile.meta.targetWorld);
        return;
      }
    }

    // 3. Tile Punching / Placing / Wrenching
    const hovered = this.controller.getHoveredTile(
      this.renderer.cameraX,
      this.renderer.cameraY,
      this.renderer.zoom
    );
    const selectedItem = this.inventory.getSelectedItemId();
    const wallClockNow = Date.now();

    // Right-click convenience Wrench on Signs & Doors
    if (this.controller.consumeRightClick()) {
      this.tryWrenchTile(hovered.tx, hovered.ty);
    }

    const useTool = (tx: number, ty: number, fromButton: boolean) => {
      if (selectedItem === ITEM_IDS.FIST) {
        this.tryPunchTile(tx, ty, nowPerfMs);
      } else if (selectedItem === ITEM_IDS.WRENCH) {
        if (fromButton) this.controller.actionHeld = false;
        else this.controller.pointerDown = false;
        this.tryWrenchTile(tx, ty);
      } else {
        // Place selected block / background / seed / lock / weather machine!
        const tileData = this.world.getTile(tx, ty);
        // Convenience: if targeting a ripe tree while holding a seed, harvest it first!
        if (
          tileData &&
          getItemDef(tileData.fg)?.category === 'seed' &&
          this.seedSystem.isMature(tileData, wallClockNow)
        ) {
          this.tryPunchTile(tx, ty, nowPerfMs);
        } else {
          this.tryPlaceTile(tx, ty, selectedItem, wallClockNow);
        }
      }
    };

    if (this.controller.isActionHeld() && !this.controller.uiBlockingInput) {
      // On-screen punch button: acts on the tile in front of the player.
      const front = this.controller.getFrontTile(this.physState.x, this.physState.y);
      useTool(front.tx, front.ty, true);
    } else if (this.controller.pointerDown && !this.controller.uiBlockingInput) {
      useTool(hovered.tx, hovered.ty, false);
    }

    // 4. Dropped Items Magnet & Pickup
    this.itemSystem.update(
      dt,
      wallClockNow,
      this.physState.x,
      this.physState.y,
      this.world,
      this.inventory,
      (uid) => this.mp.sendPickup(uid)
    );

    // 5. Block Damage Auto-Heal, Particles, Multiplayer Sync & Camera
    this.world.tickBlockHealing(wallClockNow);
    this.blockSystem.updateEffects(dt);

    this.localAnim = this.controller.computeAnimState(this.physState, dt);
    this.mp.sendMoveThrottled(
      nowPerfMs,
      this.physState.x,
      this.physState.y,
      this.physState.vx,
      this.physState.vy,
      this.controller.facing,
      this.localAnim
    );
    this.mp.interpolateRemotePlayers(dt);

    this.renderer.updateCamera(this.physState.x, this.physState.y, this.world, dt, true);

    const localNet: PlayerNetState = {
      id: this.profile.id,
      username: this.profile.username,
      x: this.physState.x,
      y: this.physState.y,
      vx: this.physState.vx,
      vy: this.physState.vy,
      facing: this.controller.facing,
      anim: this.localAnim,
      skinColor: this.profile.skinColor,
      equipped: this.inventory.equipped,
      punchTarget: this.localPunchTarget,
      chatBubble: this.localChatBubble,
    };

    this.renderer.renderWorld(
      this.world,
      localNet,
      this.mp.remotePlayers,
      hovered,
      selectedItem,
      this.blockSystem,
      wallClockNow
    );

    if (nowPerfMs - this.lastHudTickMs > 250) {
      this.lastHudTickMs = nowPerfMs;
      this.ui.updateDynamicWorldBadge();
    }
  }

  private tryPunchTile(tx: number, ty: number, nowPerfMs: number): void {
    if (!this.world.inBounds(tx, ty)) return;
    if (!this.world.isWithinReach(this.physState.x, this.physState.y, tx, ty)) return;
    if (!this.controller.canPunchNow(nowPerfMs)) return;

    this.controller.recordPunch(nowPerfMs, tx, this.physState.x);
    this.localPunchTarget = { tx, ty, at: Date.now() };
    this.audio.play('punch');
    this.mp.sendPunch(tx, ty);
  }

  private tryPlaceTile(tx: number, ty: number, itemId: number, wallClockNow: number): void {
    if (!this.profile) return;
    if (!this.controller.canPlaceNow(performance.now())) return;

    const others = Array.from(this.mp.remotePlayers.values()).map((p) => ({ x: p.x, y: p.y }));
    const check = this.blockSystem.validatePlaceClient(
      tx,
      ty,
      itemId,
      this.profile.id,
      this.physState.x,
      this.physState.y,
      others,
      this.world,
      this.inventory,
      wallClockNow
    );

    if (!check.ok) {
      if (check.reason && performance.now() - this.deniedCooldownMs > 650) {
        this.deniedCooldownMs = performance.now();
        this.blockSystem.spawnFloatingText(
          (tx + 0.5) * TILE_SIZE,
          ty * TILE_SIZE,
          check.reason,
          '#ff8888'
        );
      }
      return;
    }

    this.controller.recordPlace(performance.now(), tx, this.physState.x);
    this.mp.sendPlace(tx, ty, itemId);
  }

  private tryWrenchTile(tx: number, ty: number): void {
    if (!this.profile || !this.world.inBounds(tx, ty)) return;
    if (!this.world.isWithinReach(this.physState.x, this.physState.y, tx, ty)) {
      this.ui.showToast('Move closer to use Wrench!');
      return;
    }
    const tile = this.world.getTile(tx, ty);
    if (!tile || tile.fg === 0) return;

    if (tile.fg === ITEM_IDS.SIGN || tile.fg === ITEM_IDS.DOOR) {
      const perm = this.world.canPlayerModify(tx, ty, this.profile.id);
      if (!perm.ok) {
        this.ui.showToast(perm.reason || 'Locked!');
        return;
      }
      this.ui.openWrenchModal(
        tx,
        ty,
        tile.fg,
        tile.meta?.label ?? '',
        tile.meta?.targetWorld ?? 'START'
      );
    } else if (tile.fg === ITEM_IDS.WORLD_LOCK || tile.fg === ITEM_IDS.SMALL_LOCK) {
      const owner = tile.meta?.ownerName || this.world.ownerName || 'Unknown';
      this.ui.showToast(`${getItemDef(tile.fg)?.name} — Owned by ${owner}`);
    } else {
      const def = getItemDef(tile.fg);
      if (def) {
        this.ui.showToast(`${def.name} (Rarity ${def.rarity})`);
      }
    }
  }
}
