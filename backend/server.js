// ==========================================
//  Sistema de Mensajería en Tiempo Real
//  Backend - Node.js + Express + Socket.IO
// ==========================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);

// -----------------------------
// Config (puedes sobreescribir con env vars)
// -----------------------------
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// ---- Socket.IO debe declararse ANTES de usar "io" ----
const io = new Server(server); // mismo origen; sin CORS adicionales

// -----------------------------
// Frontend estático y rutas HTTP
// -----------------------------
const FRONTEND_DIR = path.join(__dirname, '../frontend');
app.use(express.static(FRONTEND_DIR));

app.get('/', (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/info', (_req, res) => {
  res.json({
    ips: getLanIPs(),
    port: PORT,
    uptime_s: Math.round(process.uptime()),
    clients: io.engine.clientsCount
  });
});

// -----------------------------
// Utilidades
// -----------------------------
function getLanIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const isV4 = net.family === 'IPv4' || net.family === 4;
      if (isV4 && !net.internal) ips.push({ iface: name, ip: net.address });
    }
  }
  return ips;
}

function safeText(s, max = 500) {
  return String(s ?? '').slice(0, max);
}
function now() { return Date.now(); }
function genRoomId() { return 'room-' + Math.random().toString(36).slice(2, 8); }
function dmRoomId(a, b) {
  const [x, y] = [String(a), String(b)].sort();
  return `dm-${x}#${y}`;
}
const GLOBAL_ROOM_ID = 'room-general';
const generalName = (count) => `Chat general (+${count})`;

// Escapar caracteres básicos para evitar inyección HTML sencilla
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Validación mínima del payload de chat
function isValidMsg(p, maxLen) {
  if (!p || typeof p.text !== 'string') return false;
  const t = p.text.trim();
  if (!t || t.length === 0) return false;
  if (t.length > maxLen) return false;
  if (p.user && typeof p.user !== 'string') return false;
  return true;
}

// ====== Estado en memoria ======
const users = new Map();           // socket.id -> username (canal global legacy)
const usersBySocket = new Map();   // socket.id -> username (presencia/salas)
const socketsByUser = new Map();   // username  -> socket.id
const roomsMeta = new Map();       // roomId    -> { name, owner, createdAt, isGeneral?, isDM?, members?: Set<string> }

// ====== Helpers de salas/presencia ======
function presenceList() {
  return Array.from(socketsByUser.keys()); // usernames
}
function roomParticipants(ioInstance, roomId) {
  const room = ioInstance.sockets.adapter.rooms.get(roomId);
  if (!room) return [];
  const out = [];
  for (const sid of room) {
    const u = usersBySocket.get(sid);
    if (u) out.push(u);
  }
  return out;
}
function getRoomsSnapshot(ioInstance) {
  const rooms = [];
  for (const [roomId, meta] of roomsMeta.entries()) {
    const participants = roomParticipants(ioInstance, roomId);
    // Si es general, renombra dinámicamente con el conteo actual:
    const displayName = meta.isGeneral ? generalName(participants.length) : meta.name;

    rooms.push({
      roomId,
      name: displayName,
      owner: meta.owner,
      participants,
      createdAt: meta.createdAt
    });
  }
  rooms.sort((a, b) => b.createdAt - a.createdAt); // recientes primero
  return rooms;
}
function broadcastPresenceAndRooms(ioInstance) {
  ioInstance.emit('presence:update', presenceList());
  ioInstance.emit('rooms:update', getRoomsSnapshot(ioInstance));
}

// === Gestión de Chat General ===
function ensureGeneralRoomIfNeeded() {
  const totalConnected = socketsByUser.size;
  const room = io.sockets.adapter.rooms.get(GLOBAL_ROOM_ID);
  const exists = !!room;

  // Crear si hay >=2 conectados y no existe
  if (totalConnected >= 2 && !exists) {
    roomsMeta.set(GLOBAL_ROOM_ID, {
      name: generalName(totalConnected),
      owner: 'system',
      createdAt: now(),
      isGeneral: true
    });
    // unir a TODOS los conectados
    for (const [user, sid] of socketsByUser.entries()) {
      const s = io.sockets.sockets.get(sid);
      if (s) s.join(GLOBAL_ROOM_ID);
    }
  }

  // Si existe, revisar si quedó con <2 participantes -> borrar
  if (exists) {
    const participants = roomParticipants(io, GLOBAL_ROOM_ID);
    if (participants.length < 2) {
      // Vaciar meta
      roomsMeta.delete(GLOBAL_ROOM_ID);
      // Dejar sala para sockets que queden marcados
      for (const sid of room) {
        const s = io.sockets.sockets.get(sid);
        if (s) s.leave(GLOBAL_ROOM_ID);
      }
    }
  }
}

// ====== Parámetros de seguridad simples ======
const MAX_LEN = 500;            // Máximo tamaño mensaje
const WINDOW_MS = 1000;         // Ventana de rate limit (1s)
const MAX_MSGS_PER_WINDOW = 5;  // Máx. mensajes por ventana
const buckets = new Map();      // socket.id -> { count, ts }

// -----------------------------
// Socket.IO: Eventos en tiempo real
// -----------------------------
io.on('connection', (socket) => {
  console.log('[1] Usuario conectado:', socket.id);

  socket.on('error', (err) => {
    console.error('Socket error:', err?.message || err);
  });

  // Medición de RTT (latencia ida/vuelta)
  socket.on('ping_rtt', (ts) => socket.emit('pong_rtt', ts));

  // === JOIN canónico (acepta objeto; tolera string para compatibilidad) ===
  socket.on('join', (payload) => {
    let name = '';
    if (typeof payload === 'string') {
      name = (payload || '').trim(); // compat con clientes antiguos
    } else if (payload && typeof payload.username === 'string') {
      name = (payload.username || '').trim();
    }
    if (!name) name = `Anon-${socket.id.slice(0, 4)}`;

    // Chat global (legacy)
    users.set(socket.id, name);

    // Presencia para sidebar/salas
    usersBySocket.set(socket.id, name);
    socketsByUser.set(name, socket.id);

    // Mensajes de sistema y sincronización
    io.emit('system', { text: `${name} se ha conectado`, ts: Date.now() });

    // Chat general: crear/unir según corresponda
    ensureGeneralRoomIfNeeded();
    const general = io.sockets.adapter.rooms.get(GLOBAL_ROOM_ID);
    if (general) {
      socket.join(GLOBAL_ROOM_ID); // unir a este usuario al general
    }

    broadcastPresenceAndRooms(io);
    socket.emit('system:info', { text: `Bienvenido ${name}`, ts: now() });
  });

  // === Canal GLOBAL de chat (legacy, se mantiene) ===
  socket.on('mensaje', (payload) => {
    const nowTs = Date.now();

    // Rate limit básico por socket
    const bucket = buckets.get(socket.id) || { count: 0, ts: nowTs };
    if (nowTs - bucket.ts > WINDOW_MS) {
      bucket.count = 0;
      bucket.ts = nowTs;
    }
    bucket.count++;
    buckets.set(socket.id, bucket);
    if (bucket.count > MAX_MSGS_PER_WINDOW) return;

    // Validación
    if (!isValidMsg(payload, MAX_LEN)) return;

    // Normalizar / saneado
    const user = escapeHtml((payload?.user || users.get(socket.id) || '').slice(0, 50) || `Anon-${socket.id.slice(0, 4)}`);
    const text = escapeHtml((payload?.text || '').slice(0, MAX_LEN));
    const ts = Number.isFinite(payload?.ts) ? payload.ts : nowTs;

    // Broadcast global
    io.emit('mensaje', { user, text, ts });
  });

  // === Salas: crear / unirse / salir / enviar mensaje ===

  // Crea sala. Si viene "inviteUser" y se trata de DM 1:1, reutiliza sala determinística.
  socket.on('room:create', ({ name, inviteUser }) => {
    const owner = usersBySocket.get(socket.id);
    if (!owner) return;

    let roomId, roomName, isDM = false;

    if (inviteUser && socketsByUser.has(inviteUser)) {
      // DM determinístico (evita duplicados A<->B)
      roomId = dmRoomId(owner, inviteUser);
      roomName = `${owner} & ${inviteUser}`;
      isDM = true;

      // Si no existe aún, registrar meta
      if (!roomsMeta.has(roomId)) {
        roomsMeta.set(roomId, { name: roomName, owner, createdAt: now(), isDM: true, members: new Set([owner, inviteUser]) });
      } else {
        // si ya existe y fue renombrada, respétala (pero asegura members)
        const meta = roomsMeta.get(roomId);
        meta.isDM = true;
        if (!meta.members) meta.members = new Set([owner, inviteUser]);
        meta.members.add(owner); meta.members.add(inviteUser);
      }
    } else {
      // Sala pública normal
      roomId = genRoomId();
      roomName = safeText(name || `Chat de ${owner}`);
      roomsMeta.set(roomId, { name: roomName, owner, createdAt: now() });
    }

    // El creador siempre entra
    socket.join(roomId);

    if (inviteUser && socketsByUser.has(inviteUser)) {
      const toSid = socketsByUser.get(inviteUser);

      // Notifica invitación al invitado
      io.to(toSid).emit('room:invited', { roomId, name: roomName, owner, ts: now() });

      // 🔹 Auto-join silencioso del invitado (para recibir mensajes y contar no leídos)
      const invitedSocket = io.sockets.sockets.get(toSid);
      if (invitedSocket) {
        invitedSocket.join(roomId);
      }
    }

    broadcastPresenceAndRooms(io);
    socket.emit('room:created', { roomId, name: roomName });
  });

  socket.on('room:join', ({ roomId }) => {
    const user = usersBySocket.get(socket.id);
    if (!user) return;
    if (!roomsMeta.has(roomId)) {
      socket.emit('system:error', { code: 'ROOM_NOT_FOUND' });
      return;
    }
    socket.join(roomId);
    io.to(roomId).emit('room:message', {
      roomId, user: 'system', text: `${user} se unió a la sala.`, ts: now()
    });
    broadcastPresenceAndRooms(io);
  });

  socket.on('room:leave', ({ roomId }) => {
    const user = usersBySocket.get(socket.id);
    if (!user || !roomsMeta.has(roomId)) return;

    socket.leave(roomId);
    io.to(roomId).emit('room:message', {
      roomId, user: 'system', text: `${user} salió de la sala.`, ts: now()
    });

    const room = io.sockets.adapter.rooms.get(roomId);
    if (!room || room.size === 0) roomsMeta.delete(roomId);

    // Si afecta al general, revalida su existencia/nombre
    if (roomId === GLOBAL_ROOM_ID) {
      ensureGeneralRoomIfNeeded();
    }

    broadcastPresenceAndRooms(io);
  });

  socket.on('room:message', ({ roomId, text }) => {
    const user = usersBySocket.get(socket.id);
    if (!user) return;
    if (!roomsMeta.has(roomId)) {
      socket.emit('system:error', { code: 'ROOM_NOT_FOUND' });
      return;
    }
    const clean = safeText(text);
    if (!clean.trim()) return;
    io.to(roomId).emit('room:message', { roomId, user, text: clean, ts: now() });
  });

  // === Logout explícito (único) ===
  socket.on('logout', () => {
    const name = users.get(socket.id) || 'Alguien';
    users.delete(socket.id);
    io.emit('system', { text: `${name} cerró sesión`, ts: Date.now() });
    socket.disconnect(true);
  });

  // === Disconnect (único): limpiar global + presencia + salas ===
  socket.on('disconnect', () => {
    const name = users.get(socket.id) || null;

    // chat global (legacy)
    if (name) {
      io.emit('system', { text: `${name} se ha desconectado`, ts: Date.now() });
      users.delete(socket.id);
    }

    // rate limit
    buckets.delete(socket.id);

    // presencia
    const uname = usersBySocket.get(socket.id);
    usersBySocket.delete(socket.id);
    if (uname && socketsByUser.get(uname) === socket.id) {
      socketsByUser.delete(uname);
    }

    // limpiar salas vacías
    for (const [roomId] of roomsMeta.entries()) {
      const room = io.sockets.adapter.rooms.get(roomId);
      if (!room || room.size === 0) roomsMeta.delete(roomId);
    }

    // Revalida chat general (puede quedar <2)
    ensureGeneralRoomIfNeeded();

    broadcastPresenceAndRooms(io);
    console.log('[0] Usuario desconectado:', socket.id, name ? `(${name})` : '');
  });
});

// -----------------------------
// Manejo global de errores
// -----------------------------
process.on('uncaughtException', (e) => console.error('Uncaught Exception:', e));
process.on('unhandledRejection', (e) => console.error('Unhandled Rejection:', e));

// -----------------------------
// Levantar servidor
// -----------------------------
server.listen(PORT, HOST, () => {
  console.log('*******************');
  console.log('Servidor corriendo:');
  console.log('*******************');
  console.log(`   • Local:   http://localhost:${PORT}`);
  const ips = getLanIPs();
  if (ips.length === 0) {
    console.log('   • LAN:     (no se detectaron IPv4 externas)');
  } else {
    for (const { iface, ip } of ips) {
      console.log(`   • LAN (${iface}): http://${ip}:${PORT}`);
    }
  }
  console.log('   • Health:  GET /health   • Info: GET /info');
});