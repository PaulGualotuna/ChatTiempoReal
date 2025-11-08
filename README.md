# Chatly — Mensajería en Tiempo Real

**Chatly** es una aplicación de chat en tiempo real diseñada para equipos que necesitan comunicación inmediata y ordenada. Combina un **backend** ligero (Node.js + Express + Socket.IO) con un **frontend** limpio y responsivo (HTML/CSS/JS), incorporando **salas dinámicas**, **chat general**, **presencia de usuarios** y **contador de mensajes no leídos**.

---

## Funcionalidades

- **Chat General**: se crea automáticamente cuando hay ≥ 2 usuarios conectados.
- **Salas privadas/dinámicas**: creación, invitación y reuso de salas ya existentes.
- **Presencia en tiempo real**: lista de usuarios conectados.
- **Notificaciones de no leídos**: por sala (cuando no está activa en el cliente).
- **Actualización dinámica del nombre de la sala**: muestra participantes (`+n` si hay más de 5).
- **Limpiadores de chat** y **mensajes de sistema**.
- **Diseño responsivo** con scroll independiente por sección (usuarios, salas, chat).

---

## Arquitectura (alto nivel)

- **Frontend**: HTML estático + CSS + JS vanilla. Se conecta a Socket.IO.
- **Backend**: Express sirve el frontend y expone WebSocket con Socket.IO.
- **Estado en memoria**: usuarios conectados, salas y meta de salas.
- **Comunicación**: eventos `join`, `mensaje`, `room:create|join|leave|message`, `presence:update`, `rooms:update`, etc.

```
Frontend (HTML/CSS/JS)  <-->  Socket.IO  <-->  Backend (Node.js/Express)
             |                                      |
           UI/UX                               Gestión de salas,
        renderizado                           presencia y mensajes
```

---

## Stack y requisitos

- **Node.js** ≥ 18 (recomendado 20+)
- **NPM** ≥ 8
- Dependencias principales:
  - `express`
  - `socket.io`
  - `nodemon` (dev)

---

## Estructura del repositorio

```
ChatTiempoReal/
├─ backend/
│  ├─ server.js
│  ├─ package.json
│  └─ node_modules/ (ignorado en git)
├─ frontend/
│  ├─ index.html
│  ├─ css/
│  │  └─ style.css
│  └─ js/
│     └─ chat.js
├─ .gitignore
└─ README.md
```

---

## Puesta en marcha (local)

1. **Instalar dependencias del backend**
   ```bash
   cd backend
   npm install
   ```
2. **Arrancar en desarrollo**
   ```bash
   npm run dev
   ```
   (o en producción:)
   ```bash
   npm start
   ```

3. **Abrir el frontend**
   - El backend sirve estáticos: abre `http://localhost:3000` (o el puerto configurado).
   - Conéctate con distintos usuarios (idealmente en dos pestañas o dispositivos) para probar.

> **Scripts útiles (backend/package.json)**  
> - `start`: `node server.js`  
> - `dev`: `nodemon server.js`

---

## Uso (flujo básico)

1. Ingresa un nombre y presiona **Conectar**.  
2. Con 2+ usuarios conectados se habilita **Chat general**.  
3. Crea salas privadas desde **+ Sala** o haciendo clic en un usuario.  
4. Si ya existe una sala con los mismos participantes, se **reutiliza** (no se duplica).  
5. Si recibes mensajes en una sala **no activa**, verás un **contador de no leídos**.  
6. Puedes **salir de sala**, **limpiar chat** o volver al general cuando quieras.

---

## Seguridad y producción

- Rate limit básico por socket para evitar spam.
- Sanitización HTML de mensajes (escape de caracteres).
- **Recomendaciones prod**:
  - Servir detrás de **Nginx**/proxy reverso (HTTPS).
  - Usar **PM2** o similar para orquestación/monitoring.
  - Externalizar estado a Redis (si necesitas persistencia o escalado horizontal).
  - Activar CORS/CSRF conforme al dominio de despliegue.
  - Logs centralizados y métricas (p. ej. Prometheus + Grafana).

---

## Troubleshooting

- **No abre el chat en tiempo real**: verifica la consola del navegador (errores de Socket.IO) y que el server esté en el puerto correcto.
- **Mensajes no se reflejan**: confirma que ambos clientes estén **conectados** y unidos a la misma sala.
- **No aparecen usuarios**: revisa que el evento `join` se emita con `{ username }`.
- **Cambios de UI no se ven**: limpia caché del navegador (Ctrl+F5).

---

## Roadmap (futuras funcionalidades)

- Historial persistente por sala (DB/Redis).
- Autenticación JWT y perfiles.
- Adjuntos y multimedia.
- Notificaciones push del navegador.

---

## Autores

**Lenin A. Barrionuevo**  
**James Mena**  
**Kevin Paúl Gualotuña**  
Grupo Aplicaciones Distribuidas ESPE

---

## Licencia

ESPE © 2025
