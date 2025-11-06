// ==========================================
//  Sistema de Mensajería en Tiempo Real
//  Backend - Servidor con Node.js y Socket.IO
//  Archivo: backend/server.js
//  Descripción:
//    - Servidor HTTP con Express
//    - WebSocket con Socket.IO
//    - Sirve el frontend estático desde ../frontend
//    - Expone / (index.html), /health (vivo) y /info (diagnóstico)
//    - Notifica conexiones/desconexiones (mensajes de sistema)
//    - Saneado básico, límite de tamaño y rate-limit por socket
// ==========================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);

// Variables de entorno (puedes sobreescribir al arrancar)
// Ejemplo PowerShell:  $env:PORT=3000; $env:HOST='0.0.0.0'; node server.js
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Si el frontend lo sirve este mismo servidor (mismo origen):
const io = new Server(server);

// -----------------------------
// Frontend estático y rutas HTTP
// -----------------------------
const FRONTEND_DIR = path.join(__dirname, '../frontend');
app.use(express.static(FRONTEND_DIR));

// Ruta raíz explícita (por si algo falla en static)
app.get('/', (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// Healthcheck sencillo
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Info de diagnóstico (IPs LAN, uptime y clientes conectados)
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

// Escapar caracteres básicos para evitar inyección HTML sencilla
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ➕ Validación mínima del payload de chat
function isValidMsg(p, maxLen) {
  if (!p || typeof p.text !== 'string') return false;
  const t = p.text.trim();
  if (!t || t.length === 0) return false;
  if (t.length > maxLen) return false;
  if (p.user && typeof p.user !== 'string') return false;
  return true;
}

// -----------------------------
// Socket.IO: Eventos en tiempo real
// -----------------------------
const users = new Map(); // socket.id -> username

// Parámetros de seguridad simples
const MAX_LEN = 500;            // Máximo tamaño mensaje
const WINDOW_MS = 1000;         // Ventana de rate limit (1s)
const MAX_MSGS_PER_WINDOW = 5;  // Máx. mensajes por ventana

// Memoria para rate limit por socket
const buckets = new Map(); // socket.id -> { count, ts }

io.on('connection', (socket) => {
  console.log('✅ Usuario conectado:', socket.id);

  // ➕ Manejo de errores a nivel de socket
  socket.on('error', (err) => {
    console.error('Socket error:', err?.message || err);
  });

  // ➕ Medición de RTT (latencia ida/vuelta)
  socket.on('ping_rtt', (ts) => socket.emit('pong_rtt', ts));

  // Al unirse, el cliente envía su nombre
  socket.on('join', (username) => {
    const name = (username || '').trim() || `Anon-${socket.id.slice(0,4)}`;
    users.set(socket.id, name);
    io.emit('system', { text: `${name} se ha conectado`, ts: Date.now() });
  });

  // Recepción de mensajes de chat
  socket.on('mensaje', (payload) => {
    // Payload esperado: { user, text, ts }
    const now = Date.now();

    // Rate limit básico por socket
    const bucket = buckets.get(socket.id) || { count: 0, ts: now };
    if (now - bucket.ts > WINDOW_MS) {
      bucket.count = 0;
      bucket.ts = now;
    }
    bucket.count++;
    buckets.set(socket.id, bucket);
    if (bucket.count > MAX_MSGS_PER_WINDOW) {
      // Silenciosamente ignoramos exceso (o puedes emitir aviso al cliente)
      return;
    }

    // ➕ Validación de payload
    if (!isValidMsg(payload, MAX_LEN)) return;

    // Normalizar / saneado
    const user = escapeHtml((payload?.user || users.get(socket.id) || '').slice(0, 50) || `Anon-${socket.id.slice(0,4)}`);
    let text = escapeHtml((payload?.text || '').slice(0, MAX_LEN));

    // Sellar timestamp en servidor si no viene o viene inválido
    const ts = Number.isFinite(payload?.ts) ? payload.ts : now;

    // Reemitir a TODOS (broadcast)
    io.emit('mensaje', { user, text, ts });
  });

  // Logout explícito (desde botón "Cerrar sesión")
  socket.on('logout', () => {
    const name = users.get(socket.id) || 'Alguien';
    users.delete(socket.id);
    io.emit('system', { text: `${name} cerró sesión`, ts: Date.now() });
    socket.disconnect(true);
  });

  // Desconexión
  socket.on('disconnect', () => {
    const name = users.get(socket.id) || null;
    if (name) {
      io.emit('system', { text: `${name} se ha desconectado`, ts: Date.now() });
      users.delete(socket.id);
    }
    buckets.delete(socket.id);
    console.log('❌ Usuario desconectado:', socket.id);
  });
});

// ➕ Manejo global de errores del proceso
process.on('uncaughtException', (e) => console.error('Uncaught Exception:', e));
process.on('unhandledRejection', (e) => console.error('Unhandled Rejection:', e));

// -----------------------------
// Levantar servidor
// -----------------------------
server.listen(PORT, HOST, () => {
  console.log('🚀 Servidor corriendo:');
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