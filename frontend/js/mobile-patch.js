// =============================================================================
// AVSEG CHAT — mobile-patch.js
// Adicione no dashboard.html antes do </body>:
// <script src="js/mobile-patch.js"></script>
// =============================================================================

// Placeholder adaptativo por tamanho de tela
function ajustarPlaceholder() {
  const input = document.getElementById("chatInput");
  if (!input) return;
  if (window.innerWidth <= 480) {
    input.placeholder = "Mensagem...";
  } else if (window.innerWidth <= 900) {
    input.placeholder = "Digite... ou / para atalhos";
  } else {
    input.placeholder = "Digite sua mensagem... ou / para respostas rápidas";
  }
}

ajustarPlaceholder();
window.addEventListener("resize", ajustarPlaceholder);

// Fecha o menu "..." do header (mobile) se a tela crescer pra largura de desktop
window.addEventListener("resize", () => {
  if (window.innerWidth > 900 && typeof fecharMenuChatMobile === "function") {
    fecharMenuChatMobile();
  }
});

// Botão de configurações no header mobile da lista (aparece ao lado do logout)
function adicionarBtnConfigMobile() {
  if (window.innerWidth > 900) return;
  const headerTop = document.querySelector(".conversas-header-top");
  if (!headerTop || document.getElementById("btnConfigMobile")) return;

  const btn = document.createElement("a");
  btn.id = "btnConfigMobile";
  btn.href = "configuracoes.html";
  btn.title = "Configurações";
  btn.setAttribute("aria-label", "Configurações");
  btn.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: rgba(255,255,255,0.04);
    color: var(--text-secondary);
    text-decoration: none;
    flex-shrink: 0;
  `;
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  `;

  // Insere antes do botão logout mobile
  const btnLogout = document.getElementById("btnLogoutMobile");
  if (btnLogout) {
    headerTop.insertBefore(btn, btnLogout);
  } else {
    headerTop.appendChild(btn);
  }
}

// Roda após DOM estar pronto
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", adicionarBtnConfigMobile);
} else {
  adicionarBtnConfigMobile();
}