(function () {
  "use strict";

  // 1. Obtener clave de inserción y host base
  var currentScript =
    document.currentScript ||
    document.querySelector("script[data-key][src*='nextex-chat']");

  if (!currentScript) {
    console.warn("[Nextex Widget] No se encontró la etiqueta <script data-key='...'>");
    return;
  }

  var embedKey = currentScript.getAttribute("data-key");
  if (!embedKey) {
    console.warn("[Nextex Widget] Falta el atributo data-key en el script");
    return;
  }

  var apiBase = "https://nextex-seven.vercel.app";
  try {
    if (currentScript.src) {
      var scriptUrl = new URL(currentScript.src);
      apiBase = scriptUrl.origin;
    }
  } catch (e) {}

  // 2. Sesión en memoria (Cero tracking / Cero localStorage)
  var sessionId =
    "sess_" + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);

  // 3. Consultar configuración pública del widget
  fetch(apiBase + "/api/widget/config?key=" + encodeURIComponent(embedKey))
    .then(function (res) {
      if (!res.ok) {
        throw new Error("HTTP " + res.status);
      }
      return res.json();
    })
    .then(function (config) {
      initWidget(config);
    })
    .catch(function (err) {
      console.warn("[Nextex Widget] No se pudo inicializar:", err.message);
    });

  function initWidget(config) {
    var theme = config.theme || {};
    var primaryColor = theme.primary_color || theme.primaryColor || "#4f46e5";
    var position = theme.position === "bottom-left" ? "bottom-left" : "bottom-right";
    var businessName = config.business_name || "Asistente Virtual";
    var greeting = config.greeting || "¡Hola! ¿En qué podemos ayudarte hoy?";

    var isOpen = false;
    var isSending = false;

    // Crear contenedor ancla con Shadow DOM para aislamiento total de CSS
    var hostDiv = document.createElement("div");
    hostDiv.id = "nextex-widget-container";
    document.body.appendChild(hostDiv);

    var shadow = hostDiv.attachShadow ? hostDiv.attachShadow({ mode: "open" }) : hostDiv;

    // Inyectar estilos encapsulados
    var style = document.createElement("style");
    var isLeft = position === "bottom-left";
    style.textContent = `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .ntx-bubble-btn {
        position: fixed;
        bottom: 24px;
        ${isLeft ? "left: 24px;" : "right: 24px;"}
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background-color: ${primaryColor};
        color: #ffffff;
        border: none;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 999998;
        transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease;
      }
      .ntx-bubble-btn:hover {
        transform: scale(1.08);
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.32);
      }
      .ntx-chat-window {
        position: fixed;
        bottom: 96px;
        ${isLeft ? "left: 24px;" : "right: 24px;"}
        width: 375px;
        max-width: calc(100vw - 32px);
        height: 540px;
        max-height: calc(100vh - 120px);
        background: #0f172a;
        color: #f8fafc;
        border-radius: 18px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
        border: 1px solid rgba(255, 255, 255, 0.12);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        z-index: 999999;
        transform: scale(0.95) translateY(12px);
        opacity: 0;
        pointer-events: none;
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
      }
      .ntx-chat-window.open {
        transform: scale(1) translateY(0);
        opacity: 1;
        pointer-events: auto;
      }
      .ntx-header {
        background: ${primaryColor};
        color: #ffffff;
        padding: 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }
      .ntx-header-info {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .ntx-avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.2);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .ntx-title {
        font-weight: 700;
        font-size: 14px;
        line-height: 1.2;
      }
      .ntx-status {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        opacity: 0.85;
      }
      .ntx-status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #10b981;
      }
      .ntx-close-btn {
        background: none;
        border: none;
        color: #ffffff;
        cursor: pointer;
        padding: 4px;
        opacity: 0.8;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .ntx-close-btn:hover {
        opacity: 1;
      }
      .ntx-messages {
        flex: 1;
        padding: 16px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
        background: #090d16;
      }
      .ntx-msg {
        max-width: 82%;
        padding: 10px 14px;
        border-radius: 14px;
        font-size: 13px;
        line-height: 1.45;
        word-break: break-word;
      }
      .ntx-msg-bot {
        align-self: flex-start;
        background: #1e293b;
        color: #e2e8f0;
        border-bottom-left-radius: 4px;
        border: 1px solid rgba(255, 255, 255, 0.06);
      }
      .ntx-msg-user {
        align-self: flex-end;
        background: ${primaryColor};
        color: #ffffff;
        border-bottom-right-radius: 4px;
      }
      .ntx-typing {
        align-self: flex-start;
        background: #1e293b;
        color: #94a3b8;
        padding: 8px 14px;
        border-radius: 14px;
        font-size: 11px;
        font-style: italic;
        display: none;
        align-items: center;
        gap: 4px;
      }
      .ntx-typing.active {
        display: flex;
      }
      .ntx-footer {
        padding: 12px;
        background: #0f172a;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
      }
      .ntx-input-form {
        display: flex;
        align-items: center;
        gap: 8px;
        background: #1e293b;
        border-radius: 12px;
        padding: 4px 6px 4px 12px;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      .ntx-input-form:focus-within {
        border-color: ${primaryColor};
      }
      .ntx-input {
        flex: 1;
        background: transparent;
        border: none;
        color: #f8fafc;
        font-size: 13px;
        outline: none;
        padding: 6px 0;
      }
      .ntx-input::placeholder {
        color: #64748b;
      }
      .ntx-send-btn {
        background: ${primaryColor};
        border: none;
        color: #ffffff;
        width: 34px;
        height: 34px;
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: opacity 0.2s;
      }
      .ntx-send-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .ntx-brand {
        text-align: center;
        font-size: 10px;
        color: #64748b;
        margin-top: 6px;
      }
    `;
    shadow.appendChild(style);

    // Estructura HTML
    var wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <button class="ntx-bubble-btn" id="ntx-bubble" aria-label="Abrir chat">
        <svg id="ntx-icon-chat" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <svg id="ntx-icon-close" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>

      <div class="ntx-chat-window" id="ntx-window">
        <div class="ntx-header">
          <div class="ntx-header-info">
            <div class="ntx-avatar">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="10" rx="2"></rect>
                <circle cx="12" cy="5" r="2"></circle>
                <path d="M12 7v4"></path>
              </svg>
            </div>
            <div>
              <div class="ntx-title">${escapeHtml(businessName)}</div>
              <div class="ntx-status"><span class="ntx-status-dot"></span> En línea</div>
            </div>
          </div>
          <button class="ntx-close-btn" id="ntx-btn-close" aria-label="Cerrar chat">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="ntx-messages" id="ntx-msgs">
          <div class="ntx-msg ntx-msg-bot">${escapeHtml(greeting)}</div>
          <div class="ntx-typing" id="ntx-typing">Escribiendo respuesta...</div>
        </div>

        <div class="ntx-footer">
          <form class="ntx-input-form" id="ntx-form">
            <input type="text" class="ntx-input" id="ntx-input" placeholder="Escribe un mensaje..." autocomplete="off" />
            <button type="submit" class="ntx-send-btn" id="ntx-send" aria-label="Enviar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </form>
          <div class="ntx-brand">Impulsado por Nextex</div>
        </div>
      </div>
    `;
    shadow.appendChild(wrapper);

    var bubbleBtn = shadow.getElementById("ntx-bubble");
    var chatWindow = shadow.getElementById("ntx-window");
    var closeBtn = shadow.getElementById("ntx-btn-close");
    var chatIcon = shadow.getElementById("ntx-icon-chat");
    var closeIcon = shadow.getElementById("ntx-icon-close");
    var form = shadow.getElementById("ntx-form");
    var input = shadow.getElementById("ntx-input");
    var sendBtn = shadow.getElementById("ntx-send");
    var msgsContainer = shadow.getElementById("ntx-msgs");
    var typingIndicator = shadow.getElementById("ntx-typing");

    function toggleChat() {
      isOpen = !isOpen;
      if (isOpen) {
        chatWindow.classList.add("open");
        chatIcon.style.display = "none";
        closeIcon.style.display = "block";
        input.focus();
      } else {
        chatWindow.classList.remove("open");
        chatIcon.style.display = "block";
        closeIcon.style.display = "none";
      }
    }

    bubbleBtn.addEventListener("click", toggleChat);
    closeBtn.addEventListener("click", toggleChat);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text || isSending) return;

      appendMessage(text, "user");
      input.value = "";
      isSending = true;
      sendBtn.disabled = true;
      typingIndicator.classList.add("active");
      scrollToBottom();

      fetch(apiBase + "/api/widget/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embed_key: embedKey,
          message: text,
          session_id: sessionId,
        }),
      })
        .then(function (res) {
          return res.json().catch(function () {
            return {};
          });
        })
        .then(function (data) {
          typingIndicator.classList.remove("active");
          if (data && data.session_id) {
            sessionId = data.session_id;
          }
          var reply = data && data.reply ? data.reply : "Gracias por tu mensaje. En breve te responderemos.";
          appendMessage(reply, "bot");
        })
        .catch(function () {
          typingIndicator.classList.remove("active");
          appendMessage("Lo sentimos, no pudimos procesar tu mensaje. Por favor intenta de nuevo.", "bot");
        })
        .finally(function () {
          isSending = false;
          sendBtn.disabled = false;
          scrollToBottom();
          input.focus();
        });
    });

    function appendMessage(text, sender) {
      var msgDiv = document.createElement("div");
      msgDiv.className = "ntx-msg " + (sender === "user" ? "ntx-msg-user" : "ntx-msg-bot");
      msgDiv.textContent = text;
      msgsContainer.insertBefore(msgDiv, typingIndicator);
      scrollToBottom();
    }

    function scrollToBottom() {
      msgsContainer.scrollTop = msgsContainer.scrollHeight;
    }

    function escapeHtml(str) {
      if (!str) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }
  }
})();
