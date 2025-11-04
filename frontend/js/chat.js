const socket = io();

// Referencias a los elementos del DOM
const chatBox = document.getElementById("chat-box");
const mensajeInput = document.getElementById("mensaje");
const usuarioInput = document.getElementById("usuario");
const enviarBtn = document.getElementById("enviar");

// Mostrar mensajes en pantalla
socket.on("mensaje", (data) => {
  const p = document.createElement("p");
  const hora = new Date().toLocaleTimeString();
  p.innerHTML = `<strong>${data.usuario}</strong> [${hora}]: ${data.texto}`;
  chatBox.appendChild(p);
  chatBox.scrollTop = chatBox.scrollHeight;
});

// Enviar mensajes
enviarBtn.addEventListener("click", () => {
  const texto = mensajeInput.value.trim();
  const usuario = usuarioInput.value.trim() || "Anónimo";
  if (texto !== "") {
    socket.emit("mensaje", { usuario, texto });
    mensajeInput.value = "";
  }
});
