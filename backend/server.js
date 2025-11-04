// ==========================================
//  Sistema de Mensajería en Tiempo Real
//  Backend - Servidor con Node.js y Socket.IO
// ==========================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir archivos del frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Cuando un cliente se conecta
io.on('connection', (socket) => {
  console.log('Usuario conectado:', socket.id);

  // Recibir mensaje desde el cliente
  socket.on('mensaje', (data) => {
    io.emit('mensaje', data); // reenviar a todos los conectados
  });

  // Desconexión
  socket.on('disconnect', () => {
    console.log('Usuario desconectado:', socket.id);
  });
});

// Escuchar en el puerto 3000 y desde cualquier IP
server.listen(3000, '0.0.0.0', () => {
  console.log('Servidor corriendo en http://localhost:3000');
  console.log('Accede desde otros dispositivos: http://192.168.10.113:3000');
});




