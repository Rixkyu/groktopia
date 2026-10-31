import { HOTBAR_SLOTS } from '../../shared/constants';
import {
  getItemDef,
  ITEM_IDS,
  SPLICE_RECIPES,
  STORE_LISTINGS,
} from '../../shared/ItemRegistry';
import {
  ChatPacket,
  EquipSlot,
  PlayerProfile,
  StoreListing,
  WorldSummary,
} from '../../shared/types';
import { AudioManager } from './AudioManager';
import { ChatManager } from './ChatManager';
import { InventorySystem } from './InventorySystem';
import { SpriteAtlas } from './SpriteAtlas';
import { WorldManager } from './WorldManager';

export type ScreenMode = 'login' | 'world_select' | 'playing' | 'disconnected';
export type ModalType =
  | null
  | 'store'
  | 'recipes'
  | 'wrench'
  | 'world_info'
  | 'item_info'
  | 'pause';

export interface UICallbacks {
  onLoginSubmit: (username: string, password: string, skinColor: string) => Promise<string | null>;
  onPlayOffline: (username: string, skinColor: string) => void;
  onRefreshWorlds: () => Promise<WorldSummary[]>;
  onSelectWorld: (worldName: string) => Promise<string | null>;
  onLogout: () => void;
  onSendChat: (text: string) => void;
  onDropItem: (itemId: number, count: number) => void;
  onTrashItem: (itemId: number, count: number) => void;
  onEquipItem: (itemId: number) => void;
  onStoreBuy: (listingId: string) => Promise<{ ok: boolean; message?: string }>;
  onWrenchSave: (tx: number, ty: number, label: string, targetWorld?: string) => void;
  onRespawn: () => void;
  onLeaveWorld: () => void;
  onDisconnectToTitle: () => void;
  onChangeZoom: (zoom: number) => void;
  onToggleGrid: (show: boolean) => void;
  onVirtualKey: (code: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp', down: boolean) => void;
  onVirtualAction: (down: boolean) => void;
  getOnlinePlayerNames: () => string[];
  getPingMs: () => number;
  getPlayerTileCoords: () => { tx: number; ty: number };
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class UIManager {
  public screen: ScreenMode = 'login';
  public activeModal: ModalType = null;
  public backpackOpen = false;
  public chatSize: 'collapsed' | 'normal' | 'expanded' = 'normal';
  public chatInputOpen = false;

  private root: HTMLElement;
  private iconDataCache = new Map<string, string>();
  private selectedDrawerItemId: number = ITEM_IDS.FIST;
  private storeFilter: 'all' | StoreListing['category'] = 'all';

  // Login & World Select state
  private savedUsername =
    localStorage.getItem('groktopia_growid') || `Grower${Math.floor(100 + Math.random() * 899)}`;
  private selectedSkin = localStorage.getItem('groktopia_skin') || '#f2b885';
  private loginError: string | null = null;
  private lastProfile: PlayerProfile | null = null;
  private worldList: WorldSummary[] = [];
  private disconnectReason = '';

  // Wrench modal target
  private wrenchTarget: {
    tx: number;
    ty: number;
    fg: number;
    label: string;
    targetWorld: string;
  } | null = null;

  // Live HUD elements
  private hudGemValueEl: HTMLElement | null = null;
  private chatLogEl: HTMLElement | null = null;
  private chatInputEl: HTMLInputElement | null = null;
  private toastEl: HTMLElement | null = null;
  private toastTimer: number | null = null;
  private currentZoom = 1;
  private currentGrid = false;

  constructor(
    rootEl: HTMLElement,
    private atlas: SpriteAtlas,
    private inventory: InventorySystem,
    private world: WorldManager,
    private chat: ChatManager,
    private audio: AudioManager,
    private callbacks: UICallbacks
  ) {
    this.root = rootEl;
    this.inventory.onChange(() => {
      if (this.screen === 'playing') {
        this.refreshHudInventoryOnly();
      }
    });
    this.chat.onMessage((msg) => {
      if (this.screen === 'playing') {
        this.appendChatLine(msg);
      }
    });
  }

  public refreshAfterAssetsLoaded(): void {
    this.iconDataCache.clear();
    if (this.screen === 'login') {
      this.drawPreviewAvatar();
    } else if (this.screen === 'world_select' && this.lastProfile) {
      const worldInput = document.getElementById('world-name-input') as HTMLInputElement | null;
      const typedWorld = worldInput?.value;
      const hadFocus = worldInput && document.activeElement === worldInput;
      this.renderWorldSelectScreen(this.lastProfile);
      const nextInput = document.getElementById('world-name-input') as HTMLInputElement | null;
      if (nextInput && typedWorld !== undefined) {
        nextInput.value = typedWorld;
        if (hadFocus) nextInput.focus();
      }
    } else if (this.screen === 'playing') {
      this.refreshHudInventoryOnly();
      this.renderModalOnly();
    }
  }

  private getIconUrl(itemId: number): string {
    const key = `item:${itemId}`;
    let url = this.iconDataCache.get(key);
    if (!url) {
      const c = this.atlas.getItemIcon(itemId);
      url = c ? c.toDataURL() : '';
      if (url) {
        this.iconDataCache.set(key, url);
      }
    }
    return url;
  }

  public showToast(text: string): void {
    if (this.toastEl) {
      this.toastEl.remove();
      this.toastEl = null;
    }
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
    }
    const div = document.createElement('div');
    div.className = 'toast-banner';
    div.textContent = ChatManager.stripColorCodes(text);
    this.root.appendChild(div);
    this.toastEl = div;
    this.toastTimer = window.setTimeout(() => {
      div.remove();
      if (this.toastEl === div) this.toastEl = null;
    }, 2600);
  }

  public showLoginScreen(errorMsg?: string): void {
    this.screen = 'login';
    this.activeModal = null;
    this.loginError = errorMsg ?? null;
    this.renderLoginScreen();
  }

  public showWorldSelect(profile: PlayerProfile, worlds: WorldSummary[]): void {
    this.screen = 'world_select';
    this.activeModal = null;
    this.lastProfile = profile;
    this.worldList = worlds;
    this.renderWorldSelectScreen(profile);
  }

  public showGameHUD(): void {
    this.screen = 'playing';
    this.activeModal = null;
    this.backpackOpen = false;
    this.chatInputOpen = false;
    this.renderGameHUD();
  }

  public showDisconnected(reason: string): void {
    this.screen = 'disconnected';
    this.activeModal = null;
    this.disconnectReason = reason;
    this.renderDisconnectedScreen();
  }

  public toggleBackpack(): void {
    if (this.screen !== 'playing') return;
    this.audio.play('ui');
    this.backpackOpen = !this.backpackOpen;
    this.refreshHudInventoryOnly();
  }

  public focusChatInput(prefill?: string): void {
    if (this.screen !== 'playing') return;
    this.chatInputOpen = true;
    const bar = document.getElementById('hud-chat-input-bar');
    if (bar) bar.classList.add('open');
    if (this.chatInputEl) {
      if (prefill !== undefined) this.chatInputEl.value = prefill;
      this.chatInputEl.focus();
    }
  }

  public closeChatInput(): void {
    this.chatInputOpen = false;
    const bar = document.getElementById('hud-chat-input-bar');
    if (bar) bar.classList.remove('open');
    this.chatInputEl?.blur();
  }

  public handleEscapeKey(): void {
    if (this.screen !== 'playing') return;
    this.audio.play('ui');
    if (this.chatInputOpen) {
      this.closeChatInput();
      return;
    }
    if (this.activeModal !== null) {
      this.activeModal = null;
      this.renderModalOnly();
      return;
    }
    if (this.backpackOpen) {
      this.backpackOpen = false;
      this.refreshHudInventoryOnly();
      return;
    }
    this.activeModal = 'pause';
    this.renderModalOnly();
  }

  public openWrenchModal(
    tx: number,
    ty: number,
    fg: number,
    label: string,
    targetWorld: string
  ): void {
    this.wrenchTarget = { tx, ty, fg, label, targetWorld };
    this.activeModal = 'wrench';
    this.audio.play('ui');
    this.renderModalOnly();
  }

  public isModalBlockingInput(): boolean {
    return this.screen !== 'playing' || this.activeModal !== null || this.chatInputOpen;
  }

  // --- 1. LOGIN / MAIN MENU SCREEN ---
  private renderLoginScreen(): void {
    const skins = ['#f2b885', '#ffdbb5', '#d9955b', '#9e6234', '#633a1d', '#8fd9a8', '#9ecaff'];

    this.root.innerHTML = `
      <div class="screen-center">
        <div class="logo-banner">
          <div class="gt-title-logo" role="img" aria-label="Growtopia"></div>
          <div class="logo-sub">Punch! Build! Splice Seeds! Grow Worlds Together!</div>
        </div>

        <div class="gt-panel login-card">
          <div class="gt-header-bar">
            <span>GrowID Connect</span>
            <span style="font-size:13px;color:#82f78e;">Online Sandbox</span>
          </div>

          ${this.loginError ? `<div class="error-banner">${escapeHtml(this.loginError)}</div>` : ''}

          <div class="login-grid">
            <div>
              <label class="field-label" for="login-growid">GrowID (Player Name)</label>
              <input id="login-growid" class="gt-input" maxlength="16" value="${escapeHtml(this.savedUsername)}" placeholder="Enter GrowID..." />

              <label class="field-label" for="login-pass" style="margin-top:10px;">Passcode (Protects your GrowID)</label>
              <input id="login-pass" type="password" class="gt-input" maxlength="24" value="grok123" placeholder="Passcode..." />

              <span class="field-label" style="margin-top:10px;">Skin Color</span>
              <div class="skin-row" id="skin-swatches">
                ${skins
                  .map(
                    (col) =>
                      `<div class="skin-swatch ${col === this.selectedSkin ? 'active' : ''}" data-skin="${col}" style="background:${col};"></div>`
                  )
                  .join('')}
              </div>
            </div>

            <div class="preview-box">
              <canvas id="avatar-preview-canvas" width="96" height="96" style="image-rendering:pixelated;"></canvas>
              <span style="font-size:12px;color:#fff282;margin-top:2px;">Growtopian</span>
            </div>
          </div>

          <div style="display:flex;gap:8px;margin-top:14px;">
            <button id="btn-play-online" class="gt-btn gt-btn-green" style="flex:1;padding:8px 14px;font-size:16px;">
              Connect
            </button>
            <button id="btn-play-offline" class="gt-btn gt-btn-blue" style="flex:1.2;padding:8px 12px;font-size:16px;">
              Play Offline (Sandbox)
            </button>
          </div>

          <div class="status-strip">
            <span id="server-status-text">Checking server...</span>
            <span style="color:#ffe45e;">WASD / Arrows / Space / Ctrl: Move & Jump • Tab: Tool</span>
          </div>
        </div>
      </div>
    `;

    this.drawPreviewAvatar();

    const serverUrl = (import.meta.env.VITE_SERVER_URL as string) || '';
    const statusUrl = serverUrl ? `${serverUrl.replace(/\/$/, '')}/api/status` : '/api/status';
    fetch(statusUrl)
      .then((r) => r.json())
      .then((data: { onlinePlayers?: number; activeWorlds?: number }) => {
        const el = document.getElementById('server-status-text');
        if (el) {
          el.textContent = `${data.onlinePlayers ?? 0} Players Online • ${data.activeWorlds ?? 0} Active Worlds`;
        }
      })
      .catch(() => {
        const el = document.getElementById('server-status-text');
        if (el) el.textContent = 'Server Offline • Klik "Play Offline (Sandbox)" untuk main langsung!';
      });

    this.root.querySelectorAll('.skin-swatch').forEach((el) => {
      el.addEventListener('click', () => {
        this.audio.unlock();
        this.audio.play('ui');
        const nameInput = document.getElementById('login-growid') as HTMLInputElement | null;
        if (nameInput) this.savedUsername = nameInput.value;
        this.selectedSkin = (el as HTMLElement).dataset.skin || '#f2b885';
        localStorage.setItem('groktopia_skin', this.selectedSkin);
        this.renderLoginScreen();
      });
    });

    const submitLogin = async () => {
      this.audio.unlock();
      this.audio.play('ui');
      const nameInput = document.getElementById('login-growid') as HTMLInputElement;
      const passInput = document.getElementById('login-pass') as HTMLInputElement;
      const btn = document.getElementById('btn-play-online') as HTMLButtonElement;
      const uname = nameInput.value.trim();
      const pw = passInput.value;
      this.savedUsername = uname;
      localStorage.setItem('groktopia_growid', uname);

      btn.disabled = true;
      btn.textContent = 'Connecting...';
      const err = await this.callbacks.onLoginSubmit(uname, pw, this.selectedSkin);
      if (err) {
        this.showLoginScreen('WebSocket Error: Server belum aktif. Klik "Play Offline (Sandbox)" untuk main langsung!');
      }
    };

    document.getElementById('btn-play-online')?.addEventListener('click', submitLogin);
    document.getElementById('btn-play-offline')?.addEventListener('click', () => {
      this.audio.unlock();
      this.audio.play('ui');
      const nameInput = document.getElementById('login-growid') as HTMLInputElement | null;
      const uname = nameInput ? nameInput.value.trim() : '';
      this.callbacks.onPlayOffline(uname || 'Growtopian', this.selectedSkin);
    });
    document.getElementById('login-growid')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitLogin();
    });
    document.getElementById('login-pass')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitLogin();
    });
  }

  private drawPreviewAvatar(): void {
    const c = document.getElementById('avatar-preview-canvas') as HTMLCanvasElement | null;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    this.atlas.drawCharacter(ctx, 22, 16, 2.5, 1, 'idle', this.selectedSkin, {}, performance.now());
  }

  // --- 2. WORLD SELECTION SCREEN ---
  private renderWorldSelectScreen(profile: PlayerProfile): void {
    this.root.innerHTML = `
      <div class="screen-center world-select-backdrop">
        <div class="logo-banner" style="margin-bottom:8px;">
          <div class="gt-title-logo" style="width:min(300px, 68vw);" role="img" aria-label="Growtopia"></div>
        </div>

        <div class="gt-panel world-select-card">
          <div class="gt-header-bar">
            <span>Select a World — Welcome, ${escapeHtml(profile.username)}!</span>
            <div class="gt-gems-display" style="cursor:default;">
              <span class="gt-gem-number">${profile.gems.toLocaleString()}</span>
              <img class="gt-gem-icon" src="/assets/gt/ui/cash_icon_overlay.png" alt="Gems" />
            </div>
          </div>

          <label class="field-label" for="world-name-input">Enter World Name (Creates a new 100x60 world automatically if unvisited!)</label>
          <div class="world-enter-row">
            <input id="world-name-input" class="gt-input" maxlength="20" value="START" placeholder="START, FARM, TRADE, PARKOUR..." style="text-transform:uppercase;" />
            <button id="btn-enter-world" class="gt-btn gt-btn-green" style="white-space:nowrap;padding:4px 18px;font-size:16px;">
              Enter World
            </button>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span class="field-label" style="margin:0;color:#ffe678;">Active & Featured Worlds</span>
            <div style="display:flex;gap:6px;">
              <button id="btn-refresh-worlds" class="gt-btn gt-btn-blue hud-btn-sm">Refresh</button>
              <button id="btn-logout" class="gt-btn gt-btn-red hud-btn-sm">Back</button>
            </div>
          </div>

          <div class="worlds-grid" id="worlds-grid-list">
            ${this.worldList
              .map(
                (w) => `
              <button class="world-pill" data-world="${escapeHtml(w.name)}">
                <div class="world-pill-top">
                  <span>${escapeHtml(w.name)}</span>
                  <span class="world-count-badge">${w.playerCount}</span>
                </div>
                <div class="world-pill-sub">
                  ${w.ownerName ? `WL: ${escapeHtml(w.ownerName)}` : `Public (${escapeHtml(w.weather)})`}
                </div>
              </button>
            `
              )
              .join('')}
          </div>
        </div>
      </div>
    `;

    const enterWorld = async (targetName: string) => {
      const clean = targetName.trim().toUpperCase();
      if (!clean) return;
      this.audio.play('warp');
      const err = await this.callbacks.onSelectWorld(clean);
      if (err) {
        this.showToast(err);
      }
    };

    const inputEl = document.getElementById('world-name-input') as HTMLInputElement;
    document.getElementById('btn-enter-world')?.addEventListener('click', () =>
      enterWorld(inputEl.value)
    );
    inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') enterWorld(inputEl.value);
    });

    this.root.querySelectorAll('.world-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        const wName = (btn as HTMLElement).dataset.world || 'START';
        enterWorld(wName);
      });
    });

    document.getElementById('btn-refresh-worlds')?.addEventListener('click', async () => {
      this.audio.play('ui');
      const fresh = await this.callbacks.onRefreshWorlds();
      this.worldList = fresh;
      this.renderWorldSelectScreen(profile);
    });

    document.getElementById('btn-logout')?.addEventListener('click', () => {
      this.audio.play('ui');
      this.callbacks.onLogout();
    });
  }

  // --- 3. 100% AUTHENTIC GROWTOPIA HUD & INVENTORY DRAWER ---
  public renderGameHUD(): void {
    if (this.screen !== 'playing') return;

    this.root.innerHTML = `
      <!-- TOP HUD: Authentic Full-Width Chat Box + Right Menu Stack (Menu, Chat, Gems) -->
      <div class="hud-top">
        <div class="hud-chat-box">
          <div id="hud-chat-log" class="chat-log ${this.chatSize}"></div>
          <button id="btn-chat-handle" class="gt-chat-handle" title="Toggle Chat Log"></button>
        </div>

        <div class="hud-top-right">
          <button id="btn-open-menu" class="gt-icon-btn gt-icon-menu" title="Menu [Esc]"></button>
          <button id="btn-open-chat" class="gt-icon-btn gt-icon-chat" title="Chat [/]"></button>
          <div id="btn-gem-store" class="gt-gems-display" title="Gems — Click for Store!">
            <span id="hud-gem-value" class="gt-gem-number">${this.inventory.gems.toLocaleString()}</span>
            <img class="gt-gem-icon" src="/assets/gt/ui/cash_icon_overlay.png" alt="Gems" />
          </div>
        </div>
      </div>

      <!-- Floating Chat Input Bar (opens on Chat button or Enter /) -->
      <div id="hud-chat-input-bar" class="hud-chat-input-bar ${this.chatInputOpen ? 'open' : ''}">
        <input id="hud-chat-input" class="chat-input" maxlength="120" placeholder="Type a message or /help, /wave, /dance..." />
        <button id="btn-chat-send" class="gt-btn gt-btn-green hud-btn-sm">Say</button>
        <button id="btn-chat-cancel" class="gt-btn gt-btn-red hud-btn-sm">X</button>
      </div>

      <!-- BOTTOM HUD: 4-Slot Hotbar + Horizontal Pull Handle + 10-Col Inventory Drawer -->
      <div id="hud-bottom-wrap" class="hud-bottom ${this.backpackOpen ? 'drawer-open' : ''}">
        <div class="hotbar-wrapper">
          <button id="btn-drawer-handle" class="gt-drawer-handle" title="Toggle Inventory"></button>
          <div id="hud-hotbar-mount" class="hotbar-container"></div>
        </div>

        <div id="hud-backpack-drawer" class="backpack-drawer ${this.backpackOpen ? 'open' : ''}">
          <div id="hud-drawer-grid" class="drawer-grid"></div>
          <div class="drawer-sidebar">
            <button id="btn-drawer-trash" class="gt-btn gt-btn-blue drawer-btn">TRASH</button>
            <button id="btn-drawer-store" class="gt-btn gt-btn-blue drawer-btn">STORE</button>
            <button id="btn-drawer-drop" class="gt-btn gt-btn-blue drawer-btn">DROP</button>
          </div>
        </div>
      </div>

      <!-- Touch Controls (Mobile D-pad left, Jump & Punch right) -->
      ${
        UIManager.isTouchDevice()
          ? `<div class="touch-controls">
        <div class="touch-pad touch-pad-left">
          <button class="touch-btn touch-left" data-vkey="ArrowLeft" aria-label="Left"></button>
          <button class="touch-btn touch-right" data-vkey="ArrowRight" aria-label="Right"></button>
        </div>
        <div class="touch-pad touch-pad-right">
          <button class="touch-btn touch-jump" data-vkey="ArrowUp" aria-label="Jump"></button>
          <button class="touch-btn touch-punch" data-vaction="1" aria-label="Punch"></button>
        </div>
      </div>`
          : ''
      }

      <div id="hud-modal-mount"></div>
    `;

    this.hudGemValueEl = document.getElementById('hud-gem-value');
    this.chatLogEl = document.getElementById('hud-chat-log');
    this.chatInputEl = document.getElementById('hud-chat-input') as HTMLInputElement;

    for (const msg of this.chat.messages) {
      this.appendChatLine(msg);
    }

    // Chat handle: collapses / expands chat box
    document.getElementById('btn-chat-handle')?.addEventListener('click', () => {
      this.audio.play('ui');
      this.chatSize =
        this.chatSize === 'normal'
          ? 'expanded'
          : this.chatSize === 'expanded'
          ? 'collapsed'
          : 'normal';
      if (this.chatLogEl) {
        this.chatLogEl.className = `chat-log ${this.chatSize}`;
      }
    });

    // Top Right Buttons
    document.getElementById('btn-open-menu')?.addEventListener('click', () => {
      this.audio.play('ui');
      this.activeModal = 'pause';
      this.renderModalOnly();
    });

    document.getElementById('btn-open-chat')?.addEventListener('click', () => {
      this.audio.play('ui');
      if (this.chatInputOpen) {
        this.closeChatInput();
      } else {
        this.focusChatInput();
      }
    });

    document.getElementById('btn-gem-store')?.addEventListener('click', () => {
      this.audio.play('ui');
      this.activeModal = 'store';
      this.renderModalOnly();
    });

    // Floating Chat Bar
    document.getElementById('btn-chat-send')?.addEventListener('click', () =>
      this.submitCurrentChat()
    );
    document.getElementById('btn-chat-cancel')?.addEventListener('click', () => {
      this.closeChatInput();
    });
    this.chatInputEl?.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submitCurrentChat();
      } else if (e.key === 'Escape') {
        this.closeChatInput();
      }
    });

    // Bottom Drawer Handle
    document.getElementById('btn-drawer-handle')?.addEventListener('click', () => {
      this.toggleBackpack();
    });

    // Drawer action buttons
    document.getElementById('btn-drawer-trash')?.addEventListener('click', () => {
      const def = getItemDef(this.selectedDrawerItemId);
      if (!def || def.id === ITEM_IDS.FIST || def.id === ITEM_IDS.WRENCH) return;
      const count = this.inventory.getCount(def.id);
      if (count <= 0) return;
      this.audio.play('ui');
      this.callbacks.onTrashItem(def.id, count);
    });

    document.getElementById('btn-drawer-store')?.addEventListener('click', () => {
      this.audio.play('ui');
      this.activeModal = 'store';
      this.renderModalOnly();
    });

    document.getElementById('btn-drawer-drop')?.addEventListener('click', () => {
      const def = getItemDef(this.selectedDrawerItemId);
      if (!def || def.id === ITEM_IDS.FIST || def.id === ITEM_IDS.WRENCH) return;
      if (this.inventory.getCount(def.id) <= 0) return;
      this.audio.play('ui');
      this.callbacks.onDropItem(def.id, 1);
    });

    this.bindTouchControls();
    this.refreshHudInventoryOnly();
    this.renderModalOnly();
  }

  public static isTouchDevice(): boolean {
    return (
      new URLSearchParams(window.location.search).has('touch') ||
      window.matchMedia('(pointer: coarse)').matches ||
      navigator.maxTouchPoints > 0
    );
  }

  private bindTouchControls(): void {
    this.root.querySelectorAll<HTMLElement>('.touch-btn').forEach((btn) => {
      const vkey = btn.dataset.vkey as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | undefined;
      const isAction = btn.dataset.vaction === '1';
      const press = (e: PointerEvent) => {
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        btn.classList.add('pressed');
        if (vkey) this.callbacks.onVirtualKey(vkey, true);
        if (isAction) this.callbacks.onVirtualAction(true);
      };
      const release = (e: PointerEvent) => {
        e.preventDefault();
        btn.classList.remove('pressed');
        if (vkey) this.callbacks.onVirtualKey(vkey, false);
        if (isAction) this.callbacks.onVirtualAction(false);
      };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  private submitCurrentChat(): void {
    if (!this.chatInputEl) return;
    const txt = this.chatInputEl.value.trim();
    if (txt) {
      this.callbacks.onSendChat(txt);
      this.chatInputEl.value = '';
    }
    this.closeChatInput();
  }

  private appendChatLine(msg: ChatPacket): void {
    if (!this.chatLogEl) return;
    const row = document.createElement('div');
    row.className = 'chat-line';

    if (msg.type === 'system' || msg.type === 'broadcast') {
      const segs = ChatManager.parseColoredText(msg.text, '#ffe47a');
      for (const s of segs) {
        const span = document.createElement('span');
        span.style.color = s.color;
        span.textContent = s.text;
        row.appendChild(span);
      }
    } else if (msg.type === 'emote') {
      const span = document.createElement('span');
      span.style.color = '#ebb0ff';
      span.textContent = msg.text;
      row.appendChild(span);
    } else {
      const nameSpan = document.createElement('span');
      const isWorldOwner = this.world.ownerId && msg.senderId === this.world.ownerId;
      nameSpan.style.color = isWorldOwner ? '#4ef55c' : '#7ce8ff';
      nameSpan.textContent = `<${msg.senderName}> `;
      row.appendChild(nameSpan);

      const segs = ChatManager.parseColoredText(msg.text, '#ffea78');
      for (const s of segs) {
        const span = document.createElement('span');
        span.style.color = s.color === '#ffffff' ? '#ffea78' : s.color;
        span.textContent = s.text;
        row.appendChild(span);
      }
    }

    this.chatLogEl.appendChild(row);
    this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
  }

  public updateDynamicWorldBadge(): void {
    // Dynamic world stats are now part of the pause/menu modal or floating display
  }

  private refreshHudInventoryOnly(): void {
    if (this.hudGemValueEl) {
      this.hudGemValueEl.textContent = this.inventory.gems.toLocaleString();
    }

    const bottomWrap = document.getElementById('hud-bottom-wrap');
    if (bottomWrap) {
      bottomWrap.className = `hud-bottom ${this.backpackOpen ? 'drawer-open' : ''}`;
    }

    const drawerEl = document.getElementById('hud-backpack-drawer');
    if (drawerEl) {
      drawerEl.className = `backpack-drawer ${this.backpackOpen ? 'open' : ''}`;
    }

    // 1. Render 4-slot Hotbar Container
    const hotbarMount = document.getElementById('hud-hotbar-mount');
    if (hotbarMount) {
      let html = '';
      for (let i = 0; i < HOTBAR_SLOTS; i++) {
        const itemId = this.inventory.hotbarBindings[i];
        const active = i === this.inventory.activeHotbarIndex;
        const count = itemId ? this.inventory.getCount(itemId) : 0;
        const showCount = itemId && itemId !== ITEM_IDS.FIST && itemId !== ITEM_IDS.WRENCH;

        html += `
          <div class="hotbar-slot ${active ? 'active' : ''} ${itemId ? 'has-item' : ''}" data-hotbar="${i}" title="${
          itemId ? escapeHtml(getItemDef(itemId)?.name ?? '') : 'Empty'
        }">
            ${itemId ? `<img class="pixel-icon" src="${this.getIconUrl(itemId)}" alt="" />` : ''}
            ${showCount ? `<span class="slot-count">${count}</span>` : ''}
          </div>
        `;
      }
      hotbarMount.innerHTML = html;

      hotbarMount.querySelectorAll('.hotbar-slot').forEach((el) => {
        const idx = Number((el as HTMLElement).dataset.hotbar);
        el.addEventListener('click', () => {
          this.audio.play('ui');
          this.inventory.selectHotbarSlot(idx);
        });
        el.addEventListener('dragover', (e) => e.preventDefault());
        el.addEventListener('drop', (e) => {
          e.preventDefault();
          const dragEvent = e as DragEvent;
          const fromInvIdx = Number(dragEvent.dataTransfer?.getData('text/inv-index'));
          if (Number.isInteger(fromInvIdx) && this.inventory.slots[fromInvIdx]) {
            const item = this.inventory.slots[fromInvIdx];
            this.audio.play('ui');
            this.inventory.bindItemToHotbar(idx, item.itemId);
          }
        });
      });
    }

    // 2. Render 10-Column Backpack Drawer Grid (if open)
    const drawerGrid = document.getElementById('hud-drawer-grid');
    if (!drawerGrid || !this.backpackOpen) return;

    if (this.inventory.getCount(this.selectedDrawerItemId) <= 0) {
      this.selectedDrawerItemId = this.inventory.getSelectedItemId() || ITEM_IDS.FIST;
    }

    let gridHtml = '';
    for (let i = 0; i < this.inventory.maxSlots; i++) {
      const slot = this.inventory.slots[i];
      if (slot) {
        const isSel = slot.itemId === this.selectedDrawerItemId;
        const isEq = Object.values(this.inventory.equipped).includes(slot.itemId);
        const hideQty = slot.itemId === ITEM_IDS.FIST || slot.itemId === ITEM_IDS.WRENCH;
        gridHtml += `
          <div class="drawer-slot ${isSel ? 'active' : ''} ${isEq ? 'equipped' : ''}" draggable="true" data-inv-idx="${i}" data-item-id="${slot.itemId}">
            <img class="pixel-icon" src="${this.getIconUrl(slot.itemId)}" alt="" />
            ${!hideQty ? `<span class="slot-count">${slot.count}</span>` : ''}
          </div>
        `;
      } else {
        gridHtml += `<div class="drawer-slot empty"></div>`;
      }
    }
    drawerGrid.innerHTML = gridHtml;

    drawerGrid.querySelectorAll('.drawer-slot[data-inv-idx]').forEach((el) => {
      const htmlEl = el as HTMLElement;
      const invIdx = Number(htmlEl.dataset.invIdx);
      const itemId = Number(htmlEl.dataset.itemId);

      htmlEl.addEventListener('click', () => {
        this.audio.play('ui');
        this.selectedDrawerItemId = itemId;
        const def = getItemDef(itemId);
        if (def?.category === 'clothing') {
          this.callbacks.onEquipItem(itemId);
        } else {
          this.inventory.selectItemFromBackpack(itemId);
        }
        this.refreshHudInventoryOnly();
      });

      htmlEl.addEventListener('dragstart', (e) => {
        (e as DragEvent).dataTransfer?.setData('text/inv-index', String(invIdx));
      });

      htmlEl.addEventListener('dragover', (e) => e.preventDefault());

      htmlEl.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromIdx = Number((e as DragEvent).dataTransfer?.getData('text/inv-index'));
        if (Number.isInteger(fromIdx) && fromIdx !== invIdx) {
          this.audio.play('ui');
          this.inventory.swapInventorySlots(fromIdx, invIdx);
        }
      });
    });
  }

  // --- 4. AUTHENTIC GROWTOPIA MODAL DIALOGS ---
  private renderModalOnly(): void {
    const mount = document.getElementById('hud-modal-mount');
    if (!mount) return;
    if (!this.activeModal) {
      mount.innerHTML = '';
      return;
    }

    if (this.activeModal === 'store') {
      const filtered = STORE_LISTINGS.filter(
        (l) => this.storeFilter === 'all' || l.category === this.storeFilter
      );
      mount.innerHTML = `
        <div class="modal-backdrop" id="modal-bg">
          <div class="gt-panel modal-card">
            <div class="gt-header-bar">
              <div style="display:flex;align-items:center;gap:8px;">
                <img class="cash-gem-icon" src="/assets/gt/ui/cash_icon_overlay.png" alt="" />
                <span>Growtopia Store — ${this.inventory.gems.toLocaleString()} Gems</span>
              </div>
              <button id="btn-close-modal" class="gt-close-btn" title="Close"></button>
            </div>

            <div class="store-tabs">
              ${(['all', 'locks', 'packs', 'gear', 'weather', 'upgrades'] as const)
                .map(
                  (cat) => `
                <button class="gt-btn ${
                  this.storeFilter === cat ? 'gt-btn-amber' : 'gt-btn-blue'
                } hud-btn-sm store-tab-btn" data-cat="${cat}">
                  ${cat.toUpperCase()}
                </button>`
                )
                .join('')}
            </div>

            <div class="modal-body-scroll store-grid">
              ${filtered
                .map(
                  (item) => `
                <div class="store-item-card">
                  <div style="display:flex;gap:10px;align-items:center;">
                    <div class="inspector-icon-box">
                      <img class="pixel-icon" src="${this.getIconUrl(item.iconItemId)}" alt="" />
                    </div>
                    <div>
                      <div style="font-size:14px;color:#fff275;">${escapeHtml(item.name)}</div>
                      <div style="display:flex;align-items:center;gap:4px;font-size:13px;color:#7dff8b;">
                        <img style="width:16px;height:16px;image-rendering:pixelated;" src="/assets/gt/ui/cash_icon_overlay.png" alt="" />
                        <span>${item.costGems.toLocaleString()} Gems</span>
                      </div>
                    </div>
                  </div>
                  <div style="font-size:12px;color:#dcf2ff;line-height:1.35;">${escapeHtml(
                    item.description
                  )}</div>
                  <button class="gt-btn gt-btn-green hud-btn-sm btn-buy-listing" data-id="${item.id}">
                    Buy (${item.costGems.toLocaleString()} Gems)
                  </button>
                </div>`
                )
                .join('')}
            </div>
          </div>
        </div>
      `;

      mount.querySelectorAll('.store-tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.audio.play('ui');
          this.storeFilter = (btn as HTMLElement).dataset.cat as typeof this.storeFilter;
          this.renderModalOnly();
        });
      });

      mount.querySelectorAll('.btn-buy-listing').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = (btn as HTMLElement).dataset.id!;
          const res = await this.callbacks.onStoreBuy(id);
          if (res.ok) {
            this.audio.play('gem');
            this.showToast(res.message || 'Purchased!');
            this.renderModalOnly();
          } else {
            this.audio.play('hurt');
            this.showToast(res.message || 'Not enough Gems!');
          }
        });
      });
    } else if (this.activeModal === 'recipes') {
      mount.innerHTML = `
        <div class="modal-backdrop" id="modal-bg">
          <div class="gt-panel modal-card">
            <div class="gt-header-bar">
              <span>Seed Splicing Book (${SPLICE_RECIPES.length} Formulas)</span>
              <button id="btn-close-modal" class="gt-close-btn" title="Close"></button>
            </div>
            <div style="font-size:13px;color:#dcf2ff;margin-bottom:8px;">
              Plant Seed A on top of a solid block, then plant Seed B onto the sprout to splice a hybrid Growtopia Tree!
            </div>
            <div class="modal-body-scroll">
              ${SPLICE_RECIPES.map((r) => {
                const a = getItemDef(r.seedA)!;
                const b = getItemDef(r.seedB)!;
                const resSeed = getItemDef(r.resultSeedId)!;
                const resBlock = resSeed.blockId ? getItemDef(resSeed.blockId) : resSeed;
                return `
                  <div class="recipe-row">
                    <div style="display:flex;align-items:center;gap:6px;">
                      <img class="pixel-icon" style="width:24px;height:24px;" src="${this.getIconUrl(
                        a.id
                      )}" alt="" />
                      <span>${escapeHtml(a.name)}</span>
                      <span style="color:#ffe45e;">+</span>
                      <img class="pixel-icon" style="width:24px;height:24px;" src="${this.getIconUrl(
                        b.id
                      )}" alt="" />
                      <span>${escapeHtml(b.name)}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;color:#7dff8b;">
                      <span>=</span>
                      <img class="pixel-icon" style="width:28px;height:28px;" src="${this.getIconUrl(
                        (resBlock ?? resSeed).id
                      )}" alt="" />
                      <span>${escapeHtml((resBlock ?? resSeed).name)}</span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      `;
    } else if (this.activeModal === 'wrench' && this.wrenchTarget) {
      const wt = this.wrenchTarget;
      const isDoor = wt.fg === ITEM_IDS.DOOR;
      mount.innerHTML = `
        <div class="modal-backdrop" id="modal-bg">
          <div class="gt-panel modal-card" style="max-width:460px;">
            <div class="gt-header-bar">
              <span>Wrench: Edit ${isDoor ? 'Door' : 'Sign'}</span>
              <button id="btn-close-modal" class="gt-close-btn" title="Close"></button>
            </div>

            <label class="field-label" for="wrench-label-input">
              ${
                isDoor
                  ? 'Door Label'
                  : 'Sign Text (Supports `2green `4red `6gold `9yellow)'
              }
            </label>
            <input id="wrench-label-input" class="gt-input" maxlength="72" value="${escapeHtml(
              wt.label
            )}" />

            ${
              isDoor
                ? `
              <label class="field-label" for="wrench-world-input" style="margin-top:10px;">
                Destination World Name
              </label>
              <input id="wrench-world-input" class="gt-input" maxlength="20" value="${escapeHtml(
                wt.targetWorld
              )}" style="text-transform:uppercase;" />
            `
                : ''
            }

            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
              <button id="btn-save-wrench" class="gt-btn gt-btn-green">Apply</button>
            </div>
          </div>
        </div>
      `;

      document.getElementById('btn-save-wrench')?.addEventListener('click', () => {
        const lbl = (document.getElementById('wrench-label-input') as HTMLInputElement).value;
        const destEl = document.getElementById('wrench-world-input') as HTMLInputElement | null;
        this.audio.play('place');
        this.callbacks.onWrenchSave(wt.tx, wt.ty, lbl, destEl?.value);
        this.activeModal = null;
        this.renderModalOnly();
      });
    } else if (this.activeModal === 'pause') {
      const coords = this.callbacks.getPlayerTileCoords();
      const online = this.callbacks.getOnlinePlayerNames();
      mount.innerHTML = `
        <div class="modal-backdrop" id="modal-bg">
          <div class="gt-panel modal-card" style="max-width:440px;">
            <div class="gt-header-bar">
              <span>Options & World Menu</span>
              <button id="btn-close-modal" class="gt-close-btn" title="Close"></button>
            </div>

            <div style="background:rgba(8,26,44,0.7);padding:8px 10px;border-radius:5px;margin-bottom:10px;font-size:13px;line-height:1.6;">
              <div>World: <span style="color:#ffe45e;">${escapeHtml(this.world.name)}</span> [${coords.tx}, ${coords.ty}]</div>
              <div>Lock: <span style="color:#5cff6d;">${escapeHtml(this.world.ownerName || 'Public')}</span> • Ping: ${this.callbacks.getPingMs()}ms</div>
              <div>Online Players (${online.length}): <span style="color:#cdeeff;">${escapeHtml(online.join(', '))}</span></div>
            </div>

            <div style="display:flex;flex-direction:column;gap:10px;font-size:14px;">
              <div>
                <label class="field-label">SFX Volume (${Math.round(
                  this.audio.sfxVolume * 100
                )}%)</label>
                <input id="opt-sfx-range" type="range" min="0" max="100" value="${Math.round(
                  this.audio.sfxVolume * 100
                )}" style="width:100%;" />
              </div>

              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span>Background Music</span>
                <button id="opt-music-btn" class="gt-btn ${
                  this.audio.musicEnabled ? 'gt-btn-green' : 'gt-btn-blue'
                } hud-btn-sm">
                  ${this.audio.musicEnabled ? 'ON' : 'OFF'}\n                </button>
              </div>

              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span>Camera Zoom</span>
                <div style="display:flex;gap:4px;">
                  ${[0.75, 1, 1.25, 1.5]
                    .map(
                      (z) => `
                    <button class="gt-btn ${
                      this.currentZoom === z ? 'gt-btn-amber' : 'gt-btn-blue'
                    } hud-btn-sm opt-zoom-btn" data-z="${z}">
                      ${z}x
                    </button>`
                    )
                    .join('')}
                </div>
              </div>

              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span>Tile Grid</span>
                <button id="opt-grid-btn" class="gt-btn ${
                  this.currentGrid ? 'gt-btn-amber' : 'gt-btn-blue'
                } hud-btn-sm">
                  ${this.currentGrid ? 'SHOWN' : 'HIDDEN'}
                </button>
              </div>

              <hr style="border:1px solid rgba(145,222,255,0.35);width:100%;margin:4px 0;" />

              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                <button id="btn-pause-recipes" class="gt-btn gt-btn-green">Splicing</button>
                <button id="btn-pause-respawn" class="gt-btn gt-btn-blue">Respawn</button>
              </div>
              <button id="btn-pause-leave" class="gt-btn gt-btn-amber">Exit World</button>
              <button id="btn-pause-disconnect" class="gt-btn gt-btn-red">Disconnect</button>
            </div>
          </div>
        </div>
      `;

      document.getElementById('opt-sfx-range')?.addEventListener('input', (e) => {
        const val = Number((e.target as HTMLInputElement).value) / 100;
        this.audio.sfxVolume = val;
      });

      document.getElementById('opt-music-btn')?.addEventListener('click', () => {
        this.audio.setMusicEnabled(!this.audio.musicEnabled);
        this.renderModalOnly();
      });

      mount.querySelectorAll('.opt-zoom-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const z = Number((btn as HTMLElement).dataset.z);
          this.currentZoom = z;
          this.callbacks.onChangeZoom(z);
          this.renderModalOnly();
        });
      });

      document.getElementById('opt-grid-btn')?.addEventListener('click', () => {
        this.currentGrid = !this.currentGrid;
        this.callbacks.onToggleGrid(this.currentGrid);
        this.renderModalOnly();
      });

      document.getElementById('btn-pause-recipes')?.addEventListener('click', () => {
        this.audio.play('ui');
        this.activeModal = 'recipes';
        this.renderModalOnly();
      });

      document.getElementById('btn-pause-respawn')?.addEventListener('click', () => {
        this.audio.play('warp');
        this.activeModal = null;
        this.renderModalOnly();
        this.callbacks.onRespawn();
      });

      document.getElementById('btn-pause-leave')?.addEventListener('click', () => {
        this.audio.play('warp');
        this.activeModal = null;
        this.callbacks.onLeaveWorld();
      });

      document.getElementById('btn-pause-disconnect')?.addEventListener('click', () => {
        this.audio.play('ui');
        this.activeModal = null;
        this.callbacks.onDisconnectToTitle();
      });
    }

    document.getElementById('btn-close-modal')?.addEventListener('click', () => {
      this.audio.play('ui');
      this.activeModal = null;
      this.renderModalOnly();
    });

    document.getElementById('modal-bg')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'modal-bg') {
        this.activeModal = null;
        this.renderModalOnly();
      }
    });
  }

  // --- 5. DISCONNECT SCREEN ---
  private renderDisconnectedScreen(): void {
    this.root.innerHTML = `
      <div class="screen-center">
        <div class="gt-panel" style="max-width:420px;text-align:center;">
          <div class="gt-header-bar">
            <span>Disconnected</span>
          </div>
          <p style="font-size:14px;color:#ffd9d9;line-height:1.5;">
            ${escapeHtml(this.disconnectReason || 'Connection to server lost.')}
          </p>
          <button id="btn-back-login" class="gt-btn gt-btn-green" style="width:100%;margin-top:8px;">
            Back to Login
          </button>
        </div>
      </div>
    `;

    document.getElementById('btn-back-login')?.addEventListener('click', () => {
      this.audio.play('ui');
      this.showLoginScreen();
    });
  }
}
