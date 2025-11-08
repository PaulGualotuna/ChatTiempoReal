// ==========================================
//  Frontend Chat (Presencia + Salas + Unread counters)
//  - Mantiene tu flujo original (login, global chat, modal, RTT, limpiar, logout)
//  - Sidebar: Usuarios conectados + Salas activas
//  - DMs: sin auto-apertura (solo invitación y badge de no leídos)
//  - Chat general: auto-selección en cliente cuando aparece
// ==========================================

// ---- Socket.IO (mismo origen) ----
const socket = io();

// ---- Referencias DOM existentes ----
const chatBox   = document.getElementById('chat-box');
const inputMsg  = document.getElementById('mensaje');
const inputUser = document.getElementById('usuario');
const btnSend   = document.getElementById('enviar');
const btnLogin  = document.getElementById('btnLogin');
const btnLogout = document.getElementById('btnLogout');
const btnClear  = document.getElementById('btnClear');

// ---- Modal Bootstrap ----
const modal      = new bootstrap.Modal(document.getElementById('appModal'));
const modalTitle = document.getElementById('appModalLabel');
const modalBody  = document.getElementById('appModalBody');

// ---- Sidebar/salas ----
const usersList    = document.getElementById('usersList');
const roomsList    = document.getElementById('roomsList');
const btnNewRoom   = document.getElementById('btnNewRoom');
const btnLeaveRoom = document.getElementById('btnLeaveRoom');
const btnClearChat = document.getElementById('btnClearChat');
const roomTitle    = document.getElementById('roomTitle');
const roomSubtitle = document.getElementById('roomSubtitle');

// ---- Estado ----
let username = null;
let currentRoomId = null; // si es null, se bloquea input (hasta entrar a sala)

const roomMessages = new Map(); // roomId -> [{user,text,ts,isSystem}]
const unreadByRoom = new Map(); // roomId -> number
let lastRoomsCache = [];

// ID lógico del chat general (lo envía el servidor)
const GLOBAL_ROOM_ID = 'room-general';

// ==========================================
// Utilidades
// ==========================================
function showModal(message, title = "Mensaje del sistema") {
  modalTitle.textContent = title;
  modalBody.textContent = message;
  modal.show();
}

function fmt(ts) {
  try { return new Date(ts).toLocaleTimeString(); }
  catch { return new Date().toLocaleTimeString(); }
}

function addLine(text, opts = { system: false }) {
  const row = document.createElement('div');
  row.className = 'msg-row' + (opts.system ? ' sys' : '');
  const p = document.createElement('p');
  p.textContent = text;
  row.appendChild(p);
  chatBox.appendChild(row);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function appendMessage(roomId, { user, text, ts }, isSystem = false) {
  if (!roomMessages.has(roomId)) roomMessages.set(roomId, []);
  roomMessages.get(roomId).push({ user, text, ts, isSystem });

  if (currentRoomId === roomId) {
    const row = document.createElement('div');
    row.className = 'p-2 border-bottom' + (isSystem ? ' text-muted fst-italic' : '');
    row.innerHTML = isSystem
      ? `${text} <span class="ms-1 text-secondary" style="font-size:.8rem">(${fmt(ts)})</span>`
      : `<strong>${user}</strong>: ${text} <span class="ms-1 text-secondary" style="font-size:.8rem">(${fmt(ts)})</span>`;
    chatBox.appendChild(row);
    chatBox.scrollTop = chatBox.scrollHeight;
  }
}

function selectRoom(roomId, name, participants = []) {
  currentRoomId = roomId;
  unreadByRoom.set(roomId, 0); // reset de no leídos al entrar

  if (roomTitle)    roomTitle.textContent = name || 'Sala';
  if (roomSubtitle) roomSubtitle.textContent = participants.length
    ? `Participantes: ${participants.join(', ')}`
    : '';

  chatBox.innerHTML = '';
  (roomMessages.get(roomId) || []).forEach(m => appendMessage(roomId, m, m.isSystem));

  updateControlsForRoom();
  inputMsg?.focus();

  // Refresca lista para ocultar badge en esta sala
  renderRooms(lastRoomsCache);
}

function clearCurrentChatUIOnly() {
  if (!currentRoomId) return;
  roomMessages.set(currentRoomId, []);
  chatBox.innerHTML = '';
}

function updateControlsForRoom() {
  const roomEnabled = !!currentRoomId;
  if (inputMsg)     inputMsg.disabled = !roomEnabled;
  if (btnSend)      btnSend.disabled  = !roomEnabled;
  if (btnLeaveRoom) btnLeaveRoom.disabled = !roomEnabled;
  if (btnClearChat) btnClearChat.disabled = !roomEnabled;
}

function setConnectedState(connected) {
  if (inputUser) inputUser.disabled = connected;
  if (btnLogin)  btnLogin.disabled  = connected;

  // Si no hay sala seleccionada, bloqueo de input/Enviar
  if (!currentRoomId) {
    if (inputMsg) inputMsg.disabled = true;
    if (btnSend)  btnSend.disabled  = true;
  }

  if (btnLogout)  btnLogout.disabled  = !connected;
  if (btnClear)   btnClear.disabled   = !connected;
  if (btnNewRoom) btnNewRoom.disabled = !connected;

  updateControlsForRoom();
}

// Pequeños toasts
function toast(msg, klass='bg-dark text-white') {
  try {
    const id = 'liveToast';
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = `toast align-items-center ${klass} position-fixed bottom-0 end-0 m-3`;
      el.role = 'alert';
      el.ariaLive = 'assertive';
      el.ariaAtomic = 'true';
      el.innerHTML = `
        <div class="d-flex">
          <div class="toast-body"></div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>`;
      document.body.appendChild(el);
    }
    el.querySelector('.toast-body').textContent = msg;
    const t = new bootstrap.Toast(el, { delay: 2200 });
    t.show();
  } catch {
    showModal(msg, 'Mensaje');
  }
}
const infoToast    = (m) => toast(m, 'bg-info text-white');
const successToast = (m) => toast(m, 'bg-success text-white');

// ==========================================
//  Sistema (legacy, se mantiene)
// ==========================================
socket.on('system', ({ text, ts }) => {
  addLine(`[${fmt(ts)}] ${text}`, { system: true });
});

socket.on('mensaje', ({ user, text, ts }) => {
  addLine(`${user} [${fmt(ts)}]: ${text}`);
});

// RTT
setInterval(() => { try { socket.emit('ping_rtt', Date.now()); } catch {} }, 5000);
socket.on('pong_rtt', (ts) => {
  const rtt = Date.now() - (Number(ts) || Date.now());
  console.log(`RTT: ${rtt} ms`);
});

// ==========================================
//  Presencia + Salas (cliente)
// ==========================================
function renderUsers(users) {
  if (!usersList) return;
  usersList.innerHTML = '';
  (users || [])
    .filter(u => u !== username)
    .forEach(u => {
      const item = document.createElement('button');
      item.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center';
      item.innerHTML = `<span>${u}</span><span class="badge bg-success">online</span>`;
      item.onclick = () => {
        const name = `${username} & ${u}`;
        socket.emit('room:create', { name, inviteUser: u });
      };
      usersList.appendChild(item);
    });

  if (usersList.innerHTML === '') {
    usersList.innerHTML = `<div class="text-muted small px-2 py-1">No hay otros usuarios conectados.</div>`;
  }
}

function renderRooms(rooms) {
  if (!roomsList) return;
  roomsList.innerHTML = '';
  lastRoomsCache = rooms || [];

  (rooms || []).forEach(r => {
    const active = currentRoomId === r.roomId ? 'active' : '';
    const unread = unreadByRoom.get(r.roomId) || 0;
    const badge = unread > 0
      ? `<span class="badge bg-danger ms-2">${unread}</span>`
      : (active ? '<span class="badge bg-primary ms-2">actual</span>' : '');

    const item = document.createElement('button');
    item.className = `list-group-item list-group-item-action d-flex justify-content-between align-items-center ${active}${unread > 0 ? ' list-group-item-warning' : ''}`;
    item.innerHTML = `
      <div>
        <div class="fw-semibold">${r.name}</div>
        <div class="text-muted small">${r.participants.length} en sala · Creada por ${r.owner}</div>
      </div>
      ${badge}
    `;
    item.onclick = () => {
      if (currentRoomId !== r.roomId) {
        socket.emit('room:join', { roomId: r.roomId });
        selectRoom(r.roomId, r.name, r.participants);
      }
    };
    roomsList.appendChild(item);
  });

  if (roomsList.innerHTML === '') {
    roomsList.innerHTML = `<div class="text-muted small px-2 py-1">No hay salas activas. Crea una con “+ Sala”.</div>`;
  }

  // Subtítulo de la sala actual
  const current = (rooms || []).find(r => r.roomId === currentRoomId);
  if (current && roomSubtitle) {
    roomSubtitle.textContent = current.participants.length
      ? `Participantes: ${current.participants.join(', ')}`
      : '';
  }

  // Auto-selección del Chat general SOLO tras login (cuando el servidor lo anuncie)
  if (!currentRoomId) {
    const general = (rooms || []).find(r => r.roomId === GLOBAL_ROOM_ID);
    if (general) {
      selectRoom(general.roomId, general.name, general.participants);
    }
  }
}

// Eventos del servidor
socket.on('presence:update', (users) => renderUsers(users));
socket.on('rooms:update', (rooms) => renderRooms(rooms));

socket.on('room:invited', ({ roomId, name, owner }) => {
  infoToast(`Invitado a sala "${name}" por ${owner}`);
});

socket.on('room:created', ({ roomId, name }) => {
  // El creador abre su sala
  selectRoom(roomId, name);
  successToast(`Sala "${name}" creada`);
});

socket.on('room:message', ({ roomId, user, text, ts }) => {
  const isSystem = user === 'system';
  if (roomId !== currentRoomId && !isSystem) {
    unreadByRoom.set(roomId, (unreadByRoom.get(roomId) || 0) + 1);
    renderRooms(lastRoomsCache);
  }
  appendMessage(roomId, { user, text, ts }, isSystem);
});

// ==========================================
//  Login / Logout
// ==========================================
btnLogin.addEventListener('click', () => {
  const name = (inputUser.value || '').trim();
  if (!name) {
    showModal('Ingresa un nombre de usuario', '¡Usuario no identificado!');
    inputUser.focus();
    return;
  }
  username = name;

  socket.connect();
  try { socket.emit('join', { username }); } catch {}

  setConnectedState(true);
  // No seleccionamos ninguna sala aquí: el servidor anunciará el chat general
});

btnSend.addEventListener('click', () => {
  const text = (inputMsg.value || '').trim();
  if (!text) {
    showModal('Escribe un mensaje antes de enviarlo.', '¡Mensaje vacío!');
    return;
  }

  if (currentRoomId) {
    socket.emit('room:message', { roomId: currentRoomId, text });
  } else {
    // Seguridad extra: no enviar si no hay sala (UI ya lo bloquea)
    return;
  }

  inputMsg.value = '';
  inputMsg.focus();
});

// Teclas rápidas
inputUser.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnLogin.click(); });
inputMsg.addEventListener('keydown',  (e) => { if (e.key === 'Enter') btnSend.click(); });

// Limpiar chat
btnClear.addEventListener('click', () => {
  if (currentRoomId) clearCurrentChatUIOnly();
  else chatBox.innerHTML = '';
});

// Cerrar sesión
btnLogout.addEventListener('click', () => {
  try { socket.emit('logout'); } catch {}
  setConnectedState(false);
  username = null;
  inputUser.value = '';
  currentRoomId = null;
  chatBox.innerHTML = '';
  if (roomTitle)    roomTitle.textContent = 'Selecciona una sala…';
  if (roomSubtitle) roomSubtitle.textContent = '';
  if (usersList) usersList.innerHTML = '';
  if (roomsList) roomsList.innerHTML = '';
  addLine('Has cerrado sesión.', { system: true });
});

// Desconexión
socket.on('disconnect', () => {
  if (username) {
    addLine('Se perdió la conexión con el servidor.', { system: true });
    showModal('Se perdió la conexión con el servidor.', 'Desconectado');
  }
  setConnectedState(false);
  currentRoomId = null;
  if (roomTitle)    roomTitle.textContent = 'Selecciona una sala…';
  if (roomSubtitle) roomSubtitle.textContent = '';
  if (usersList) usersList.innerHTML = '';
  if (roomsList) roomsList.innerHTML = '';
});

// ==========================================
//  Botones de SALA
// ==========================================
btnNewRoom?.addEventListener('click', () => {
  const name = prompt('Nombre de la sala:', `Sala de ${username}`) || `Sala de ${username}`;
  socket.emit('room:create', { name });
});

btnLeaveRoom?.addEventListener('click', () => {
  if (!currentRoomId) return;
  socket.emit('room:leave', { roomId: currentRoomId });
  currentRoomId = null;
  chatBox.innerHTML = '';
  if (roomTitle)    roomTitle.textContent = 'Selecciona una sala…';
  if (roomSubtitle) roomSubtitle.textContent = '';
  updateControlsForRoom();
});

btnClearChat?.addEventListener('click', () => {
  clearCurrentChatUIOnly();
});

// ---- Estado inicial: inputs bloqueados hasta login ----
setConnectedState(false);