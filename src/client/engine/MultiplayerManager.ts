import { io, Socket } from 'socket.io-client';
import {
  ChatPacket,
  DroppedItem,
  EquippedItems,
  PlayerAnimState,
  PlayerNetState,
  PlayerProfile,
  TileData,
  WeatherType,
  WorldInitPayload,
  WorldSummary,
} from '../../shared/types';

export interface RemotePlayerInterp extends PlayerNetState {
  targetX: number;
  targetY: number;
}

export interface MultiplayerEvents {
  onProfileSync: (profile: PlayerProfile) => void;
  onTileUpdated: (ev: {
    tx: number;
    ty: number;
    tile: TileData;
    brokenId?: number;
    placedId?: number;
    harvested?: boolean;
    splicedName?: string;
  }) => void;
  onTileDamaged: (ev: { tx: number; ty: number; damage: number }) => void;
  onDropsAdded: (drops: DroppedItem[]) => void;
  onDropRemoved: (ev: { uid: string; pickedById: string; itemId: number; count: number }) => void;
  onWeatherChanged: (ev: { weather: WeatherType; by: string }) => void;
  onLockChanged: (ev: { ownerId: string | null; ownerName: string | null }) => void;
  onDenied: (ev: { tx: number; ty: number; reason: string }) => void;
  onChatMessage: (pkt: ChatPacket) => void;
  onTeleported: (ev: { id: string; x: number; y: number }) => void;
  onLocalEmote: (emote: 'wave' | 'dance') => void;
  onWarpRequest: (worldName: string) => void;
  onDisconnected: (reason: string) => void;
}

export class MultiplayerManager {
  private socket: Socket | null = null;
  public remotePlayers = new Map<string, RemotePlayerInterp>();
  public pingMs = 0;
  private pingTimer: number | null = null;
  private visibilityBound = false;
  private lastMoveSentAt = 0;
  private lastSentX = -9999;
  private lastSentY = -9999;
  private lastSentVx = 0;
  private lastSentVy = 0;
  private lastSentFacing: -1 | 1 = 1;
  private lastSentAnim: PlayerAnimState = 'idle';

  constructor(private handlers: MultiplayerEvents) {}

  public connect(): Promise<void> {
    if (this.socket?.connected) return Promise.resolve();

    return new Promise((resolve, reject) => {
      if (this.socket) {
        this.socket.disconnect();
      }

      const serverUrl = (import.meta.env.VITE_SERVER_URL as string) || undefined;
      this.socket = io(serverUrl, {
        transports: ['websocket', 'polling'],
        reconnection: false,
      });

      const timeout = window.setTimeout(() => {
        reject(new Error('Connection timed out. Is the GrokTopia server running?'));
      }, 6000);

      this.socket.once('connect', () => {
        window.clearTimeout(timeout);
        this.startPingLoop();
        resolve();
      });

      this.socket.once('connect_error', (err) => {
        window.clearTimeout(timeout);
        reject(err);
      });

      this.bindSocketEvents(this.socket);
    });
  }

  private startPingLoop(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    const measure = () => {
      if (!this.socket?.connected) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      const t0 = performance.now();
      this.socket.emit('ping:check', t0, () => {
        if (typeof document !== 'undefined' && document.hidden) return;
        this.pingMs = Math.max(1, Math.round(performance.now() - t0));
      });
    };
    measure();
    this.pingTimer = window.setInterval(measure, 4000);
    if (!this.visibilityBound && typeof document !== 'undefined') {
      this.visibilityBound = true;
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) measure();
      });
    }
  }

  private bindSocketEvents(sock: Socket): void {
    sock.on('profile:sync', (profile: PlayerProfile) => {
      this.handlers.onProfileSync(profile);
    });

    sock.on('player:joined', (p: PlayerNetState) => {
      this.remotePlayers.set(p.id, { ...p, targetX: p.x, targetY: p.y });
    });

    sock.on('player:left', (playerId: string) => {
      this.remotePlayers.delete(playerId);
    });

    sock.on(
      'player:moved',
      (m: {
        id: string;
        x: number;
        y: number;
        vx: number;
        vy: number;
        facing: -1 | 1;
        anim: PlayerAnimState;
      }) => {
        const rp = this.remotePlayers.get(m.id);
        if (rp) {
          rp.targetX = m.x;
          rp.targetY = m.y;
          rp.vx = m.vx;
          rp.vy = m.vy;
          rp.facing = m.facing;
          rp.anim = m.anim;
        }
      }
    );

    sock.on('player:punched', (ev: { id: string; tx: number; ty: number }) => {
      const rp = this.remotePlayers.get(ev.id);
      if (rp) {
        rp.anim = 'punch';
        rp.punchTarget = { tx: ev.tx, ty: ev.ty, at: Date.now() };
      }
    });

    sock.on('player:equippedChanged', (ev: { id: string; equipped: EquippedItems }) => {
      const rp = this.remotePlayers.get(ev.id);
      if (rp) {
        rp.equipped = ev.equipped;
      }
    });

    sock.on('player:teleported', (ev: { id: string; x: number; y: number }) => {
      const rp = this.remotePlayers.get(ev.id);
      if (rp) {
        rp.x = ev.x;
        rp.y = ev.y;
        rp.targetX = ev.x;
        rp.targetY = ev.y;
      }
      this.handlers.onTeleported(ev);
    });

    sock.on('player:localEmote', (emote: 'wave' | 'dance') => {
      this.handlers.onLocalEmote(emote);
    });

    sock.on('client:warpRequest', (worldName: string) => {
      this.handlers.onWarpRequest(worldName);
    });

    sock.on('world:tileUpdated', (ev) => this.handlers.onTileUpdated(ev));
    sock.on('world:tileDamaged', (ev) => this.handlers.onTileDamaged(ev));
    sock.on('world:dropsAdded', (drops) => this.handlers.onDropsAdded(drops));
    sock.on('world:dropRemoved', (ev) => this.handlers.onDropRemoved(ev));
    sock.on('world:weather', (ev) => this.handlers.onWeatherChanged(ev));
    sock.on('world:lockChanged', (ev) => this.handlers.onLockChanged(ev));
    sock.on('world:denied', (ev) => this.handlers.onDenied(ev));

    sock.on('chat:message', (pkt: ChatPacket) => {
      if (pkt.type === 'player') {
        const rp = this.remotePlayers.get(pkt.senderId);
        if (rp) {
          rp.chatBubble = {
            text: pkt.text,
            expiresAt: performance.now() + 5500,
          };
        }
      }
      this.handlers.onChatMessage(pkt);
    });

    sock.on('session:kicked', (reason: string) => {
      this.disconnect();
      this.handlers.onDisconnected(reason || 'Session ended.');
    });

    sock.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') {
        this.handlers.onDisconnected('Lost connection to GrokTopia server.');
      }
    });
  }

  public disconnect(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.remotePlayers.clear();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  public get isConnected(): boolean {
    return !!this.socket?.connected;
  }

  public async login(
    username: string,
    password: string,
    skinColor: string
  ): Promise<{ ok: boolean; profile?: PlayerProfile; worlds?: WorldSummary[]; error?: string }> {
    await this.connect();
    return new Promise((resolve) => {
      this.socket!.emit('auth:login', { username, password, skinColor }, resolve);
    });
  }

  public fetchWorlds(): Promise<WorldSummary[]> {
    if (!this.socket?.connected) return Promise.resolve([]);
    return new Promise((resolve) => {
      this.socket!.emit('worlds:list', resolve);
    });
  }

  public joinWorld(
    worldName: string
  ): Promise<{ ok: boolean; world?: WorldInitPayload; error?: string }> {
    if (!this.socket?.connected) {
      return Promise.resolve({ ok: false, error: 'Not connected.' });
    }
    return new Promise((resolve) => {
      this.socket!.emit('world:join', worldName, (res: { ok: boolean; world?: WorldInitPayload; error?: string }) => {
        if (res.ok && res.world) {
          this.lastSentX = -9999;
          this.lastSentY = -9999;
          this.remotePlayers.clear();
          for (const p of res.world.players) {
            this.remotePlayers.set(p.id, { ...p, targetX: p.x, targetY: p.y });
          }
        }
        resolve(res);
      });
    });
  }

  public leaveWorld(): void {
    this.remotePlayers.clear();
    this.socket?.emit('world:leave');
  }

  public sendMoveThrottled(
    nowMs: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    facing: -1 | 1,
    anim: PlayerAnimState
  ): void {
    if (!this.socket?.connected) return;
    const posChanged = Math.abs(x - this.lastSentX) > 0.25 || Math.abs(y - this.lastSentY) > 0.25;
    const velChanged = Math.abs(vx - this.lastSentVx) > 0.5 || Math.abs(vy - this.lastSentVy) > 0.5;
    const stateChanged = anim !== this.lastSentAnim || facing !== this.lastSentFacing;

    if (!posChanged && !velChanged && !stateChanged) return;
    if (!stateChanged && nowMs - this.lastMoveSentAt < 55) return; // ~18Hz smooth active movement sync

    this.lastMoveSentAt = nowMs;
    this.lastSentX = x;
    this.lastSentY = y;
    this.lastSentVx = vx;
    this.lastSentVy = vy;
    this.lastSentFacing = facing;
    this.lastSentAnim = anim;
    this.socket.emit('player:move', { x, y, vx, vy, facing, anim });
  }

  public interpolateRemotePlayers(dt: number): void {
    const alpha = Math.min(1, dt * 15);
    for (const rp of this.remotePlayers.values()) {
      const dx = rp.targetX - rp.x;
      const dy = rp.targetY - rp.y;
      if (Math.hypot(dx, dy) > 160) {
        rp.x = rp.targetX;
        rp.y = rp.targetY;
      } else {
        rp.x += dx * alpha;
        rp.y += dy * alpha;
      }
    }
  }

  public sendPunch(tx: number, ty: number): void {
    this.socket?.emit('world:punch', { tx, ty });
  }

  public sendPlace(tx: number, ty: number, itemId: number): void {
    this.socket?.emit('world:place', { tx, ty, itemId });
  }

  public sendPickup(uid: string): void {
    this.socket?.emit('world:pickup', { uid });
  }

  public sendDrop(itemId: number, count: number): void {
    this.socket?.emit('inventory:drop', { itemId, count });
  }

  public sendTrash(itemId: number, count: number): void {
    this.socket?.emit('inventory:trash', { itemId, count });
  }

  public sendEquip(itemId: number): void {
    this.socket?.emit('inventory:equip', { itemId });
  }

  public sendWrenchEdit(tx: number, ty: number, label: string, targetWorld?: string): void {
    this.socket?.emit('world:wrench', { tx, ty, label, targetWorld });
  }

  public buyStoreItem(
    listingId: string
  ): Promise<{ ok: boolean; message?: string; profile?: PlayerProfile }> {
    if (!this.socket?.connected) {
      return Promise.resolve({ ok: false, message: 'Disconnected.' });
    }
    return new Promise((resolve) => {
      this.socket!.emit('store:buy', listingId, resolve);
    });
  }

  public sendChat(text: string): void {
    this.socket?.emit('chat:send', text);
  }

  public sendRespawn(): void {
    this.socket?.emit('player:respawn');
  }
}
