import {
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  TILE_SIZE,
} from '../../shared/constants';
import {
  findSpliceResult,
  getItemDef,
  ITEM_IDS,
  STORE_LISTINGS,
} from '../../shared/ItemRegistry';
import {
  DroppedItem,
  PlayerAnimState,
  PlayerNetState,
  PlayerProfile,
} from '../../shared/types';
import { generateWorld } from '../../shared/WorldGenerator';
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
  public isOffline = false;

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
        onPlayOffline: (username, skinColor) => {
          this.startOfflineMode(username, skinColor);
        },
        onRefreshWorlds: () => this.mp.fetchWorlds(),
        onSelectWorld: (worldName) => this.enterWorld(worldName),
        onLogout: () => {
          this.mp.disconnect();
          this.profile = null;
          this.isOffline = false;
          this.ui.showLoginScreen();
        },
        onSendChat: (text) => {
          if (this.isOffline) {
            const textTrim = text.trim();
            if (textTrim) {
              this.chat.pushMessage({
                id: Math.random().toString(36),
                senderId: 'local',
                senderName: this.profile?.username || 'You',
                text: textTrim,
                type: 'player',
                timestamp: Date.now(),
              });
              this.localChatBubble = {
                text: textTrim,
                expiresAt: Date.now() + 4000,
              };
              if (textTrim === '/help') {
                this.chat.pushMessage({
                  id: Math.random().toString(36),
                  senderId: 'sys',
                  senderName: 'SYSTEM',
                  text: '`2Offline Sandbox commands: /help, /gems`',
                  type: 'system',
                  timestamp: Date.now(),
                });
              } else if (textTrim === '/gems') {
                this.inventory.gems += 5000;
                this.audio.play('gem');
                this.chat.pushMessage({
                  id: Math.random().toString(36),
                  senderId: 'sys',
                  senderName: 'SYSTEM',
                  text: '`2+5,000 Gems added!`',
                  type: 'system',
                  timestamp: Date.now(),
                });
              }
            }
          } else {
            this.mp.sendChat(text);
          }
        },
        onDropItem: (itemId, count) => {
          if (this.isOffline) {
            if (this.inventory.removeItem(itemId, count)) {
              this.spawnOfflineDrop(
                itemId,
                count,
                Math.floor((this.physState.x + 10) / TILE_SIZE),
                Math.floor((this.physState.y + 14) / TILE_SIZE)
              );
              this.audio.play('ui');
            }
          } else {
            this.mp.sendDrop(itemId, count);
          }
        },
        onTrashItem: (itemId, count) => {
          if (this.isOffline) {
            this.inventory.removeItem(itemId, count);
            this.audio.play('break');
          } else {
            this.mp.sendTrash(itemId, count);
          }
        },
        onEquipItem: (itemId) => {
          if (this.isOffline) {
            this.inventory.toggleEquip(itemId);
            this.audio.play('ui');
          } else {
            this.mp.sendEquip(itemId);
          }
        },
        onStoreBuy: async (listingId) => {
          if (this.isOffline) {
            const listing = STORE_LISTINGS.find((l) => l.id === listingId);
            if (!listing) return { ok: false, message: 'Item not found.' };
            if (this.inventory.gems < listing.costGems) {
              return { ok: false, message: 'Not enough gems!' };
            }
            this.inventory.gems -= listing.costGems;
            if (Array.isArray(listing.grants)) {
              for (const g of listing.grants) {
                this.inventory.addItem(g.itemId, g.count);
              }
            } else if (listing.grants === 'random_basic_pack') {
              const packItems = [
                ITEM_IDS.WOOD_SEED,
                ITEM_IDS.GRASS_SEED,
                ITEM_IDS.BRICK_SEED,
                ITEM_IDS.GLASS_SEED,
                ITEM_IDS.SIGN_SEED,
                ITEM_IDS.TORCH_SEED,
              ];
              for (let i = 0; i < 15; i++) {
                const pick = packItems[Math.floor(Math.random() * packItems.length)];
                this.inventory.addItem(pick, 1);
              }
            } else if (listing.grants === 'random_farm_pack') {
              const packItems = [
                ITEM_IDS.SUGAR_CANE_SEED,
                ITEM_IDS.GOLD_SEED,
                ITEM_IDS.CRYSTAL_SEED,
                ITEM_IDS.CHANDELIER_SEED,
              ];
              for (let i = 0; i < 8; i++) {
                const pick = packItems[Math.floor(Math.random() * packItems.length)];
                this.inventory.addItem(pick, 1);
              }
            }
            this.audio.play('gem');
            return { ok: true, message: `Purchased ${listing.name}!` };
          }
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
          if (this.isOffline) {
            const tile = this.world.getTile(tx, ty);
            if (tile) {
              tile.meta = { ...tile.meta, label, targetWorld };
              this.world.setTile(tx, ty, tile);
              this.chat.pushMessage({
                id: Math.random().toString(36),
                senderId: 'sys',
                senderName: 'SYSTEM',
                text: '`2Tile settings updated!`',
                type: 'system',
                timestamp: Date.now(),
              });
            }
          } else {
            this.mp.sendWrenchEdit(tx, ty, label, targetWorld);
          }
        },
        onRespawn: () => this.respawnAtDoor('Respawned!'),
        onLeaveWorld: () => {
          if (this.isOffline) {
            this.profile = null;
            this.isOffline = false;
            this.ui.showLoginScreen();
          } else {
            this.leaveToWorldSelect();
          }
        },
        onDisconnectToTitle: () => {
          if (this.isOffline) {
            this.profile = null;
            this.isOffline = false;
            this.ui.showLoginScreen();
          } else {
            this.mp.disconnect();
            this.profile = null;
            this.ui.showLoginScreen();
          }
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
    if (!this.isOffline) {
      this.mp.sendRespawn();
    }
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
        if (this.isOffline) {
          this.chat.pushMessage({
            id: Math.random().toString(36),
            senderId: 'sys',
            senderName: 'SYSTEM',
            text: '`2Main door exit. Gunakan tombol Leave di menu untuk kembali ke title.`',
            type: 'system',
            timestamp: Date.now(),
          });
        } else {
          this.leaveToWorldSelect();
        }
        return;
      }
      if (standingTile?.fg === ITEM_IDS.DOOR && standingTile.meta?.targetWorld) {
        this.audio.play('warp');
        if (this.isOffline) {
          this.warpOfflineWorld(standingTile.meta.targetWorld);
        } else {
          this.enterWorld(standingTile.meta.targetWorld);
        }
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
      (uid) => {
        if (this.isOffline) {
          this.handleOfflinePickup(uid);
        } else {
          this.mp.sendPickup(uid);
        }
      }
    );

    // 5. Block Damage Auto-Heal, Particles, Multiplayer Sync & Camera
    this.world.tickBlockHealing(wallClockNow);
    this.blockSystem.updateEffects(dt);

    this.localAnim = this.controller.computeAnimState(this.physState, dt);
    if (!this.isOffline) {
      this.mp.sendMoveThrottled(
        nowPerfMs,
        this.physState.x,
        this.physState.y,
        this.physState.vx,
        this.physState.vy,
        this.controller.facing,
        this.localAnim
      );
    }
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
    if (this.isOffline) {
      this.handleOfflinePunch(tx, ty);
    } else {
      this.mp.sendPunch(tx, ty);
    }
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
    if (this.isOffline) {
      this.handleOfflinePlace(tx, ty, itemId, wallClockNow);
    } else {
      this.mp.sendPlace(tx, ty, itemId);
    }
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

  public startOfflineMode(username: string, skinColor: string): void {
    this.isOffline = true;
    this.profile = {
      id: 'local_host',
      username: username || 'Growtopian',
      skinColor: skinColor || '#f9d3a8',
      gems: 2500,
      inventory: [
        { itemId: ITEM_IDS.FIST, count: 1 },
        { itemId: ITEM_IDS.WRENCH, count: 1 },
        { itemId: ITEM_IDS.DIRT, count: 200 },
        { itemId: ITEM_IDS.ROCK, count: 100 },
        { itemId: ITEM_IDS.WOOD, count: 100 },
        { itemId: ITEM_IDS.DIRT_SEED, count: 50 },
        { itemId: ITEM_IDS.ROCK_SEED, count: 50 },
        { itemId: ITEM_IDS.WORLD_LOCK, count: 5 },
        { itemId: ITEM_IDS.DOOR, count: 10 },
        { itemId: ITEM_IDS.SIGN, count: 10 },
        { itemId: ITEM_IDS.PICKAXE, count: 1 },
        { itemId: ITEM_IDS.ANGEL_WINGS, count: 1 },
      ],
      maxSlots: 32,
      equipped: {
        hand: ITEM_IDS.PICKAXE,
        back: ITEM_IDS.ANGEL_WINGS,
      },
    };

    this.inventory.loadFromProfile(
      this.profile.inventory,
      this.profile.maxSlots,
      this.profile.gems,
      this.profile.equipped
    );

    const generated = generateWorld('SANDBOX');
    this.world.loadWorld({
      ...generated,
      ownerId: null,
      ownerName: null,
      drops: [],
      players: [],
    });

    this.physState.x = this.world.spawnX * TILE_SIZE + (TILE_SIZE - PLAYER_WIDTH) * 0.5;
    this.physState.y = this.world.spawnY * TILE_SIZE + (TILE_SIZE - PLAYER_HEIGHT);
    this.physState.vx = 0;
    this.physState.vy = 0;
    this.physState.grounded = false;
    this.physState.hurtTimer = 0;
    this.controller.clearInput();

    this.renderer.updateCamera(this.physState.x, this.physState.y, this.world, 0.016, true);
    this.ui.showGameHUD();
    this.blockSystem.spawnSparkles(
      this.physState.x + 10,
      this.physState.y + 14,
      '#ffffff',
      16
    );
    this.chat.pushMessage({
      id: 'offline_welcome',
      senderId: 'sys',
      senderName: 'SYSTEM',
      text: '`2GrokTopia Offline Sandbox aktif!` `wSemua block, seed, wings & pickaxe siap dicoba!',
      type: 'system',
      timestamp: Date.now(),
    });
    this.audio.play('warp');
  }

  public warpOfflineWorld(worldName: string): void {
    if (this.warping) return;
    this.warping = true;
    try {
      const targetName = worldName.toUpperCase().trim() || 'SANDBOX';
      const generated = generateWorld(targetName);
      this.world.loadWorld({
        ...generated,
        ownerId: null,
        ownerName: null,
        drops: [],
        players: [],
      });
      this.physState.x = this.world.spawnX * TILE_SIZE + (TILE_SIZE - PLAYER_WIDTH) * 0.5;
      this.physState.y = this.world.spawnY * TILE_SIZE + (TILE_SIZE - PLAYER_HEIGHT);
      this.physState.vx = 0;
      this.physState.vy = 0;
      this.physState.grounded = false;
      this.controller.clearInput();
      this.renderer.updateCamera(this.physState.x, this.physState.y, this.world, 0.016, true);
      this.chat.pushMessage({
        id: Math.random().toString(36),
        senderId: 'sys',
        senderName: 'SYSTEM',
        text: `\`2Warped to world ${targetName}!\``,
        type: 'system',
        timestamp: Date.now(),
      });
      this.audio.play('warp');
    } finally {
      this.warping = false;
    }
  }

  private handleOfflinePunch(tx: number, ty: number): void {
    if (!this.world.inBounds(tx, ty) || !this.profile) return;
    const tile = this.world.getTile(tx, ty);
    if (!tile || (tile.fg === 0 && tile.bg === 0)) return;

    const perm = this.world.canPlayerModify(tx, ty, this.profile.id);
    if (!perm.ok) {
      if (perm.reason) {
        this.blockSystem.spawnFloatingText((tx + 0.5) * TILE_SIZE, ty * TILE_SIZE, perm.reason, '#ff8888');
      }
      return;
    }

    const targetIsFg = tile.fg !== 0;
    const targetId = targetIsFg ? tile.fg : tile.bg;
    const def = getItemDef(targetId);
    if (!def || def.unbreakable) return;

    // Weather machine toggle
    if (targetIsFg && def.category === 'weather' && def.weatherTarget) {
      const next = this.world.weather === def.weatherTarget ? 'sunny' : def.weatherTarget;
      this.world.weather = next;
      this.chat.pushMessage({
        id: Math.random().toString(36),
        senderId: 'sys',
        senderName: 'SYSTEM',
        text: `\`2Weather changed to ${next}!\``,
        type: 'system',
        timestamp: Date.now(),
      });
      return;
    }

    // Growing / Mature Seed Tree
    const now = Date.now();
    if (targetIsFg && def.category === 'seed') {
      const plantedAt = tile.meta?.plantedAt ?? now;
      const growMs = tile.meta?.growTimeMs ?? (def.growTimeSec ?? 10) * 1000;
      const mature = now - plantedAt >= growMs;

      if (mature) {
        const fruitBlockId = def.blockId ?? ITEM_IDS.DIRT;
        const fruitDef = getItemDef(fruitBlockId);
        const fruitCount = 2 + Math.floor(Math.random() * 4);

        tile.fg = 0;
        tile.damage = 0;
        tile.lastHitAt = undefined;
        tile.meta = undefined;
        this.world.setTile(tx, ty, tile);

        this.audio.play('harvest');
        this.spawnOfflineDrop(fruitBlockId, fruitCount, tx, ty);
        if (Math.random() < 0.45) {
          this.spawnOfflineDrop(def.id, 1, tx, ty);
        }
        const [minG, maxG] = fruitDef?.gemDropRange ?? [1, 4];
        this.spawnOfflineGems(minG, maxG + 2, tx, ty);
        return;
      }

      // Unripe seed break
      tile.fg = 0;
      tile.damage = 0;
      tile.meta = undefined;
      this.world.setTile(tx, ty, tile);
      this.audio.play('break');
      if (Math.random() < 0.65) {
        this.spawnOfflineDrop(def.id, 1, tx, ty);
      }
      return;
    }

    // Standard block damage
    let dmg = 1;
    if (this.inventory.equipped.hand) {
      dmg += getItemDef(this.inventory.equipped.hand)?.bonusPunchDamage ?? 0;
    }

    if (tile.lastHitAt && now - tile.lastHitAt >= 5000) {
      tile.damage = 0;
    }
    tile.damage = (tile.damage ?? 0) + dmg;
    tile.lastHitAt = now;

    if (tile.damage < def.hitsToBreak) {
      this.world.setTile(tx, ty, tile);
      return;
    }

    // Block broken!
    if (targetIsFg) {
      if (targetId === ITEM_IDS.WORLD_LOCK) {
        this.world.ownerId = null;
        this.world.ownerName = null;
        this.chat.pushMessage({
          id: Math.random().toString(36),
          senderId: 'sys',
          senderName: 'SYSTEM',
          text: '`$World Lock broken! World is now unowned.`',
          type: 'system',
          timestamp: Date.now(),
        });
      }
      tile.fg = 0;
      tile.meta = undefined;
    } else {
      tile.bg = 0;
    }
    tile.damage = 0;
    tile.lastHitAt = undefined;
    this.world.setTile(tx, ty, tile);
    this.audio.play('break');

    if (def.category === 'lock' || def.category === 'weather') {
      this.spawnOfflineDrop(def.id, 1, tx, ty);
    } else {
      const roll = Math.random();
      if (roll < 0.35) {
        this.spawnOfflineDrop(def.id, 1, tx, ty);
      } else if (roll < 0.65 && def.seedId) {
        this.spawnOfflineDrop(def.seedId, 1, tx, ty);
      }
      if (def.gemDropRange) {
        this.spawnOfflineGems(def.gemDropRange[0], def.gemDropRange[1], tx, ty);
      }
    }
  }

  private handleOfflinePlace(tx: number, ty: number, itemId: number, wallClockNow: number): void {
    if (!this.profile) return;
    const def = getItemDef(itemId);
    if (!def) return;

    const tile = this.world.getTile(tx, ty);
    if (!tile) return;

    // 1. Seed planting & splicing
    if (def.category === 'seed') {
      if (ty + 1 >= this.world.height) return;
      const below = this.world.getTile(tx, ty + 1);
      const belowDef = below?.fg ? getItemDef(below.fg) : undefined;
      if (!belowDef || belowDef.collision !== 'solid') {
        this.blockSystem.spawnFloatingText((tx + 0.5) * TILE_SIZE, ty * TILE_SIZE, 'Plant on solid blocks!', '#ff8888');
        return;
      }

      if (tile.fg === 0) {
        if (!this.inventory.removeItem(itemId, 1)) return;
        tile.fg = itemId;
        tile.damage = 0;
        tile.meta = {
          plantedAt: wallClockNow,
          growTimeMs: (def.growTimeSec ?? 10) * 1000,
        };
        this.world.setTile(tx, ty, tile);
        this.audio.play('place');
        this.blockSystem.spawnSparkles((tx + 0.5) * TILE_SIZE, (ty + 0.5) * TILE_SIZE, '#80ff80', 8);
        return;
      }

      // Splicing
      const existingDef = getItemDef(tile.fg);
      if (existingDef?.category === 'seed') {
        const plantedAt = tile.meta?.plantedAt ?? wallClockNow;
        const growMs = tile.meta?.growTimeMs ?? (existingDef.growTimeSec ?? 10) * 1000;
        if (wallClockNow - plantedAt >= growMs) {
          this.blockSystem.spawnFloatingText((tx + 0.5) * TILE_SIZE, ty * TILE_SIZE, 'Harvest before splicing!', '#ff8888');
          return;
        }
        const spliced = findSpliceResult(tile.fg, itemId);
        if (!spliced) {
          this.blockSystem.spawnFloatingText((tx + 0.5) * TILE_SIZE, ty * TILE_SIZE, 'Cannot be spliced!', '#ff8888');
          return;
        }

        if (!this.inventory.removeItem(itemId, 1)) return;
        tile.fg = spliced.id;
        tile.damage = 0;
        tile.meta = {
          plantedAt: wallClockNow,
          growTimeMs: (spliced.growTimeSec ?? 16) * 1000,
        };
        this.world.setTile(tx, ty, tile);
        this.audio.play('place');
        this.blockSystem.spawnSparkles((tx + 0.5) * TILE_SIZE, (ty + 0.5) * TILE_SIZE, '#ffd700', 16);
        this.chat.pushMessage({
          id: Math.random().toString(36),
          senderId: 'sys',
          senderName: 'SYSTEM',
          text: `\`6SPLICE! \`wCombined \`2${existingDef.name}\`w + \`2${def.name}\`w into \`9${spliced.name.replace(' Seed', ' Tree')}\`w!`,
          type: 'system',
          timestamp: Date.now(),
        });
      }
      return;
    }

    // 2. Background block placement
    if (def.category === 'background') {
      if (tile.bg === itemId) return;
      if (!this.inventory.removeItem(itemId, 1)) return;
      tile.bg = itemId;
      this.world.setTile(tx, ty, tile);
      this.audio.play('place');
      return;
    }

    // 3. Foreground block placement
    if (tile.fg !== 0) return;
    if (!this.inventory.removeItem(itemId, 1)) return;
    tile.fg = itemId;
    tile.damage = 0;
    if (def.category === 'lock') {
      tile.meta = {
        ownerId: this.profile.id,
        ownerName: this.profile.username,
      };
      if (itemId === ITEM_IDS.WORLD_LOCK) {
        this.world.ownerId = this.profile.id;
        this.world.ownerName = this.profile.username;
        this.chat.pushMessage({
          id: Math.random().toString(36),
          senderId: 'sys',
          senderName: 'SYSTEM',
          text: `\`#${this.profile.username} \`$issued a World Lock on this world!`,
          type: 'system',
          timestamp: Date.now(),
        });
      }
    }
    this.world.setTile(tx, ty, tile);
    this.audio.play('place');
  }

  private spawnOfflineDrop(itemId: number, count: number, tx: number, ty: number): void {
    const uid = 'drop_' + Math.random().toString(36).slice(2, 9);
    const drop: DroppedItem = {
      uid,
      itemId,
      count,
      x: (tx + 0.5) * TILE_SIZE + (Math.random() * 8 - 4),
      y: (ty + 0.5) * TILE_SIZE,
      spawnedAt: Date.now(),
    };
    this.world.drops.set(uid, drop);
  }

  private spawnOfflineGems(min: number, max: number, tx: number, ty: number): void {
    let total = min + Math.floor(Math.random() * (max - min + 1));
    if (total <= 0) return;
    const denoms = [100, 25, 10, 5, 1];
    for (const d of denoms) {
      while (total >= d) {
        this.spawnOfflineDrop(0, d, tx, ty);
        total -= d;
      }
    }
  }

  private handleOfflinePickup(uid: string): void {
    const drop = this.world.drops.get(uid);
    if (!drop || !this.profile) return;
    this.world.drops.delete(uid);

    if (drop.itemId === 0) {
      this.inventory.gems += drop.count;
      this.audio.play('gem');
      this.blockSystem.spawnFloatingText(
        this.physState.x + 10,
        this.physState.y - 10,
        `+${drop.count} Gems`,
        '#00ffff'
      );
      this.ui.updateDynamicWorldBadge();
      return;
    }

    const added = this.inventory.addItem(drop.itemId, drop.count);
    if (added) {
      this.audio.play('pickup');
      const def = getItemDef(drop.itemId);
      this.blockSystem.spawnFloatingText(
        this.physState.x + 10,
        this.physState.y - 10,
        `+${drop.count} ${def?.name ?? 'Item'}`,
        '#ffe45e'
      );
    }
  }
}
