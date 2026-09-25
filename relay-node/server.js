const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';
const HOST_GRACE_MS = 10_000;
const HEARTBEAT_MS = 25_000;
const MAX_MESSAGE_BYTES = 256 * 1024;

const INSTANCE_ID = `${os.hostname()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
const startedAt = Date.now();

// Room state is intentionally in memory for this prototype.
// Keep the service at ONE running instance while using this version.
const rooms = new Map();

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function normalizeRoomCode(v) {
  return String(v || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

function normalizeNickname(v) {
  return String(v || '')
    .trim()
    .replace(/[<>]/g, '')
    .slice(0, 20) || '참가자';
}

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from(
      { length: 6 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

function broadcastRoom(room, payload) {
  const text = JSON.stringify(payload);
  for (const participant of room.participants.values()) {
    const ws = participant.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(text);
    }
  }
}

function roomState(room) {
  return {
    type: 'room_state',
    roomCode: room.code,
    creatorId: room.creatorId,
    hostId: room.hostId,
    participants: [...room.participants.values()]
      .sort((a, b) => a.joinSeq - b.joinSeq)
      .map((p) => ({
        participantId: p.id,
        nickname: p.nickname,
        joinSeq: p.joinSeq,
        connected: Boolean(p.ws && p.ws.readyState === WebSocket.OPEN),
        isHost: p.id === room.hostId,
      })),
  };
}

function assignHostIfNeeded(room) {
  const currentHost = room.participants.get(room.hostId);
  if (currentHost && currentHost.ws && currentHost.ws.readyState === WebSocket.OPEN) {
    return false;
  }

  const nextHost = [...room.participants.values()]
    .filter((p) => p.ws && p.ws.readyState === WebSocket.OPEN)
    .sort((a, b) => a.joinSeq - b.joinSeq)[0];

  const previous = room.hostId;
  room.hostId = nextHost ? nextHost.id : null;
  return previous !== room.hostId;
}

function joinRoom(ws, room, participantId, nickname) {
  const existing = room.participants.get(participantId);

  if (existing) {
    clearTimeout(existing.removalTimer);
    existing.removalTimer = null;
    existing.nickname = nickname;
    existing.ws = ws;
  } else {
    room.participants.set(participantId, {
      id: participantId,
      nickname,
      joinSeq: room.nextJoinSeq++,
      ws,
      removalTimer: null,
    });
  }

  const participant = room.participants.get(participantId);
  ws.__room = room;
  ws.__participantId = participantId;
  ws.__nickname = nickname;

  if (!room.hostId) room.hostId = participantId;

  send(ws, {
    type: 'room_joined',
    roomCode: room.code,
    participantId,
    hostId: room.hostId,
    isHost: participantId === room.hostId,
  });
  broadcastRoom(room, roomState(room));
}

function scheduleParticipantRemoval(ws) {
  const room = ws.__room;
  const participantId = ws.__participantId;
  if (!room || !participantId) return;

  const participant = room.participants.get(participantId);
  if (!participant || participant.ws !== ws) return;

  const wasHost = room.hostId === participantId;
  clearTimeout(participant.removalTimer);
  participant.removalTimer = setTimeout(() => {
    // A reconnect may have replaced this websocket during the grace period.
    if (participant.ws && participant.ws.readyState === WebSocket.OPEN) return;

    room.participants.delete(participantId);

    if (wasHost) assignHostIfNeeded(room);

    log(
      `[PARTICIPANT REMOVE] instanceId=${INSTANCE_ID}`,
      `room=${room.code}`,
      `participantId=${participantId}`,
      `rooms.size=${rooms.size}`
    );

    broadcastRoom(room, roomState(room));

    if (room.participants.size === 0) {
      rooms.delete(room.code);
      log(`[ROOM DELETE] instanceId=${INSTANCE_ID} room=${room.code} rooms.size=${rooms.size}`);
    }
  }, HOST_GRACE_MS);

  broadcastRoom(room, roomState(room));
}

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        ok: true,
        service: 'CHZZK_CC Stateful Relay',
        instanceId: INSTANCE_ID,
        rooms: rooms.size,
        connectedClients: [...wss.clients].filter((ws) => ws.readyState === WebSocket.OPEN).length,
        uptime: process.uptime(),
      })
    );
    return;
  }

  if (url.pathname === '/' || url.pathname === '/api/ws' || url.pathname === '/ws') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('CHZZK_CC Stateful Relay is running.');
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MESSAGE_BYTES });

wss.on('connection', (ws, request) => {
  ws.__room = null;
  ws.__participantId = null;
  ws.__nickname = null;
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  log(
    `[CONNECT] instanceId=${INSTANCE_ID}`,
    `path=${request.url}`,
    `clients=${wss.clients.size}`
  );

  send(ws, { type: 'relay_ready', protocol: 1, instanceId: INSTANCE_ID });

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return;

    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!message || !message.type) return;

    if (message.type === 'create_room') {
      const participantId = String(message.participantId || '').slice(0, 80);
      if (!participantId) {
        send(ws, { type: 'room_error', message: '참가자 ID가 없습니다.' });
        return;
      }

      // A websocket can only belong to one Room at a time.
      if (ws.__room) {
        scheduleParticipantRemoval(ws);
        ws.__room = null;
        ws.__participantId = null;
        ws.__nickname = null;
      }

      const nickname = normalizeNickname(message.nickname);
      const room = {
        code: makeRoomCode(),
        creatorId: participantId,
        hostId: participantId,
        nextJoinSeq: 1,
        participants: new Map(),
      };
      rooms.set(room.code, room);

      log(
        `[ROOM CREATED] instanceId=${INSTANCE_ID}`,
        `room=${room.code}`,
        `participantId=${participantId}`,
        `nickname=${nickname}`,
        `rooms.size=${rooms.size}`
      );

      joinRoom(ws, room, participantId, nickname);
      return;
    }

    if (message.type === 'join_room') {
      const roomCode = normalizeRoomCode(message.roomCode);
      const participantId = String(message.participantId || '').slice(0, 80);
      const nickname = normalizeNickname(message.nickname);

      log(
        `[JOIN REQUEST] instanceId=${INSTANCE_ID}`,
        `room=${roomCode}`,
        `participantId=${participantId}`,
        `nickname=${nickname}`,
        `rooms.size=${rooms.size}`
      );

      if (!participantId) {
        send(ws, { type: 'room_error', message: '참가자 ID가 없습니다.' });
        return;
      }

      if (!roomCode) {
        send(ws, { type: 'room_error', message: '방 코드가 없습니다.' });
        return;
      }

      const room = rooms.get(roomCode);

      log(
        `[JOIN CHECK] instanceId=${INSTANCE_ID}`,
        `room=${roomCode}`,
        `found=${Boolean(room)}`,
        `rooms.size=${rooms.size}`
      );

      if (!room) {
        log(
          `[JOIN FAILED] instanceId=${INSTANCE_ID}`,
          `room=${roomCode}`,
          `rooms.size=${rooms.size}`
        );
        send(ws, { type: 'room_error', message: '존재하지 않거나 종료된 방입니다.' });
        return;
      }

      log(
        `[JOIN FOUND] instanceId=${INSTANCE_ID}`,
        `room=${roomCode}`,
        `participants=${room.participants.size}`
      );

      if (ws.__room && ws.__room !== room) {
        scheduleParticipantRemoval(ws);
      }

      joinRoom(ws, room, participantId, nickname);
      return;
    }

    if (message.type === 'leave_room') {
      scheduleParticipantRemoval(ws);
      ws.__room = null;
      ws.__participantId = null;
      ws.__nickname = null;
      send(ws, { type: 'room_left' });
      return;
    }

    if (message.type === 'caption') {
      const room = ws.__room;
      const participantId = ws.__participantId;
      if (!room || !participantId || !room.participants.has(participantId)) return;

      const payload = {
        ...message,
        type: 'caption',
        roomCode: room.code,
        participantId,
        speakerName: ws.__nickname || message.speakerName || '화자',
        serverReceivedAt: Date.now(),
      };

      log(
        `[CAPTION] instanceId=${INSTANCE_ID}`,
        `room=${room.code}`,
        `participantId=${participantId}`,
        `textLength=${String(payload.text || '').length}`
      );

      broadcastRoom(room, payload);
      return;
    }

    if (message.type === 'config') {
      const room = ws.__room;
      const participantId = ws.__participantId;
      if (!room) return;

      broadcastRoom(room, {
        ...message,
        roomCode: room.code,
        participantId,
      });
      return;
    }
  });

  ws.on('close', () => {
    scheduleParticipantRemoval(ws);
    log(
      `[DISCONNECT] instanceId=${INSTANCE_ID}`,
      `participantId=${ws.__participantId || '-'}`,
      `clients=${Math.max(0, wss.clients.size - 1)}`
    );
  });

  ws.on('error', (error) => {
    log(
      `[WS ERROR] instanceId=${INSTANCE_ID}`,
      `participantId=${ws.__participantId || '-'}`,
      `message=${error?.message || 'unknown'}`
    );
  });
});

const heartbeatTimer = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch {}
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, HEARTBEAT_MS);

heartbeatTimer.unref();

httpServer.on('error', (error) => {
  log(`[HTTP ERROR] ${error.message}`);
  process.exitCode = 1;
});

httpServer.listen(PORT, HOST, () => {
  log(
    `CHZZK_CC Stateful Relay started instanceId=${INSTANCE_ID}`,
    `http=http://${HOST}:${PORT}`
  );
  log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
});

function shutdown(signal) {
  log(`[SHUTDOWN] signal=${signal} rooms=${rooms.size}`);
  clearInterval(heartbeatTimer);
  for (const ws of wss.clients) {
    try { ws.close(1001, 'server shutdown'); } catch {}
  }
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
