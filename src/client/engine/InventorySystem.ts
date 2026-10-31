import {
  HOTBAR_SLOTS,
  INITIAL_INVENTORY_SLOTS,
  MAX_STACK,
} from '../../shared/constants';
import { getItemDef, ITEM_IDS } from '../../shared/ItemRegistry';
import { EquippedItems, InventorySlot } from '../../shared/types';

export class InventorySystem {
  public slots: InventorySlot[] = [];
  public maxSlots = INITIAL_INVENTORY_SLOTS;
  public gems = 0;
  public equipped: EquippedItems = {};
  public hotbarBindings: number[] = new Array(HOTBAR_SLOTS).fill(0);
  public activeHotbarIndex = 0;
  private onChangeCallbacks: Array<() => void> = [];

  constructor() {
    this.slots = [
      { itemId: ITEM_IDS.FIST, count: 1 },
      { itemId: ITEM_IDS.WRENCH, count: 1 },
    ];
    this.hotbarBindings[0] = ITEM_IDS.FIST;
  }

  public onChange(cb: () => void): void {
    this.onChangeCallbacks.push(cb);
  }

  private emitChange(): void {
    this.syncHotbarBindings();
    for (const cb of this.onChangeCallbacks) cb();
  }

  public loadFromProfile(
    slots: InventorySlot[],
    maxSlots: number,
    gems: number,
    equipped: EquippedItems
  ): void {
    this.slots = slots.map((s) => ({ ...s }));
    this.maxSlots = maxSlots;
    this.gems = gems;
    this.equipped = { ...equipped };
    this.emitChange();
  }

  public syncHotbarBindings(): void {
    // Slot 0 is the shared Fist/Wrench tool slot (like real Growtopia).
    if (this.hotbarBindings[0] !== ITEM_IDS.WRENCH) {
      this.hotbarBindings[0] = ITEM_IDS.FIST;
    }

    // Remove bindings for items no longer owned
    for (let i = 1; i < HOTBAR_SLOTS; i++) {
      const boundId = this.hotbarBindings[i];
      if (boundId && this.getCount(boundId) <= 0) {
        this.hotbarBindings[i] = 0;
      }
    }

    // Auto-populate empty hotbar slots with non-clothing inventory items
    for (const slot of this.slots) {
      if (slot.itemId === ITEM_IDS.FIST || slot.itemId === ITEM_IDS.WRENCH) continue;
      const def = getItemDef(slot.itemId);
      if (!def || def.category === 'clothing') continue;
      if (!this.hotbarBindings.includes(slot.itemId)) {
        const emptyIdx = this.hotbarBindings.findIndex((id, idx) => idx >= 1 && id === 0);
        if (emptyIdx !== -1) {
          this.hotbarBindings[emptyIdx] = slot.itemId;
        }
      }
    }
  }

  /** Real Growtopia: tapping the Fist reveals the Wrench, and vice versa. */
  public toggleTool(): void {
    this.hotbarBindings[0] =
      this.hotbarBindings[0] === ITEM_IDS.WRENCH ? ITEM_IDS.FIST : ITEM_IDS.WRENCH;
    this.activeHotbarIndex = 0;
    this.emitChange();
  }

  public getSelectedItemId(): number {
    return this.hotbarBindings[this.activeHotbarIndex] || ITEM_IDS.FIST;
  }

  public selectHotbarSlot(index: number): void {
    if (index >= 0 && index < HOTBAR_SLOTS) {
      // Tapping the already-selected tool slot flips Fist <-> Wrench, like real Growtopia.
      if (index === 0 && this.activeHotbarIndex === 0) {
        this.toggleTool();
        return;
      }
      this.activeHotbarIndex = index;
      this.emitChange();
    }
  }

  public bindItemToHotbar(hotbarIdx: number, itemId: number): void {
    if (hotbarIdx < 1 || hotbarIdx >= HOTBAR_SLOTS) return;
    if (this.getCount(itemId) <= 0) return;
    const existing = this.hotbarBindings.indexOf(itemId);
    if (existing >= 1) {
      this.hotbarBindings[existing] = this.hotbarBindings[hotbarIdx];
    }
    this.hotbarBindings[hotbarIdx] = itemId;
    this.activeHotbarIndex = hotbarIdx;
    this.emitChange();
  }

  public selectItemFromBackpack(itemId: number): void {
    if (itemId === ITEM_IDS.FIST || itemId === ITEM_IDS.WRENCH) {
      this.hotbarBindings[0] = itemId;
      this.activeHotbarIndex = 0;
      this.emitChange();
      return;
    }
    const existing = this.hotbarBindings.indexOf(itemId);
    if (existing !== -1) {
      this.activeHotbarIndex = existing;
      this.emitChange();
      return;
    }
    const emptySlot = this.hotbarBindings.findIndex((id, i) => i >= 1 && id === 0);
    const targetSlot = this.activeHotbarIndex >= 1 ? this.activeHotbarIndex : emptySlot;
    const finalSlot = targetSlot >= 1 ? targetSlot : 1;
    this.bindItemToHotbar(finalSlot, itemId);
  }

  public swapInventorySlots(idxA: number, idxB: number): void {
    if (
      idxA < 0 ||
      idxB < 0 ||
      idxA >= this.slots.length ||
      idxB >= this.slots.length ||
      idxA === idxB
    ) {
      return;
    }
    const tmp = this.slots[idxA];
    this.slots[idxA] = this.slots[idxB];
    this.slots[idxB] = tmp;
    this.emitChange();
  }

  public getCount(itemId: number): number {
    const found = this.slots.find((s) => s.itemId === itemId);
    return found ? found.count : 0;
  }

  public canFit(itemId: number, amount = 1): boolean {
    if (itemId === 0) return true; // Gems always fit!
    const existing = this.slots.find((s) => s.itemId === itemId);
    if (existing) {
      return existing.count + amount <= MAX_STACK;
    }
    return this.slots.length < this.maxSlots;
  }

  public addItem(itemId: number, count = 1): boolean {
    if (itemId === 0 || count <= 0) return false;
    const existing = this.slots.find((s) => s.itemId === itemId);
    if (existing && existing.count + count <= MAX_STACK) {
      existing.count += count;
      this.emitChange();
      return true;
    }
    if (this.slots.length < this.maxSlots) {
      this.slots.push({ itemId, count });
      this.emitChange();
      return true;
    }
    return false;
  }

  public removeItem(itemId: number, count = 1): boolean {
    if (count <= 0) return false;
    const idx = this.slots.findIndex((s) => s.itemId === itemId);
    if (idx === -1 || this.slots[idx].count < count) return false;
    this.slots[idx].count -= count;
    if (this.slots[idx].count <= 0) {
      this.slots.splice(idx, 1);
      for (const key of ['hat', 'face', 'back', 'hand'] as const) {
        if (this.equipped[key] === itemId) {
          delete this.equipped[key];
        }
      }
    }
    this.emitChange();
    return true;
  }

  public toggleEquip(itemId: number): void {
    const def = getItemDef(itemId);
    if (!def || def.category !== 'clothing' || !def.equipSlot) return;
    const slot = def.equipSlot;
    if (this.equipped[slot] === itemId) {
      delete this.equipped[slot];
    } else {
      this.equipped[slot] = itemId;
    }
    this.emitChange();
  }

  public hasDoubleJump(): boolean {
    if (!this.equipped.back) return false;
    return !!getItemDef(this.equipped.back)?.grantsDoubleJump;
  }

  public getPunchDamage(): number {
    let dmg = 1;
    if (this.equipped.hand) {
      dmg += getItemDef(this.equipped.hand)?.bonusPunchDamage ?? 0;
    }
    return dmg;
  }
}
