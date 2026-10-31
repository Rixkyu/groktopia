import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server as SocketIOServer } from 'socket.io';
import { GameServer } from './GameServer';
import { SaveManager } from './SaveManager';

export function createGrokTopiaServer(dbPath?: string) {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer, {
    pingInterval: 25000,
    pingTimeout: 120000,
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  const saveManager = new SaveManager(dbPath);
  const gameServer = new GameServer(io, saveManager);

  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  app.get('/api/status', (_req, res) => {
    res.json({
      ok: true,
      game: 'GrokTopia',
      ...gameServer.getOnlineStats(),
    });
  });

  // Serve unpacked Growtopia assets from public/ + built Vite client if dist exists
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.resolve(currentDir, '../../public');
  const distDir = path.resolve(currentDir, '../../dist');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return { app, httpServer, io, saveManager, gameServer };
}

// Run directly when executed as main entry
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase().endsWith(path.normalize('src/server/index.ts').toLowerCase());

if (isMain) {
  const port = Number(process.env.PORT || 3001);
  const { httpServer, io, gameServer, saveManager } = createGrokTopiaServer();
  httpServer.listen(port, () => {
    console.log(`[GrokTopia Server] Listening on http://localhost:${port}`);
  });

  const shutdown = () => {
    io.close(() => {
      gameServer.stop();
      saveManager.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
