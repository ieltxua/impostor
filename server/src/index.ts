import http from 'node:http';
import path from 'node:path';

import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';

import type { ClientToServerEvents, ServerToClientEvents } from '@impostor/shared';

import { registerSocketHandlers } from './socket/handlers.js';

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

const clientDistPath = path.resolve(process.cwd(), '..', 'client', 'dist');
app.use(express.static(clientDistPath));

const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: '*'
  }
});

registerSocketHandlers(io);

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`impostor server listening on http://localhost:${port}`);
});
