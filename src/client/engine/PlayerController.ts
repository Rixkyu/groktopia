import {
  PLACE_COOLDOWN_MS,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  PUNCH_COOLDOWN_MS,
  TILE_SIZE,
} from '../../shared/constants';
import { PlayerAnimState } from '../../shared/types';
import { PhysicsInput, PhysicsState } from './PhysicsEngine';

export class PlayerController {
  private keys = new Set<string>();
  private jumpJustPressed = false;
  private interactJustPressed = false;

  public pointerScreenX = 0;
  public pointerScreenY = 0;
  public pointerDown = false;
  public pointerRightClicked = false;

  public facing: -1 | 1 = 1;
  public punchAnimTimer = 0;
  public emoteAnim: 'wave' | 'dance' | null = null;
  public emoteTimer = 0;

  private lastPunchAt = 0;
  private lastPlaceAt = 0;
  public uiBlockingInput = false;

  public attachListeners(
    canvas: HTMLCanvasElement,
    onToggleTool: () => void,
    onFocusChat: (prefill?: string) => void,
    onEscape: () => void,
    onZoom: (direction: number) => void
  ): void {
    window.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement?.tagName;
      const inInput = activeTag === 'INPUT' || activeTag === 'TEXTAREA';

      if (e.key === 'Escape') {
        onEscape();
        return;
      }

      if (inInput) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        onFocusChat();
        return;
      }

      // Real Growtopia (PC): "/" opens chat with a slash already typed.
      if (e.key === '/') {
        e.preventDefault();
        onFocusChat('/');
        return;
      }

      // Real Growtopia (PC): Tab swaps Fist <-> Wrench.
      if (e.key === 'Tab') {
        e.preventDefault();
        onToggleTool();
        return;
      }

      // Real Growtopia (PC): F3 / F4 zoom out / in (mouse wheel too).
      if (e.key === 'F3' || e.key === 'F4') {
        e.preventDefault();
        onZoom(e.key === 'F4' ? -1 : 1);
        return;
      }

      if (this.uiBlockingInput) return;

      const code = e.code;
      const isJumpKey =
        code === 'KeyW' ||
        code === 'ArrowUp' ||
        code === 'Space' ||
        code === 'ControlLeft' ||
        code === 'ControlRight';
      if (!this.keys.has(code)) {
        if (isJumpKey) {
          this.jumpJustPressed = true;
        }
        if (code === 'KeyW' || code === 'ArrowUp') {
          this.interactJustPressed = true;
        }
      }
      this.keys.add(code);

      if (code === 'KeyA' || code === 'ArrowLeft') {
        this.facing = -1;
        this.emoteAnim = null;
      } else if (code === 'KeyD' || code === 'ArrowRight') {
        this.facing = 1;
        this.emoteAnim = null;
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.pointerDown = false;
    });

    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.pointerScreenX = e.clientX - rect.left;
      this.pointerScreenY = e.clientY - rect.top;
    });

    canvas.addEventListener('pointerdown', (e) => {
      if (this.uiBlockingInput) return;
      const rect = canvas.getBoundingClientRect();
      this.pointerScreenX = e.clientX - rect.left;
      this.pointerScreenY = e.clientY - rect.top;
      if (e.button === 2) {
        this.pointerRightClicked = true;
      } else if (e.button === 0) {
        this.pointerDown = true;
      }
    });

    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) {
        this.pointerDown = false;
      }
    });
    window.addEventListener('pointercancel', () => {
      this.pointerDown = false;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener(
      'wheel',
      (e) => {
        if (this.uiBlockingInput) return;
        e.preventDefault();
        onZoom(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false }
    );
  }

  public clearInput(): void {
    this.keys.clear();
    this.pointerDown = false;
    this.actionHeld = false;
    this.jumpJustPressed = false;
    this.interactJustPressed = false;
  }

  public consumePhysicsInput(hasDoubleJump: boolean): PhysicsInput {
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    const moveDir: -1 | 0 | 1 = left && !right ? -1 : right && !left ? 1 : 0;
    if (moveDir !== 0) {
      this.facing = moveDir;
      this.emoteAnim = null;
    }
    const jumpHeld =
      this.keys.has('KeyW') ||
      this.keys.has('ArrowUp') ||
      this.keys.has('Space') ||
      this.keys.has('ControlLeft') ||
      this.keys.has('ControlRight');
    const downHeld = this.keys.has('KeyS') || this.keys.has('ArrowDown');

    const jp = this.jumpJustPressed;
    this.jumpJustPressed = false;

    return {
      moveDir,
      jumpHeld,
      jumpJustPressed: jp,
      downHeld,
      hasDoubleJump,
    };
  }

  public consumeDoorInteract(): boolean {
    const v = this.interactJustPressed;
    this.interactJustPressed = false;
    return v;
  }

  public consumeRightClick(): boolean {
    const v = this.pointerRightClicked;
    this.pointerRightClicked = false;
    return v;
  }

  /** On-screen punch/use button (touch devices). Real PC Growtopia has no keyboard punch. */
  public actionHeld = false;

  public isActionHeld(): boolean {
    return this.actionHeld;
  }

  /** Virtual D-pad / jump buttons for touch devices. */
  public setVirtualKey(code: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp', down: boolean): void {
    if (!down) {
      this.keys.delete(code);
      return;
    }
    if (this.uiBlockingInput) return;
    if (!this.keys.has(code) && code === 'ArrowUp') {
      this.jumpJustPressed = true;
      this.interactJustPressed = true;
    }
    this.keys.add(code);
    if (code === 'ArrowLeft') this.facing = -1;
    else if (code === 'ArrowRight') this.facing = 1;
    this.emoteAnim = null;
  }

  public canPunchNow(nowMs: number): boolean {
    return nowMs - this.lastPunchAt >= PUNCH_COOLDOWN_MS;
  }

  public recordPunch(nowMs: number, targetTileX: number, playerX: number): void {
    this.lastPunchAt = nowMs;
    this.punchAnimTimer = 0.22;
    this.emoteAnim = null;
    const targetWorldX = (targetTileX + 0.5) * TILE_SIZE;
    const playerCenterX = playerX + PLAYER_WIDTH * 0.5;
    this.facing = targetWorldX >= playerCenterX ? 1 : -1;
  }

  public canPlaceNow(nowMs: number): boolean {
    return nowMs - this.lastPlaceAt >= PLACE_COOLDOWN_MS;
  }

  public recordPlace(nowMs: number, targetTileX: number, playerX: number): void {
    this.lastPlaceAt = nowMs;
    this.punchAnimTimer = 0.16;
    const targetWorldX = (targetTileX + 0.5) * TILE_SIZE;
    const playerCenterX = playerX + PLAYER_WIDTH * 0.5;
    this.facing = targetWorldX >= playerCenterX ? 1 : -1;
  }

  public triggerEmote(emote: 'wave' | 'dance', durationSec = 3.5): void {
    this.emoteAnim = emote;
    this.emoteTimer = durationSec;
  }

  public getHoveredTile(cameraX: number, cameraY: number, zoom: number): { tx: number; ty: number } {
    const worldX = cameraX + this.pointerScreenX / zoom;
    const worldY = cameraY + this.pointerScreenY / zoom;
    return {
      tx: Math.floor(worldX / TILE_SIZE),
      ty: Math.floor(worldY / TILE_SIZE),
    };
  }

  public computeAnimState(phys: PhysicsState, dt: number): PlayerAnimState {
    if (this.punchAnimTimer > 0) {
      this.punchAnimTimer = Math.max(0, this.punchAnimTimer - dt);
    }
    if (this.emoteTimer > 0) {
      this.emoteTimer = Math.max(0, this.emoteTimer - dt);
      if (this.emoteTimer <= 0) this.emoteAnim = null;
    }

    if (phys.hurtTimer > 0) return 'hurt';
    if (this.punchAnimTimer > 0) return 'punch';
    if (!phys.grounded) {
      return phys.vy < 0 ? 'jump' : 'fall';
    }
    if (Math.abs(phys.vx) > 12) return 'walk';
    if (this.emoteAnim) return this.emoteAnim;
    return 'idle';
  }

  public getFrontTile(playerX: number, playerY: number): { tx: number; ty: number } {
    const cx = playerX + PLAYER_WIDTH * 0.5 + this.facing * TILE_SIZE;
    const cy = playerY + PLAYER_HEIGHT * 0.5;
    return {
      tx: Math.floor(cx / TILE_SIZE),
      ty: Math.floor(cy / TILE_SIZE),
    };
  }
}
