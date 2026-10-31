import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { io as ClientIO, Socket as ClientSocket } from 'socket.io-client';
import { createGrokTopiaServer } from '../src/server/index';
import { ITEM_IDS } from '../src/shared/ItemRegistry';
import {
  ChatPacket,
  DroppedItem,
  PlayerProfile,
  WorldInitPayload,
} from '../src/shared/types';

describe('Phases 2, 3 & 5: Gameplay, Splicing, SQLite Persistence & Multiplayer Sync', () => {
  let serverBundle: ReturnType<typeof createGrokTopiaServer>;
  let baseUrl = '';
  let clientA: ClientSocket;
  let clientB: ClientSocket;

  before(async () => {
    serverBundle = createGrokTopiaServer(':memory:');
    await new Promise<void>((resolve) => {
      serverBundle.httpServer.listen(0, '127.0.0.1', () => {
        const addr = serverBundle.httpServer.address();
        const port = typeof addr === 'object' && addr ? addr.port : 3001;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    clientA?.disconnect();
    clientB?.disconnect();
    await new Promise<void>((resolve) => serverBundle.io.close(() => resolve()));
    serverBundle.gameServer.stop();
    serverBundle.saveManager.close();
  });

  it('authenticates two multiplayer clients and syncs shared world entry + movement + chat', async () => {
    clientA = ClientIO(baseUrl, { transports: ['websocket'] });
    clientB = ClientIO(baseUrl, { transports: ['websocket'] });

    await Promise.all([
      new Promise<void>((r) => clientA.once('connect', () => r())),
      new Promise<void>((r) => clientB.once('connect', () => r())),
    ]);

    const loginA = await new Promise<{ ok: boolean; profile?: PlayerProfile }>((r) =>
      clientA.emit('auth:login', { username: 'BuilderOne', password: 'pw1', skinColor: '#f2b885' }, r)
    );
    const loginB = await new Promise<{ ok: boolean; profile?: PlayerProfile }>((r) =>
      clientB.emit('auth:login', { username: 'FarmerTwo', password: 'pw2', skinColor: '#9ecaff' }, r)
    );

    assert.equal(loginA.ok, true);
    assert.equal(loginB.ok, true);
    assert.equal(loginA.profile?.gems, 100);

    // Client A joins GARDEN world
    const joinA = await new Promise<{ ok: boolean; world?: WorldInitPayload }>((r) =>
      clientA.emit('world:join', 'GARDEN', r)
    );
    assert.equal(joinA.ok, true);
    assert.equal(joinA.world?.name, 'GARDEN');

    // Client A listens for Client B joining
    const joinedNotifyPromise = new Promise<{ username: string }>((r) =>
      clientA.once('player:joined', r)
    );

    const joinB = await new Promise<{ ok: boolean; world?: WorldInitPayload }>((r) =>
      clientB.emit('world:join', 'GARDEN', r)
    );
    assert.equal(joinB.ok, true);
    assert.equal(joinB.world?.players.length, 1);
    assert.equal(joinB.world?.players[0].username, 'BuilderOne');

    const joinedInfo = await joinedNotifyPromise;
    assert.equal(joinedInfo.username, 'FarmerTwo');

    // Sync movement from B -> A
    const movePromise = new Promise<{ id: string; x: number }>((r) =>
      clientA.once('player:moved', r)
    );
    clientB.emit('player:move', {
      x: 1580,
      y: 1157,
      vx: 120,
      vy: 0,
      facing: 1,
      anim: 'walk',
    });
    const moved = await movePromise;
    assert.equal(moved.x, 1580);

    // Sync chat from A -> B
    const chatPromise = new Promise<ChatPacket>((r) => {
      const handler = (pkt: ChatPacket) => {
        if (pkt.type === 'player') {
          clientB.off('chat:message', handler);
          r(pkt);
        }
      };
      clientB.on('chat:message', handler);
    });
    clientA.emit('chat:send', '`2Hello Growtopians!');
    const chatPkt = await chatPromise;
    assert.equal(chatPkt.senderName, 'BuilderOne');
    assert.equal(chatPkt.text, '`2Hello Growtopians!');
  });

  it('breaks blocks with hit progression, places blocks, splices seeds, harvests ripe trees, and enforces World Locks', async () => {
    const world = serverBundle.gameServer.getWorldInstance('GARDEN');
    const tx = world.spawnX + 1;
    const ty = world.spawnY + 1; // Solid Dirt tile right next to spawn bedrock!

    // Ensure tile is Dirt (3 hits to break)
    world.tiles[ty * world.width + tx] = { fg: ITEM_IDS.DIRT, bg: ITEM_IDS.CAVE_BG };

    // Position BuilderOne right above spawn
    clientA.emit('player:move', {
      x: world.spawnX * 32 + 6,
      y: world.spawnY * 32 + 5,
      vx: 0,
      vy: 0,
      facing: 1,
      anim: 'idle',
    });

    // Hit 1 & Hit 2 damage tile without breaking
    for (let h = 1; h <= 2; h++) {
      await new Promise((r) => setTimeout(r, 180));
      const dmgPromise = new Promise<{ damage: number }>((r) =>
        clientB.once('world:tileDamaged', r)
      );
      clientA.emit('world:punch', { tx, ty });
      const dmg = await dmgPromise;
      assert.equal(dmg.damage, h);
    }

    // Hit 3 breaks Dirt!
    await new Promise((r) => setTimeout(r, 180));
    const brokenPromise = new Promise<{ tx: number; ty: number; brokenId: number }>((r) =>
      clientB.once('world:tileUpdated', r)
    );
    clientA.emit('world:punch', { tx, ty });
    const broken = await brokenPromise;
    assert.equal(broken.brokenId, ITEM_IDS.DIRT);
    assert.equal(world.tiles[ty * world.width + tx].fg, 0);

    // Place Wood Block from BuilderOne's starter inventory into (tx, ty)
    await new Promise((r) => setTimeout(r, 140));
    const placedPromise = new Promise<{ placedId: number }>((r) =>
      clientB.once('world:tileUpdated', r)
    );
    clientA.emit('world:place', { tx, ty, itemId: ITEM_IDS.WOOD });
    const placed = await placedPromise;
    assert.equal(placed.placedId, ITEM_IDS.WOOD);
    assert.equal(world.tiles[ty * world.width + tx].fg, ITEM_IDS.WOOD);

    // Grant Dirt Seed & Lava Seed via dropped items and pick them up to test Seed Splicing + Harvesting!
    const seedDrop1: DroppedItem = {
      uid: 'test_seed_1',
      itemId: ITEM_IDS.DIRT_SEED,
      count: 1,
      x: world.spawnX * 32 + 12,
      y: world.spawnY * 32 + 12,
      spawnedAt: Date.now() - 1000,
    };
    const seedDrop2: DroppedItem = {
      uid: 'test_seed_2',
      itemId: ITEM_IDS.LAVA_SEED,
      count: 1,
      x: world.spawnX * 32 + 12,
      y: world.spawnY * 32 + 12,
      spawnedAt: Date.now() - 1000,
    };
    world.drops.push(seedDrop1, seedDrop2);

    clientA.emit('world:pickup', { uid: 'test_seed_1' });
    clientA.emit('world:pickup', { uid: 'test_seed_2' });
    await new Promise((r) => setTimeout(r, 80));

    // Plant Dirt Seed on top of the Wood Block at (tx, ty - 1)
    const plantY = ty - 1;
    await new Promise((r) => setTimeout(r, 140));
    clientA.emit('world:place', { tx, ty: plantY, itemId: ITEM_IDS.DIRT_SEED });
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(world.tiles[plantY * world.width + tx].fg, ITEM_IDS.DIRT_SEED);

    // Splice Lava Seed onto Dirt Seed -> becomes Wood Block Seed Tree!
    await new Promise((r) => setTimeout(r, 140));
    const splicePromise = new Promise<{ placedId: number; splicedName?: string }>((r) =>
      clientB.once('world:tileUpdated', r)
    );
    clientA.emit('world:place', { tx, ty: plantY, itemId: ITEM_IDS.LAVA_SEED });
    const splicedEv = await splicePromise;
    assert.equal(splicedEv.placedId, ITEM_IDS.WOOD_SEED);
    assert.equal(splicedEv.splicedName, 'Wood Block Tree');

    // Fast-forward tree maturity and punch to harvest!
    world.tiles[plantY * world.width + tx].meta!.plantedAt = Date.now() - 60_000;
    await new Promise((r) => setTimeout(r, 180));
    const dropsPromise = new Promise<DroppedItem[]>((r) =>
      clientB.once('world:dropsAdded', r)
    );
    clientA.emit('world:punch', { tx, ty: plantY });
    const harvestDrops = await dropsPromise;
    assert.ok(harvestDrops.some((d) => d.itemId === ITEM_IDS.WOOD && d.count >= 2));

    // World Lock test: give BuilderOne a World Lock drop, pick up, place at (tx, plantY), verify FarmerTwo is denied!
    world.drops.push({
      uid: 'test_wl',
      itemId: ITEM_IDS.WORLD_LOCK,
      count: 1,
      x: world.spawnX * 32 + 12,
      y: world.spawnY * 32 + 12,
      spawnedAt: Date.now() - 1000,
    });
    clientA.emit('world:pickup', { uid: 'test_wl' });
    await new Promise((r) => setTimeout(r, 60));

    await new Promise((r) => setTimeout(r, 140));
    clientA.emit('world:place', { tx, ty: plantY, itemId: ITEM_IDS.WORLD_LOCK });
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(world.ownerName, 'BuilderOne');

    // FarmerTwo moves next to tile and tries to break Wood Block -> server denies!
    clientB.emit('player:move', {
      x: world.spawnX * 32 + 6,
      y: world.spawnY * 32 + 5,
      vx: 0,
      vy: 0,
      facing: 1,
      anim: 'idle',
    });
    await new Promise((r) => setTimeout(r, 180));
    const deniedPromise = new Promise<{ reason: string }>((r) =>
      clientB.once('world:denied', r)
    );
    clientB.emit('world:punch', { tx, ty });
    const denied = await deniedPromise;
    assert.ok(denied.reason.includes('BuilderOne'));
    assert.equal(world.tiles[ty * world.width + tx].fg, ITEM_IDS.WOOD);
  });
});
