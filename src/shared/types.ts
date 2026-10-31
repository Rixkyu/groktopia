export type ItemCategory =
  | 'tool'
  | 'foreground'
  | 'background'
  | 'seed'
  | 'lock'
  | 'weather'
  | 'clothing';

export type CollisionType =
  | 'none'
  | 'solid'
  | 'platform'
  | 'lava'
  | 'spike'
  | 'bumper';

export type EquipSlot = 'hat' | 'face' | 'back' | 'hand';

export type WeatherType = 'sunny' | 'night' | 'rain' | 'desert';

export interface ItemDefinition {
  id: number;
  name: string;
  category: ItemCategory;
  rarity: number;
  hitsToBreak: number;
  collision: CollisionType;
  unbreakable?: boolean;
  seedId?: number;          // For blocks: which seed item drops / corresponds
  blockId?: number;         // For seeds: which block item this tree harvests into
  growTimeSec?: number;     // For seeds: seconds to mature
  gemDropRange?: [number, number];
  equipSlot?: EquipSlot;    // For wearable items
  grantsDoubleJump?: boolean;
  bonusPunchDamage?: number;
  lockRadius?: number;      // 0 = entire world (World Lock), 1 = 3x3 (Small Lock)
  weatherTarget?: WeatherType;
  interactive?: 'main_door' | 'warp_door' | 'sign' | 'lock' | 'weather';
  lightRadius?: number;
  lightColor?: string;
  primaryColor: string;
  secondaryColor: string;
  seedPattern?: 'dots' | 'stripes' | 'swirl' | 'split';
  description: string;
}

export interface SpliceRecipe {
  seedA: number;
  seedB: number;
  resultSeedId: number;
}

export interface TileMeta {
  // Seed / Tree metadata
  plantedAt?: number;
  growTimeMs?: number;
  fruitCount?: number;
  // Sign / Door metadata
  label?: string;
  targetWorld?: string;
  // Lock metadata
  ownerId?: string;
  ownerName?: string;
  admins?: string[];
  // Weather machine metadata
  active?: boolean;
  // Orientation
  flipped?: boolean;
}

export interface TileData {
  fg: number;
  bg: number;
  damage?: number;
  lastHitAt?: number;
  meta?: TileMeta;
}

export interface DroppedItem {
  uid: string;
  itemId: number; // 0 = Gem! >0 = Item ID
  count: number;  // For gems, count = gem value (1, 5, 10, 25, 100)
  x: number;      // Pixel world X
  y: number;      // Pixel world Y
  spawnedAt: number;
}

export interface InventorySlot {
  itemId: number;
  count: number;
}

export interface EquippedItems {
  hat?: number;
  face?: number;
  back?: number;
  hand?: number;
}

export type PlayerAnimState = 'idle' | 'walk' | 'jump' | 'fall' | 'punch' | 'hurt' | 'wave' | 'dance';

export interface PlayerNetState {
  id: string;
  username: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: -1 | 1;
  anim: PlayerAnimState;
  skinColor: string;
  equipped: EquippedItems;
  punchTarget?: { tx: number; ty: number; at: number };
  chatBubble?: { text: string; expiresAt: number };
  isOwner?: boolean;
}

export interface PlayerProfile {
  id: string;
  username: string;
  skinColor: string;
  gems: number;
  maxSlots: number;
  inventory: InventorySlot[];
  equipped: EquippedItems;
}

export interface WorldSummary {
  name: string;
  playerCount: number;
  ownerName: string | null;
  weather: WeatherType;
}

export interface WorldInitPayload {
  name: string;
  width: number;
  height: number;
  weather: WeatherType;
  ownerId: string | null;
  ownerName: string | null;
  spawnX: number;
  spawnY: number;
  tiles: TileData[];
  drops: DroppedItem[];
  players: PlayerNetState[];
}

export interface StoreListing {
  id: string;
  name: string;
  description: string;
  costGems: number;
  category: 'locks' | 'packs' | 'gear' | 'weather' | 'upgrades';
  grants: Array<{ itemId: number; count: number }> | 'random_basic_pack' | 'random_farm_pack' | 'backpack_upgrade';
  iconItemId: number;
}

export interface ChatPacket {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  type: 'player' | 'system' | 'broadcast' | 'emote';
  timestamp: number;
}
