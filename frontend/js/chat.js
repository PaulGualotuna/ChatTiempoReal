// ==========================================
//  Frontend Chat
//  Manejo del DOM + Socket.IO client
//  - Login simple (join)
//  - Envío/recepción de mensajes
//  - Mensajes de sistema
//  - Botones: Limpiar chat / Cerrar sesión
//  - Modal Bootstrap para notificaciones
// ==========================================

const socket = io(); // mismo origen

// Referencias DOM
const chatBox = document.getElementById('chat-box');
const inputMsg = document.getElementById('mensaje');
const inputUser = document.getElementById('usuario');
const btnSend = document.getElementById('enviar');
const btnLogin = document.getElementById('btnLogin');
const btnLogout = document.getElementById('btnLogout');
const btnClear = document.getElementById('btnClear');

// ➕ Referencias del modal
const modal = new bootstrap.Modal(document.getElementById('appModal'));
const modalTitle = document.getElementById('appModalLabel');
const modalBody = document.getElementById('appModalBody');

// Función para mostrar modal de mensajes
function showModal(message, title = "Mensaje del sistema") {
  modalTitle.textContent = title;
  modalBody.textContent = message;
  modal.show();
}

let username = null;

// Utilidades
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

// Estado UI
function setConnectedState(connected) {
  inputUser.disabled = connected;
  btnLogin.disabled = connected;

  inputMsg.disabled = !connected;
  btnSend.disabled = !connected;

  btnLogout.disabled = !connected;
  btnClear.disabled = !connected;

  if (connected) inputMsg.focus();
}

// Eventos de sistema
socket.on('system', ({ text, ts }) => {
  addLine(`[${fmt(ts)}] ${text}`, { system: true });
});

// Mensajes de chat
socket.on('mensaje', ({ user, text, ts }) => {
  addLine(`${user} [${fmt(ts)}]: ${text}`);
});

// RTT cada 5s
setInterval(() => {
  try { socket.emit('ping_rtt', Date.now()); } catch {}
}, 5000);

socket.on('pong_rtt', (ts) => {
  const rtt = Date.now() - (Number(ts) || Date.now());
  console.log(`RTT: ${rtt} ms`);
});

// Login
btnLogin.addEventListener('click', () => {
  const name = (inputUser.value || '').trim();
  if (!name) {
    showModal('Ingresa un nombre de usuario', '¡Usuario no identificado!');
    inputUser.focus();
    return;
  }
  username = name;
  socket.connect();
  socket.emit('join', username);
  setConnectedState(true);
});

// Enviar mensajes
btnSend.addEventListener('click', () => {
  const text = (inputMsg.value || '').trim();
  if (!text) {
    showModal('Escribe un mensaje antes de enviarlo.', '¡Mensaje vacío!');
    return;
  }
  const payload = { user: username || 'Anónimo', text, ts: Date.now() };
  socket.emit('mensaje', payload);
  inputMsg.value = '';
  inputMsg.focus();
});

// Teclas rápidas
inputUser.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnLogin.click();
});
inputMsg.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnSend.click();
});

// Limpiar chat
btnClear.addEventListener('click', () => {
  chatBox.innerHTML = '';
  //showModal('El historial de chat se ha limpiado.', 'Información');
});

// Cerrar sesión
btnLogout.addEventListener('click', () => {
  try { socket.emit('logout'); } catch {}
  setConnectedState(false);
  username = null;
  inputUser.value = '';
  addLine('Has cerrado sesión.', { system: true });
  //showModal('Tu sesión ha sido cerrada correctamente.', 'Sesión finalizada');
});

// Desconexión
socket.on('disconnect', () => {
  if (username) {
    addLine('Se perdió la conexión con el servidor.', { system: true });
    showModal('Se perdió la conexión con el servidor.', 'Desconectado');
  }
  setConnectedState(false);
});