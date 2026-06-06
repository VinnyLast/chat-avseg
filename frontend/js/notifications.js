// =============================================================================
// AVSEG CHAT — notifications.js
// Notificações sonoras, badge na aba e indicador "digitando..."
// Inclua este arquivo no dashboard.html ANTES do dashboard.js
// =============================================================================

// -----------------------------------------------------------------------------
// SOM — gerado via Web Audio API (sem arquivo externo)
// -----------------------------------------------------------------------------
const AVSEGNotify = (() => {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let ctx = null;

  function getCtx() {
    if (!ctx) ctx = new AudioCtx();
    // Retoma o contexto se suspenso (política de autoplay)
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // Som curto e suave — nova mensagem do cliente
  function tocarMensagem() {
    try {
      const ac = getCtx();
      const osc = ac.createOscillator();
      const gain = ac.createGain();

      osc.connect(gain);
      gain.connect(ac.destination);

      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1100, ac.currentTime + 0.08);

      gain.gain.setValueAtTime(0, ac.currentTime);
      gain.gain.linearRampToValueAtTime(0.18, ac.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.28);

      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + 0.3);
    } catch (_) {}
  }

  // Som ligeiramente diferente — nova conversa
  function tocarNovaConversa() {
    try {
      const ac = getCtx();

      [0, 0.12].forEach((delay, i) => {
        const osc = ac.createOscillator();
        const gain = ac.createGain();

        osc.connect(gain);
        gain.connect(ac.destination);

        osc.type = "sine";
        osc.frequency.setValueAtTime(i === 0 ? 880 : 1100, ac.currentTime + delay);

        gain.gain.setValueAtTime(0, ac.currentTime + delay);
        gain.gain.linearRampToValueAtTime(0.15, ac.currentTime + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + delay + 0.22);

        osc.start(ac.currentTime + delay);
        osc.stop(ac.currentTime + delay + 0.25);
      });
    } catch (_) {}
  }

  // -----------------------------------------------------------------------------
  // BADGE NO TÍTULO DA ABA
  // -----------------------------------------------------------------------------
  let _naoLidas = 0;
  let _tituloOriginal = document.title;
  let _piscandoInterval = null;

  function atualizarBadge(total) {
    _naoLidas = total;

    if (_piscandoInterval) {
      clearInterval(_piscandoInterval);
      _piscandoInterval = null;
    }

    if (total <= 0) {
      document.title = _tituloOriginal;
      return;
    }

    // Pisca entre "(N) AVSEG Chat" e "• AVSEG Chat" para chamar atenção
    let estado = true;
    _piscandoInterval = setInterval(() => {
      document.title = estado
        ? `(${total}) AVSEG Chat`
        : `• AVSEG Chat`;
      estado = !estado;
    }, 1200);

    document.title = `(${total}) AVSEG Chat`;
  }

  // Para de piscar quando a aba volta ao foco
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && _piscandoInterval) {
      clearInterval(_piscandoInterval);
      _piscandoInterval = null;
      document.title = _naoLidas > 0
        ? `(${_naoLidas}) AVSEG Chat`
        : _tituloOriginal;
    }
  });

  // -----------------------------------------------------------------------------
  // INDICADOR "DIGITANDO..."
  // -----------------------------------------------------------------------------
  // Mapa: conversaId → { timer, elemento }
  const _digitandoAtivos = new Map();

  function _criarElementoDigitando() {
    const div = document.createElement("div");
    div.className = "mensagem cliente mensagem-digitando";
    div.innerHTML = `
      <div class="mensagem-conteudo digitando-bolha">
        <span class="digitando-pontos">
          <span></span><span></span><span></span>
        </span>
      </div>
    `;
    return div;
  }

  /**
   * Mostra "digitando..." na conversa especificada.
   * Se já existe, reinicia o timer.
   * @param {string} conversaId
   * @param {HTMLElement} chatMensagensEl — elemento #chatMensagens
   */
  function mostrarDigitando(conversaId, chatMensagensEl) {
    if (!chatMensagensEl) return;

    // Se já existe, só reinicia o timer
    if (_digitandoAtivos.has(conversaId)) {
      const existente = _digitandoAtivos.get(conversaId);
      clearTimeout(existente.timer);
      existente.timer = setTimeout(() => ocultarDigitando(conversaId), 5000);
      return;
    }

    const el = _criarElementoDigitando();
    chatMensagensEl.appendChild(el);

    // Rola para mostrar o indicador
    chatMensagensEl.scrollTop = chatMensagensEl.scrollHeight;

    const timer = setTimeout(() => ocultarDigitando(conversaId), 5000);
    _digitandoAtivos.set(conversaId, { el, timer });
  }

  function ocultarDigitando(conversaId) {
    const dados = _digitandoAtivos.get(conversaId);
    if (!dados) return;

    clearTimeout(dados.timer);

    // Animação de saída
    dados.el.style.opacity = "0";
    dados.el.style.transform = "scale(0.85)";
    setTimeout(() => dados.el.remove(), 200);

    _digitandoAtivos.delete(conversaId);
  }

  function ocultarDigitandoTodos() {
    for (const [id] of _digitandoAtivos) {
      ocultarDigitando(id);
    }
  }

  // -----------------------------------------------------------------------------
  // TOAST — feedback visual rápido
  // -----------------------------------------------------------------------------
  let _toastTimeout = null;

  function toast(mensagem, tipo = "info") {
    let container = document.getElementById("avseg-toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "avseg-toast-container";
      document.body.appendChild(container);
    }

    const el = document.createElement("div");
    el.className = `avseg-toast avseg-toast--${tipo}`;
    el.textContent = mensagem;
    container.appendChild(el);

    requestAnimationFrame(() => el.classList.add("avseg-toast--visivel"));

    setTimeout(() => {
      el.classList.remove("avseg-toast--visivel");
      setTimeout(() => el.remove(), 350);
    }, 3200);
  }

  // API pública
  return {
    tocarMensagem,
    tocarNovaConversa,
    atualizarBadge,
    mostrarDigitando,
    ocultarDigitando,
    ocultarDigitandoTodos,
    toast,
  };
})();

// Expõe globalmente para uso no dashboard.js
window.AVSEGNotify = AVSEGNotify;