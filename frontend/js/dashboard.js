const API_URL = window.location.origin;

let token = localStorage.getItem("avseg_token");
let usuario = JSON.parse(localStorage.getItem("avseg_usuario") || "null");

let conversas = [];
let conversaAtual = null;
let filtroAtual = "todas";
let filtroEtiqueta = null; // ID da etiqueta filtrada ou null
let buscaAtual = "";
let _ultimaDataMensagem = null;
let todasEtiquetas = []; // cache global de etiquetas
let _somHumanoTocado = new Set(); // evita tocar som múltiplas vezes

const socket = io(API_URL);

const userName = document.getElementById("userName");
const btnSair = document.getElementById("btnSair");
const btnLogoutMobile = document.getElementById("btnLogoutMobile");
const listaConversas = document.getElementById("listaConversas");
const searchConversas = document.getElementById("searchConversas");
const totalConversasEl = document.getElementById("totalConversas");
const aguardandoEl = document.getElementById("aguardando");
const chatVazio = document.getElementById("chatVazio");
const chatAtivo = document.getElementById("chatAtivo");
const chatClienteInicial = document.getElementById("chatClienteInicial");
const chatClienteNome = document.getElementById("chatClienteNome");
const chatClienteTelefone = document.getElementById("chatClienteTelefone");
const chatStatus = document.getElementById("chatStatus");
const btnAtribuir = document.getElementById("btnAtribuir");
const chatMensagens = document.getElementById("chatMensagens");
const chatInput = document.getElementById("chatInput");
const btnEnviar = document.getElementById("btnEnviar");
const chatAtendenteInfo = document.getElementById("chatAtendenteInfo");
const btnFinalizarConversa = document.getElementById("btnFinalizarConversa");
const btnReabrirConversa = document.getElementById("btnReabrirConversa");
const btnTransferirConversa = document.getElementById("btnTransferirConversa");
const btnAnexar = document.getElementById("btnAnexar");
const fileAnexo = document.getElementById("fileAnexo");
const anexoPreview = document.getElementById("anexoPreview");
const btnTemplates = document.getElementById("btnTemplates");
const templatesRapidos = document.getElementById("templatesRapidos");

let arquivoSelecionado = null;

let TEMPLATES_RAPIDOS = []; // carregado da API

// =============================================================================
// UTILITÁRIOS
// =============================================================================

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

function authHeadersSemJson() {
  return { Authorization: `Bearer ${token}` };
}

function sair() {
  localStorage.removeItem("avseg_token");
  localStorage.removeItem("avseg_usuario");
  window.location.href = "index.html";
}

function formatarHora(dataISO) {
  if (!dataISO) return "";
  const data = new Date(dataISO);
  const hoje = new Date();
  const mesmoDia =
    data.getDate() === hoje.getDate() &&
    data.getMonth() === hoje.getMonth() &&
    data.getFullYear() === hoje.getFullYear();
  if (mesmoDia) return data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function formatarTelefone(telefone) {
  const digitos = String(telefone || "").replace(/\D/g, "");
  if (digitos.startsWith("55") && digitos.length >= 12) {
    const ddd = digitos.slice(2, 4);
    const numero = digitos.slice(4);
    if (numero.length === 9) return `(${ddd}) ${numero.slice(0, 5)}-${numero.slice(5)}`;
    if (numero.length === 8) return `(${ddd}) ${numero.slice(0, 4)}-${numero.slice(4)}`;
  }
  return telefone || "-";
}

function primeiraLetra(nome) {
  return String(nome || "C").trim().charAt(0).toUpperCase() || "C";
}

function escaparHTML(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}

function svgIcon(nome, tamanho = 18) {
  const attrs = `width="${tamanho}" height="${tamanho}" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"`;
  const icons = {
    usuario:   `<svg viewBox="0 0 24 24" ${attrs}><path d="M20 21a8 8 0 0 0-16 0"></path><circle cx="12" cy="7" r="4"></circle></svg>`,
    imagem:    `<svg viewBox="0 0 24 24" ${attrs}><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="M21 15l-5-5L5 21"></path></svg>`,
    audio:     `<svg viewBox="0 0 24 24" ${attrs}><path d="M12 3v10"></path><path d="M8 7v6a4 4 0 0 0 8 0V7"></path><path d="M19 11a7 7 0 0 1-14 0"></path><path d="M12 18v3"></path></svg>`,
    video:     `<svg viewBox="0 0 24 24" ${attrs}><rect x="3" y="5" width="14" height="14" rx="2"></rect><path d="M17 10l4-2v8l-4-2z"></path></svg>`,
    clip:      `<svg viewBox="0 0 24 24" ${attrs}><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>`,
    pdf:       `<svg viewBox="0 0 24 24" ${attrs}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 15h1.5a1.5 1.5 0 0 0 0-3H8v6"></path><path d="M13 12v6h1a3 3 0 0 0 0-6h-1"></path></svg>`,
    texto:     `<svg viewBox="0 0 24 24" ${attrs}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h6"></path></svg>`,
    planilha:  `<svg viewBox="0 0 24 24" ${attrs}><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 10h18"></path><path d="M9 4v16"></path><path d="M15 4v16"></path></svg>`,
    zip:       `<svg viewBox="0 0 24 24" ${attrs}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M10 4h2"></path><path d="M12 6h-2"></path></svg>`,
    tag:       `<svg viewBox="0 0 24 24" ${attrs}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>`,
  };
  return icons[nome] || icons.clip;
}


// =============================================================================
// HUMANO PENDENTE — HELPERS
// =============================================================================

function estaHumanoPendente(conversa) {
  // Ativa se: solicitouHumano=true OU (aguardando sem atendente)
  if (conversa.solicitouHumano) return true;
  if (conversa.status === 'aguardando' && !conversa.atendenteId) return true;
  return false;
}

function tocarSomHumano(conversaId) {
  if (_somHumanoTocado.has(conversaId)) return;
  _somHumanoTocado.add(conversaId);
  if (!window.AVSEGNotify) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ac = new AudioCtx();
    [0, 0.15, 0.3].forEach((delay, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain); gain.connect(ac.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime([660, 880, 1100][i], ac.currentTime + delay);
      gain.gain.setValueAtTime(0, ac.currentTime + delay);
      gain.gain.linearRampToValueAtTime(0.14, ac.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + delay + 0.2);
      osc.start(ac.currentTime + delay);
      osc.stop(ac.currentTime + delay + 0.22);
    });
  } catch(_) {}
}

// =============================================================================
// BADGE NA ABA
// =============================================================================

function _recalcularBadge() {
  const total = conversas.reduce((acc, c) => acc + (c.mensagensNaoLidas || 0), 0);
  if (window.AVSEGNotify) AVSEGNotify.atualizarBadge(total);
}

// =============================================================================
// ETIQUETAS — HELPERS
// =============================================================================

function hexParaRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

function renderizarEtiquetaTag(etiqueta, modo = "lista") {
  const rgb = hexParaRgb(etiqueta.cor || "#f5c400");
  const style = `background: rgba(${rgb}, 0.15); color: ${etiqueta.cor}; border: 1px solid rgba(${rgb}, 0.35);`;

  if (modo === "lista") {
    return `<span class="etiqueta-tag" style="${style}"><span class="etiqueta-dot" style="background:${etiqueta.cor}"></span>${escaparHTML(etiqueta.nome)}</span>`;
  }

  // modo "chat" — com botão de remover
  return `
    <span class="chat-etiqueta-tag" style="${style}" data-etiqueta-id="${etiqueta.id}">
      ${escaparHTML(etiqueta.nome)}
      <button class="chat-etiqueta-remover" data-etiqueta-id="${etiqueta.id}" title="Remover etiqueta">×</button>
    </span>
  `;
}

// =============================================================================
// ETIQUETAS — CARREGAR
// =============================================================================


async function carregarTemplates() {
  try {
    const resposta = await fetch(`${API_URL}/api/templates`, { headers: authHeaders() });
    if (!resposta.ok) return;
    TEMPLATES_RAPIDOS = await resposta.json();
  } catch (_) {}
}

async function carregarEtiquetas() {
  try {
    const resposta = await fetch(`${API_URL}/api/etiquetas`, { headers: authHeaders() });
    if (!resposta.ok) return;
    todasEtiquetas = await resposta.json();
    renderizarFiltrosEtiqueta();
  } catch (_) {}
}

// =============================================================================
// ETIQUETAS — FILTRO NA SIDEBAR
// =============================================================================

function renderizarFiltrosEtiqueta() {
  const container = document.getElementById("sidebarEtiquetasFiltro");
  if (!container) return;

  if (!todasEtiquetas.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <p class="sidebar-etiquetas-titulo">Por etiqueta</p>
    ${todasEtiquetas.map((e) => `
      <button class="filtro-etiqueta-btn ${filtroEtiqueta === e.id ? "active" : ""}"
              data-etiqueta-id="${e.id}">
        <span class="filtro-etiqueta-bolinha" style="background:${e.cor}"></span>
        ${escaparHTML(e.nome)}
      </button>
    `).join("")}
    ${filtroEtiqueta ? `<button class="filtro-etiqueta-btn" data-etiqueta-id="limpar" style="opacity:.6;font-size:12px">✕ Limpar filtro</button>` : ""}
  `;
}

// =============================================================================
// ETIQUETAS — HEADER DO CHAT
// =============================================================================

function renderizarEtiquetasNoChat(conversa) {
  const container = document.getElementById("chatEtiquetasRow");
  if (!container) return;

  const idsAplicados = Array.isArray(conversa?.etiquetas) ? conversa.etiquetas : [];
  const finalizada = conversa?.status === "finalizada";

  const tagsHTML = idsAplicados.map((id) => {
    const etiqueta = todasEtiquetas.find((e) => e.id === id);
    return etiqueta ? renderizarEtiquetaTag(etiqueta, "chat") : "";
  }).join("");

  const btnAdicionar = finalizada ? "" : `
    <div class="etiquetas-wrapper" id="etiquetasWrapperBtn">
      <button class="btn-adicionar-etiqueta" id="btnAdicionarEtiqueta" type="button">
        ${svgIcon("tag", 13)} Etiqueta
      </button>
    </div>
  `;

  container.innerHTML = tagsHTML + btnAdicionar;
}

// Dropdown de seleção
function abrirDropdownEtiquetas() {
  fecharDropdownEtiquetas();

  const wrapper = document.getElementById("etiquetasWrapperBtn");
  if (!wrapper || !conversaAtual) return;

  const idsAplicados = Array.isArray(conversaAtual.etiquetas) ? conversaAtual.etiquetas : [];

  const itens = todasEtiquetas.length
    ? todasEtiquetas.map((e) => {
        const aplicada = idsAplicados.includes(e.id);
        return `
          <button class="etiquetas-dropdown-item ${aplicada ? "aplicada" : ""}"
                  data-id="${e.id}" type="button">
            <span class="etiqueta-cor-bolinha" style="background:${e.cor}"></span>
            ${escaparHTML(e.nome)}
          </button>
        `;
      }).join("")
    : `<div class="etiquetas-dropdown-vazio">Nenhuma etiqueta criada.</div>`;

  const dropdown = document.createElement("div");
  dropdown.className = "etiquetas-dropdown";
  dropdown.id = "etiquetasDropdown";
  dropdown.innerHTML = itens;
  wrapper.appendChild(dropdown);
}

function fecharDropdownEtiquetas() {
  document.getElementById("etiquetasDropdown")?.remove();
}

// =============================================================================
// ETIQUETAS — APLICAR / REMOVER
// =============================================================================

async function aplicarEtiqueta(etiquetaId) {
  if (!conversaAtual) return;
  const idsAplicados = Array.isArray(conversaAtual.etiquetas) ? conversaAtual.etiquetas : [];
  if (idsAplicados.includes(etiquetaId)) {
    await removerEtiqueta(etiquetaId);
    return;
  }

  try {
    const resposta = await fetch(`${API_URL}/api/conversas/${conversaAtual.id}/etiquetas`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ etiquetaId }),
    });
    if (!resposta.ok) return;
    const atualizada = await resposta.json();
    _atualizarConversaLocal(atualizada);
    fecharDropdownEtiquetas();
    if (window.AVSEGNotify) AVSEGNotify.toast("Etiqueta aplicada!", "sucesso");
  } catch (_) {}
}

async function removerEtiqueta(etiquetaId) {
  if (!conversaAtual) return;
  try {
    const resposta = await fetch(
      `${API_URL}/api/conversas/${conversaAtual.id}/etiquetas/${etiquetaId}`,
      { method: "DELETE", headers: authHeaders() }
    );
    if (!resposta.ok) return;
    const atualizada = await resposta.json();
    _atualizarConversaLocal(atualizada);
    if (window.AVSEGNotify) AVSEGNotify.toast("Etiqueta removida.", "aviso");
  } catch (_) {}
}

function _atualizarConversaLocal(atualizada) {
  conversas = conversas.map((c) => c.id === atualizada.id ? { ...c, ...atualizada } : c);
  conversaAtual = { ...conversaAtual, ...atualizada };
  renderizarEtiquetasNoChat(conversaAtual);
  renderizarConversas();
}

// =============================================================================
// ETIQUETAS — MODAL ADMIN
// =============================================================================

function abrirModalEtiquetas() {
  const modal = document.getElementById("modalEtiquetas");
  if (!modal) return;
  modal.style.display = "flex";
  carregarEtiquetasAdmin();
}

function fecharModalEtiquetas() {
  const modal = document.getElementById("modalEtiquetas");
  if (modal) modal.style.display = "none";
}

async function carregarEtiquetasAdmin() {
  const lista = document.getElementById("listaEtiquetasAdmin");
  if (!lista) return;
  lista.innerHTML = `<div class="loading">Carregando etiquetas...</div>`;

  await carregarTemplates();
  await carregarEtiquetas();

  if (!todasEtiquetas.length) {
    lista.innerHTML = `<div class="loading">Nenhuma etiqueta criada ainda.</div>`;
    return;
  }

  lista.innerHTML = todasEtiquetas.map((e) => `
    <div class="etiqueta-admin-item">
      <span class="etiqueta-admin-cor" style="background:${e.cor}"></span>
      <span class="etiqueta-admin-nome">${escaparHTML(e.nome)}</span>
      <div class="etiqueta-admin-acoes">
        <button class="btn-excluir-etiqueta" data-id="${e.id}" data-nome="${escaparHTML(e.nome)}">
          Excluir
        </button>
      </div>
    </div>
  `).join("");
}

async function criarEtiqueta(e) {
  e.preventDefault();
  const nome = document.getElementById("novaEtiquetaNome")?.value.trim();
  const cor  = document.getElementById("novaEtiquetaCor")?.value || "#f5c400";
  const erroEl = document.getElementById("erroEtiqueta");

  if (!nome) {
    if (erroEl) { erroEl.textContent = "Informe o nome da etiqueta."; erroEl.style.display = "block"; }
    return;
  }
  if (erroEl) { erroEl.textContent = ""; erroEl.style.display = "none"; }

  try {
    const resposta = await fetch(`${API_URL}/api/etiquetas`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ nome, cor }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) {
      if (erroEl) { erroEl.textContent = dados.erro || "Erro ao criar etiqueta."; erroEl.style.display = "block"; }
      return;
    }
    document.getElementById("formNovaEtiqueta")?.reset();
    document.getElementById("novaEtiquetaCor").value = "#f5c400";
    await carregarEtiquetasAdmin();
    if (window.AVSEGNotify) AVSEGNotify.toast("Etiqueta criada!", "sucesso");
  } catch (_) {
    if (erroEl) { erroEl.textContent = "Erro de conexão."; erroEl.style.display = "block"; }
  }
}

async function excluirEtiqueta(id, nome) {
  if (!confirm(`Excluir a etiqueta "${nome}"?\n\nEla será removida de todas as conversas.`)) return;
  try {
    const resposta = await fetch(`${API_URL}/api/etiquetas/${id}`, {
      method: "DELETE", headers: authHeaders(),
    });
    if (!resposta.ok) { alert("Erro ao excluir etiqueta."); return; }
    await carregarEtiquetasAdmin();
    renderizarConversas();
    if (conversaAtual) renderizarEtiquetasNoChat(conversaAtual);
    if (window.AVSEGNotify) AVSEGNotify.toast("Etiqueta excluída.", "aviso");
  } catch (_) {}
}

// =============================================================================
// AUTENTICAÇÃO
// =============================================================================

async function verificarAutenticacao() {
  if (!token) { window.location.href = "index.html"; return; }
  try {
    const resposta = await fetch(`${API_URL}/api/auth/verificar`, { headers: authHeaders() });
    if (!resposta.ok) { sair(); return; }
    const dados = await resposta.json();
    usuario = dados.usuario;
    localStorage.setItem("avseg_usuario", JSON.stringify(usuario));
    userName.textContent = usuario.nome || usuario.email;

    // Mostra botão de etiquetas apenas para admin
    const btnEtiquetas = document.getElementById("btnAbrirEtiquetas");
    if (btnEtiquetas) btnEtiquetas.style.display = usuario.role === "admin" ? "flex" : "none";
  } catch (_) { sair(); }
}

// =============================================================================
// CONVERSAS
// =============================================================================

async function carregarConversas() {
  try {
    const resposta = await fetch(`${API_URL}/api/conversas`, { headers: authHeaders() });
    if (!resposta.ok) { if (resposta.status === 401) sair(); return; }
    conversas = await resposta.json();
    renderizarConversas();
    atualizarEstatisticas();
    _recalcularBadge();
  } catch (erro) {
    listaConversas.innerHTML = `<div class="loading">Erro ao carregar conversas.</div>`;
  }
}

function atualizarEstatisticas() {
  totalConversasEl.textContent = conversas.filter((c) => c.status !== "finalizada").length;
  aguardandoEl.textContent = conversas.filter((c) => c.status === "aguardando").length;
}

function filtrarConversas() {
  return conversas.filter((conversa) => {
    let passaFiltro = true;
    if (filtroAtual === "minhas") passaFiltro = conversa.atendenteId === usuario?.id;
    else if (filtroAtual !== "todas") passaFiltro = conversa.status === filtroAtual;

    // Filtro por etiqueta
    if (filtroEtiqueta && passaFiltro) {
      passaFiltro = Array.isArray(conversa.etiquetas) && conversa.etiquetas.includes(filtroEtiqueta);
    }

    const termo = buscaAtual.toLowerCase();
    const passaBusca =
      !termo ||
      String(conversa.clienteNome || "").toLowerCase().includes(termo) ||
      String(conversa.telefone || "").toLowerCase().includes(termo);

    return passaFiltro && passaBusca;
  });
}

function formatarUltimaMensagem(conversa) {
  const texto = conversa.ultimaMensagem || "";
  const tipo = conversa.ultimaMensagemTipo || "";
  if (tipo === "imagem") return "Imagem enviada";
  if (tipo === "audio") return "Áudio enviado";
  if (tipo === "video") return "Vídeo enviado";
  if (tipo === "arquivo") return "Arquivo enviado";
  return texto || "Sem mensagens";
}

function iconeUltimaMensagem(conversa) {
  const tipo = conversa.ultimaMensagemTipo || "";
  if (tipo === "imagem") return svgIcon("imagem", 18);
  if (tipo === "audio") return svgIcon("audio", 18);
  if (tipo === "video") return svgIcon("video", 18);
  if (tipo === "arquivo") return svgIcon("clip", 18);
  return "";
}

function separarConversas() {
  const lista = filtrarConversas();

  function dataOrdem(c) {
    const d = new Date(c.ultimaMensagemData || c.atualizadoEm || c.criadoEm || 0);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  const humanos = lista.filter(estaHumanoPendente).sort((a, b) => dataOrdem(b) - dataOrdem(a));
  const normais = lista.filter((c) => !estaHumanoPendente(c)).sort((a, b) => dataOrdem(b) - dataOrdem(a));
  return { humanos, normais };
}

function _renderizarItemConversa(conversa) {
  const item = document.createElement("div");
  item.className = "conversa-item";
  item.dataset.conversaId = conversa.id;
  if (conversaAtual?.id === conversa.id) item.classList.add("active");

  const humano = estaHumanoPendente(conversa);
  if (humano) {
    item.classList.add("humano-pendente");
    tocarSomHumano(conversa.id);
  }

  const badge = conversa.mensagensNaoLidas > 0
    ? `<span class="conversa-badge">${conversa.mensagensNaoLidas}</span>`
    : `<span class="conversa-badge" style="display:none;">0</span>`;

  const badgeHumano = humano
    ? `<span class="badge-humano">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M20 21a8 8 0 0 0-16 0"></path><circle cx="12" cy="7" r="4"></circle>
        </svg>
        Humano
      </span>`
    : "";

  const idsEtiquetas = Array.isArray(conversa.etiquetas) ? conversa.etiquetas : [];
  const etiquetasHTML = idsEtiquetas.length
    ? `<div class="conversa-etiquetas">${idsEtiquetas.map((id) => {
        const et = todasEtiquetas.find((e) => e.id === id);
        return et ? renderizarEtiquetaTag(et, "lista") : "";
      }).join("")}</div>`
    : "";

  item.innerHTML = `
    <div class="conversa-avatar">
      <span class="conversa-inicial">${primeiraLetra(conversa.clienteNome)}</span>
    </div>
    <div class="conversa-info">
      <div class="conversa-header">
        <h4 class="conversa-nome">${escaparHTML(conversa.clienteNome || "Cliente")}</h4>
        <span class="conversa-hora">${formatarHora(conversa.ultimaMensagemData)}</span>
      </div>
      <div class="conversa-footer">
        <p class="conversa-ultima-msg">${iconeUltimaMensagem(conversa)}<span>${escaparHTML(formatarUltimaMensagem(conversa))}</span></p>
        ${badge}
      </div>
      ${conversa.atendenteNome ? `<small class="conversa-atendente">${svgIcon("usuario", 15)} <span>${escaparHTML(conversa.atendenteNome)}</span></small>` : ""}
      <div class="conversa-etiquetas-row">
        ${badgeHumano}
        ${etiquetasHTML}
      </div>
    </div>
    <div class="conversa-status ${conversa.status || "aguardando"}"></div>
  `;
  item.addEventListener("click", () => abrirConversa(conversa.id));
  return item;
}

function renderizarConversas() {
  const { humanos, normais } = separarConversas();
  const total = humanos.length + normais.length;

  if (!total) {
    listaConversas.innerHTML = `<div class="loading">Nenhuma conversa encontrada.</div>`;
    return;
  }

  listaConversas.innerHTML = "";

  // Seção prioritária — atendimento humano
  if (humanos.length) {
    const secaoHumano = document.createElement("div");
    secaoHumano.className = "conversas-secao-titulo urgente";
    secaoHumano.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M20 21a8 8 0 0 0-16 0"></path><circle cx="12" cy="7" r="4"></circle>
      </svg>
      Aguardando atendimento humano
      <span class="conversas-secao-count">${humanos.length}</span>
    `;
    listaConversas.appendChild(secaoHumano);
    humanos.forEach((c) => listaConversas.appendChild(_renderizarItemConversa(c)));
  }

  // Seção normal
  if (normais.length) {
    if (humanos.length) {
      const secaoNormal = document.createElement("div");
      secaoNormal.className = "conversas-secao-titulo";
      secaoNormal.innerHTML = `Demais conversas`;
      listaConversas.appendChild(secaoNormal);
    }
    normais.forEach((c) => listaConversas.appendChild(_renderizarItemConversa(c)));
  }
}

// =============================================================================
// ABRIR CONVERSA
// =============================================================================

async function abrirConversa(conversaId) {
  const conversa = conversas.find((c) => c.id === conversaId);
  if (!conversa) return;

  if (conversaAtual?.id) socket.emit("sair_conversa", conversaAtual.id);

  _ultimaDataMensagem = null;
  conversaAtual = conversa;
  socket.emit("entrar_conversa", conversaAtual.id);

  chatVazio.style.display = "none";
  chatAtivo.style.display = "flex";

  chatClienteInicial.textContent = primeiraLetra(conversa.clienteNome);
  chatClienteNome.textContent = conversa.clienteNome || "Cliente";
  chatClienteTelefone.textContent = formatarTelefone(conversa.telefone);
  chatStatus.value = conversa.status || "aguardando";
  atualizarInfoAtendente(conversa);
  atualizarBotoesConversa(conversa);
  renderizarEtiquetasNoChat(conversa);
  renderizarConversas();

  await carregarMensagens(conversa.id);
  await marcarComoLidas(conversa.id);
  document.body.classList.add("chat-mobile-aberto");
}

// =============================================================================
// MENSAGENS
// =============================================================================

async function carregarMensagens(conversaId) {
  try {
    chatMensagens.innerHTML = `<div class="loading">Carregando mensagens...</div>`;
    const resposta = await fetch(`${API_URL}/api/conversas/${conversaId}/mensagens`, { headers: authHeaders() });
    if (!resposta.ok) { chatMensagens.innerHTML = `<div class="loading">Erro ao carregar mensagens.</div>`; return; }
    const mensagens = await resposta.json();
    chatMensagens.innerHTML = "";
    _ultimaDataMensagem = null;
    mensagens.forEach((m) => adicionarMensagemNaTela(m));
    rolarParaBaixo();
  } catch (_) {
    chatMensagens.innerHTML = `<div class="loading">Erro ao carregar mensagens.</div>`;
  }
}

function iconeArquivo(mimeType = "", nomeArquivo = "") {
  const nome = nomeArquivo.toLowerCase();
  if (mimeType.includes("pdf") || nome.endsWith(".pdf")) return svgIcon("pdf", 24);
  if (mimeType.includes("word") || nome.endsWith(".doc") || nome.endsWith(".docx")) return svgIcon("texto", 24);
  if (mimeType.includes("excel") || nome.endsWith(".xls") || nome.endsWith(".xlsx")) return svgIcon("planilha", 24);
  if (mimeType.includes("zip") || nome.endsWith(".zip") || nome.endsWith(".rar")) return svgIcon("zip", 24);
  if (mimeType.includes("video")) return svgIcon("video", 24);
  if (mimeType.includes("audio")) return svgIcon("audio", 24);
  if (mimeType.includes("image")) return svgIcon("imagem", 24);
  return svgIcon("clip", 24);
}

function adicionarMensagemNaTela(mensagem) {
  const dataMensagem = mensagem.criadoEm ? new Date(mensagem.criadoEm).toLocaleDateString("pt-BR") : null;
  if (dataMensagem && dataMensagem !== _ultimaDataMensagem) {
    _ultimaDataMensagem = dataMensagem;
    const hoje  = new Date().toLocaleDateString("pt-BR");
    const ontem = new Date(Date.now() - 86400000).toLocaleDateString("pt-BR");
    let label = dataMensagem;
    if (dataMensagem === hoje) label = "Hoje";
    else if (dataMensagem === ontem) label = "Ontem";
    const sep = document.createElement("div");
    sep.className = "mensagem-data-separador";
    sep.textContent = label;
    chatMensagens.appendChild(sep);
  }

  const div = document.createElement("div");
  div.className = `mensagem ${mensagem.origem === "atendente" ? "atendente" : mensagem.origem === "sistema" ? "sistema" : "cliente"}`;

  const tipo = mensagem.tipo || "texto";
  const arquivoUrl  = mensagem.arquivoUrl  || "";
  const nomeArquivo = mensagem.nomeArquivo || "Arquivo enviado";
  const mimeType    = mensagem.mimeType    || "";
  let conteudo = "";

  if (tipo === "imagem" && arquivoUrl) {
    conteudo = `<div class="mensagem-midia"><img src="${arquivoUrl}" alt="Imagem enviada" class="mensagem-imagem" data-url="${arquivoUrl}"></div>${mensagem.texto ? `<p class="mensagem-texto legenda-midia">${escaparHTML(mensagem.texto)}</p>` : ""}`;
  } else if (tipo === "audio" && arquivoUrl) {
    conteudo = `<div class="mensagem-midia"><audio controls class="mensagem-audio"><source src="${arquivoUrl}" type="${mimeType || "audio/mpeg"}">Seu navegador não suporta áudio.</audio></div>${mensagem.texto ? `<p class="mensagem-texto legenda-midia">${escaparHTML(mensagem.texto)}</p>` : ""}`;
  } else if (tipo === "video" && arquivoUrl) {
    conteudo = `<div class="mensagem-midia"><video controls class="mensagem-video"><source src="${arquivoUrl}" type="${mimeType || "video/mp4"}">Seu navegador não suporta vídeo.</video></div>${mensagem.texto ? `<p class="mensagem-texto legenda-midia">${escaparHTML(mensagem.texto)}</p>` : ""}`;
  } else if (arquivoUrl) {
    conteudo = `<div class="mensagem-arquivo-card"><div class="arquivo-icone">${iconeArquivo(mimeType, nomeArquivo)}</div><div class="arquivo-info"><strong>${escaparHTML(nomeArquivo)}</strong><span>${escaparHTML(mimeType || "Arquivo")}</span></div><div class="arquivo-acoes"><a href="${arquivoUrl}" target="_blank" class="arquivo-btn">Abrir</a><a href="${arquivoUrl}" download="${escaparHTML(nomeArquivo)}" class="arquivo-btn">Baixar</a></div></div>${mensagem.texto ? `<p class="mensagem-texto legenda-midia">${escaparHTML(mensagem.texto)}</p>` : ""}`;
  } else if (tipo === "sistema" || mensagem.origem === "sistema") {
    conteudo = `<p class="mensagem-texto mensagem-sistema-texto">${escaparHTML(mensagem.texto || "")}</p>`;
  } else {
    conteudo = `<p class="mensagem-texto">${escaparHTML(mensagem.texto || "")}</p>`;
  }

  div.innerHTML = `<div class="mensagem-conteudo">${conteudo}<span class="mensagem-hora">${formatarHora(mensagem.criadoEm)}</span></div>`;
  chatMensagens.appendChild(div);
}

function rolarParaBaixo() {
  chatMensagens.scrollTop = chatMensagens.scrollHeight;
}

// =============================================================================
// UPLOAD / ANEXO
// =============================================================================

function detectarTipoArquivo(file) {
  const mime = file?.type || "";
  if (mime.startsWith("image/")) return "imagem";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "arquivo";
}

function formatarTamanhoArquivo(bytes = 0) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function selecionarArquivo(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) { alert("Arquivo muito grande. Limite: 25MB."); fileAnexo.value = ""; return; }
  arquivoSelecionado = file;
  renderizarPreviewAnexo();
}

function limparAnexo() {
  arquivoSelecionado = null;
  if (fileAnexo) fileAnexo.value = "";
  if (anexoPreview) { anexoPreview.style.display = "none"; anexoPreview.innerHTML = ""; }
}

function renderizarPreviewAnexo() {
  if (!anexoPreview || !arquivoSelecionado) return;
  const tipo = detectarTipoArquivo(arquivoSelecionado);
  let preview = tipo === "imagem"
    ? `<img src="${URL.createObjectURL(arquivoSelecionado)}" alt="Preview" class="anexo-preview-img">`
    : `<div class="anexo-preview-icone">${iconeArquivo(arquivoSelecionado.type, arquivoSelecionado.name)}</div>`;
  anexoPreview.innerHTML = `<div class="anexo-preview-card">${preview}<div class="anexo-preview-info"><strong>${escaparHTML(arquivoSelecionado.name)}</strong><span>${escaparHTML(arquivoSelecionado.type || "Arquivo")} • ${formatarTamanhoArquivo(arquivoSelecionado.size)}</span></div><button type="button" class="anexo-preview-remover" onclick="limparAnexo()">×</button></div>`;
  anexoPreview.style.display = "block";
}

async function uploadArquivoSelecionado() {
  if (!arquivoSelecionado) return null;
  const formData = new FormData();
  formData.append("arquivo", arquivoSelecionado);
  const resposta = await fetch(`${API_URL}/api/upload`, { method: "POST", headers: authHeadersSemJson(), body: formData });
  const dados = await resposta.json();
  if (!resposta.ok) throw new Error(dados.erro || "Erro ao enviar arquivo.");
  return dados;
}

// =============================================================================
// TEMPLATES RÁPIDOS
// =============================================================================

function renderizarTemplatesRapidos(filtro = "") {
  if (!templatesRapidos) return;
  const termo = filtro.toLowerCase().replace(/^\//, "");
  const lista = TEMPLATES_RAPIDOS.filter((t) => !termo || t.atalho.toLowerCase().includes(termo) || t.titulo.toLowerCase().includes(termo) || t.texto.toLowerCase().includes(termo));
  if (!lista.length) { templatesRapidos.innerHTML = `<div class="template-vazio">Nenhuma resposta rápida encontrada.</div>`; templatesRapidos.style.display = "block"; return; }
  templatesRapidos.innerHTML = lista.map((t) => `<button type="button" class="template-item" data-atalho="${t.atalho}"><div class="template-topo"><strong>${escaparHTML(t.titulo)}</strong><span>${escaparHTML(t.atalho)}</span></div><p>${escaparHTML(t.texto)}</p></button>`).join("");
  templatesRapidos.style.display = "block";
}

function esconderTemplatesRapidos() {
  if (templatesRapidos) templatesRapidos.style.display = "none";
}

function inserirTemplate(idOuAtalho) {
  const t = TEMPLATES_RAPIDOS.find((x) => x.id === idOuAtalho || x.atalho === idOuAtalho);
  if (!t) return;
  const val = chatInput.value.trim();
  chatInput.value = val.startsWith("/") ? t.texto : val ? `${val}\n${t.texto}` : t.texto;
  esconderTemplatesRapidos();
  ajustarAlturaTextarea();
  chatInput.focus();
}

// =============================================================================
// ENVIAR MENSAGEM
// =============================================================================

async function enviarMensagem() {
  const texto = chatInput.value.trim();
  if ((!texto && !arquivoSelecionado) || !conversaAtual) return;
  if (conversaAtual.status === "finalizada") { alert("Conversa finalizada. Reabra antes de responder."); return; }

  btnEnviar.disabled = true; chatInput.disabled = true;
  if (btnAnexar) btnAnexar.disabled = true;
  if (btnTemplates) btnTemplates.disabled = true;

  try {
    let arquivo = null;
    if (arquivoSelecionado) arquivo = await uploadArquivoSelecionado();
    const payload = { texto };
    if (arquivo) { payload.tipo = arquivo.tipo; payload.arquivoUrl = arquivo.arquivoUrl; payload.mimeType = arquivo.mimeType; payload.nomeArquivo = arquivo.nomeArquivo; }
    const resposta = await fetch(`${API_URL}/api/conversas/${conversaAtual.id}/mensagens`, { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) });
    const dados = await resposta.json();
    if (!resposta.ok) { alert(dados.erro || "Erro ao enviar mensagem."); return; }
    chatInput.value = ""; limparAnexo(); esconderTemplatesRapidos(); ajustarAlturaTextarea();
    await carregarConversas();
  } catch (erro) {
    alert(erro.message || "Erro de conexão ao enviar mensagem.");
  } finally {
    atualizarBotoesConversa(conversaAtual);
    if (conversaAtual?.status !== "finalizada") chatInput.focus();
  }
}

async function marcarComoLidas(conversaId) {
  try {
    await fetch(`${API_URL}/api/conversas/${conversaId}/mensagens/marcar-lidas`, { method: "PATCH", headers: authHeaders() });
    const conversa = conversas.find((c) => c.id === conversaId);
    if (conversa) conversa.mensagensNaoLidas = 0;
    renderizarConversas(); atualizarEstatisticas(); _recalcularBadge();
  } catch (_) {}
}

// =============================================================================
// STATUS / ATENDENTE
// =============================================================================

async function atualizarStatus(status) {
  if (!conversaAtual) return;
  try {
    const resposta = await fetch(`${API_URL}/api/conversas/${conversaAtual.id}`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ status }) });
    if (!resposta.ok) return;
    const atualizada = await resposta.json();
    conversas = conversas.map((c) => c.id === atualizada.id ? { ...c, ...atualizada } : c);
    conversaAtual = { ...conversaAtual, ...atualizada };
    chatStatus.value = conversaAtual.status;
    atualizarInfoAtendente(conversaAtual); atualizarBotoesConversa(conversaAtual);
    renderizarConversas(); atualizarEstatisticas();
  } catch (_) {}
}

async function assumirConversa() {
  if (!conversaAtual || !usuario) return;
  try {
    const resposta = await fetch(`${API_URL}/api/conversas/${conversaAtual.id}`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ assumir: true }) });
    const atualizada = await resposta.json();
    if (!resposta.ok) { alert(atualizada.erro || "Erro ao assumir conversa."); return; }
    conversas = conversas.map((c) => c.id === atualizada.id ? { ...c, ...atualizada } : c);
    conversaAtual = { ...conversaAtual, ...atualizada };
    chatStatus.value = conversaAtual.status;

    // Desativa flag de humano pendente
    if (conversaAtual.solicitouHumano) {
      try {
        await fetch(`${API_URL}/api/conversas/${conversaAtual.id}/humano`, {
          method: "PATCH", headers: authHeaders(), body: JSON.stringify({ ativo: false }),
        });
        conversaAtual.solicitouHumano = false;
        conversas = conversas.map((c) => c.id === conversaAtual.id ? { ...c, solicitouHumano: false } : c);
        _somHumanoTocado.delete(conversaAtual.id);
      } catch (_) {}
    }

    atualizarInfoAtendente(conversaAtual); atualizarBotoesConversa(conversaAtual);
    renderizarConversas(); atualizarEstatisticas();
    if (window.AVSEGNotify) AVSEGNotify.toast("Conversa assumida!", "sucesso");
  } catch (_) { alert("Erro de conexão ao assumir conversa."); }
}

function atualizarInfoAtendente(conversa) {
  if (!chatAtendenteInfo) return;
  if (conversa?.atendenteNome) { chatAtendenteInfo.textContent = `Atendente: ${conversa.atendenteNome}`; chatAtendenteInfo.classList.add("com-atendente"); }
  else { chatAtendenteInfo.textContent = "Sem atendente responsável"; chatAtendenteInfo.classList.remove("com-atendente"); }

  // Banner de humano pendente
  const bannerExistente = document.getElementById("chatHumanoBanner");
  if (bannerExistente) bannerExistente.remove();

  if (estaHumanoPendente(conversa) && conversa.status !== "finalizada") {
    const banner = document.createElement("div");
    banner.id = "chatHumanoBanner";
    banner.className = "chat-humano-banner";
    banner.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M20 21a8 8 0 0 0-16 0"></path><circle cx="12" cy="7" r="4"></circle>
      </svg>
      Cliente aguardando atendimento humano — assuma a conversa para iniciar
    `;
    // Insere após o header do chat
    const chatHeader = document.querySelector(".chat-header");
    if (chatHeader?.nextSibling) {
      chatHeader.parentNode.insertBefore(banner, chatHeader.nextSibling);
    }
  }
}

function atualizarBotoesConversa(conversa) {
  if (!chatInput || !btnEnviar) return;
  const finalizada = conversa?.status === "finalizada";
  if (btnFinalizarConversa) btnFinalizarConversa.style.display = finalizada ? "none" : "inline-flex";
  if (btnReabrirConversa) btnReabrirConversa.style.display = finalizada ? "inline-flex" : "none";
  if (btnAtribuir) btnAtribuir.style.display = finalizada ? "none" : "inline-flex";
  if (btnTransferirConversa) btnTransferirConversa.style.display = finalizada ? "none" : "inline-flex";
  chatInput.disabled = finalizada; btnEnviar.disabled = finalizada;
  if (btnAnexar) btnAnexar.disabled = finalizada;
  if (btnTemplates) btnTemplates.disabled = finalizada;
  chatInput.placeholder = finalizada ? "Conversa finalizada. Reabra para responder." : "Digite sua mensagem... ou / para respostas rápidas";
}

async function finalizarConversa() {
  if (!conversaAtual || !confirm("Deseja finalizar esta conversa?")) return;
  await atualizarStatus("finalizada");
}

async function reabrirConversa() {
  if (!conversaAtual) return;
  await atualizarStatus("aguardando");
}

function ajustarAlturaTextarea() {
  chatInput.style.height = "auto";
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
}

// =============================================================================
// MODAIS — IMAGEM
// =============================================================================

function abrirModalImagem(url) {
  const modal = document.getElementById("modalImagem");
  const imagem = document.getElementById("imagemAmpliada");
  if (!modal || !imagem || !url) return;
  imagem.src = url; modal.style.display = "flex"; document.body.classList.add("modal-aberto");
}

function fecharModalImagem() {
  const modal = document.getElementById("modalImagem");
  const imagem = document.getElementById("imagemAmpliada");
  if (!modal || !imagem) return;
  modal.style.display = "none"; imagem.src = ""; document.body.classList.remove("modal-aberto");
}

async function baixarImagemAtual() {
  const imagem = document.getElementById("imagemAmpliada");
  const url = imagem?.src;
  if (!url) return;
  try {
    const blob = await (await fetch(url)).blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = `imagem-avseg-${Date.now()}.jpg`;
    document.body.appendChild(link); link.click(); link.remove();
  } catch (_) {
    const link = document.createElement("a");
    link.href = url; link.target = "_blank"; link.download = `imagem-avseg-${Date.now()}.jpg`; link.click();
  }
}

// =============================================================================
// MODAIS — ATENDENTES
// =============================================================================

function abrirModalAtendentes() { const m = document.getElementById("modalAtendentes"); if (m) { m.style.display = "flex"; carregarAtendentes(); } }
function fecharModalAtendentes() { const m = document.getElementById("modalAtendentes"); if (m) m.style.display = "none"; }
function primeiraLetraUsuario(nome, email) { return (nome || email || "U").trim().charAt(0).toUpperCase(); }
function mostrarErroAtendente(msg) { const e = document.getElementById("erroAtendente"); if (e) { e.textContent = msg; e.style.display = "block"; } }
function esconderErroAtendente() { const e = document.getElementById("erroAtendente"); if (e) { e.textContent = ""; e.style.display = "none"; } }

async function carregarAtendentes() {
  const lista = document.getElementById("listaAtendentes");
  if (!lista) return;
  lista.innerHTML = `<div class="loading">Carregando atendentes...</div>`;
  try {
    const resposta = await fetch(`${API_URL}/api/usuarios`, { headers: authHeaders() });
    const dados = await resposta.json();
    if (!resposta.ok) { lista.innerHTML = `<div class="loading">${dados.erro || "Erro."}</div>`; return; }
    if (!dados.length) { lista.innerHTML = `<div class="loading">Nenhum usuário cadastrado.</div>`; return; }
    lista.innerHTML = "";
    dados.forEach((a) => {
      const item = document.createElement("div");
      item.className = "atendente-item";
      const podeExcluir = usuario?.role === "admin" && a.id !== usuario.id;
      item.innerHTML = `<div class="atendente-avatar">${primeiraLetraUsuario(a.nome, a.email)}</div><div class="atendente-info"><h5>${escaparHTML(a.nome || "Sem nome")}</h5><p>${escaparHTML(a.email || "")}</p></div><div class="atendente-acoes"><span class="atendente-role ${a.role}">${a.role === "admin" ? "Admin" : "Atendente"}</span>${podeExcluir ? `<button class="btn-excluir-atendente" data-id="${a.id}" data-nome="${escaparHTML(a.nome || a.email)}">Excluir</button>` : ""}</div>`;
      lista.appendChild(item);
    });
  } catch (_) { lista.innerHTML = `<div class="loading">Erro de conexão.</div>`; }
}

async function criarAtendente(e) {
  e.preventDefault(); esconderErroAtendente();
  const nome = document.getElementById("novoNome")?.value.trim();
  const email = document.getElementById("novoEmail")?.value.trim();
  const senha = document.getElementById("novaSenha")?.value;
  const role = document.getElementById("novoRole")?.value || "atendente";
  if (!nome || !email || !senha) { mostrarErroAtendente("Preencha nome, email e senha."); return; }
  if (senha.length < 6) { mostrarErroAtendente("Senha com pelo menos 6 caracteres."); return; }
  try {
    const resposta = await fetch(`${API_URL}/api/auth/registrar`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ nome, email, senha, role }) });
    const dados = await resposta.json();
    if (!resposta.ok) { mostrarErroAtendente(dados.erro || "Erro ao criar atendente."); return; }
    document.getElementById("formNovoAtendente").reset();
    await carregarAtendentes();
    if (window.AVSEGNotify) AVSEGNotify.toast("Atendente criado!", "sucesso");
  } catch (_) { mostrarErroAtendente("Erro de conexão."); }
}

async function excluirAtendente(id, nome) {
  if (!id || !confirm(`Excluir o usuário "${nome}"?`)) return;
  try {
    const resposta = await fetch(`${API_URL}/api/usuarios/${id}`, { method: "DELETE", headers: authHeaders() });
    const dados = await resposta.json();
    if (!resposta.ok) { alert(dados.erro || "Erro ao excluir."); return; }
    await carregarAtendentes();
    if (window.AVSEGNotify) AVSEGNotify.toast("Usuário excluído.", "aviso");
  } catch (_) { alert("Erro de conexão."); }
}

// =============================================================================
// MODAIS — TRANSFERIR
// =============================================================================

function abrirModalTransferir() { const m = document.getElementById("modalTransferir"); if (m && conversaAtual) { m.style.display = "flex"; carregarAtendentesTransferencia(); } }
function fecharModalTransferir() { const m = document.getElementById("modalTransferir"); const e = document.getElementById("erroTransferir"); if (m) m.style.display = "none"; if (e) { e.textContent = ""; e.style.display = "none"; } }
function mostrarErroTransferir(msg) { const e = document.getElementById("erroTransferir"); if (e) { e.textContent = msg; e.style.display = "block"; } }

async function carregarAtendentesTransferencia() {
  const lista = document.getElementById("listaTransferirAtendentes");
  if (!lista) return;
  lista.innerHTML = `<div class="loading">Carregando atendentes...</div>`;
  try {
    const resposta = await fetch(`${API_URL}/api/usuarios/atendentes`, { headers: authHeaders() });
    const dados = await resposta.json();
    if (!resposta.ok) { lista.innerHTML = `<div class="loading">${dados.erro || "Erro."}</div>`; return; }
    const atendentes = dados.filter((a) => a.id !== usuario?.id);
    if (!atendentes.length) { lista.innerHTML = `<div class="loading">Nenhum outro atendente disponível.</div>`; return; }
    lista.innerHTML = atendentes.map((a) => `
      <button type="button" class="transferir-atendente-item" data-id="${a.id}" data-nome="${escaparHTML(a.nome || a.email)}">
        <div class="atendente-avatar">${primeiraLetraUsuario(a.nome, a.email)}</div>
        <div class="transferir-atendente-info"><strong>${escaparHTML(a.nome || "Sem nome")}</strong><span>${escaparHTML(a.email || "")}</span></div>
        <div class="transferir-atendente-meta"><span class="atendente-role ${a.role}">${a.role === "admin" ? "Admin" : "Atendente"}</span>${conversaAtual?.atendenteId === a.id ? "<small>Responsável atual</small>" : ""}</div>
      </button>`).join("");
  } catch (_) { lista.innerHTML = `<div class="loading">Erro de conexão.</div>`; }
}

async function transferirConversa(atendenteId, nome) {
  if (!conversaAtual || !atendenteId || !confirm(`Transferir para ${nome}?`)) return;
  try {
    const resposta = await fetch(`${API_URL}/api/conversas/${conversaAtual.id}/transferir`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ atendenteId }) });
    const dados = await resposta.json();
    if (!resposta.ok) { mostrarErroTransferir(dados.erro || "Erro ao transferir."); return; }
    conversas = conversas.map((c) => c.id === dados.id ? { ...c, ...dados } : c);
    conversaAtual = { ...conversaAtual, ...dados };
    chatStatus.value = conversaAtual.status;
    atualizarInfoAtendente(conversaAtual); atualizarBotoesConversa(conversaAtual);
    renderizarConversas(); atualizarEstatisticas(); fecharModalTransferir();
    if (window.AVSEGNotify) AVSEGNotify.toast(`Conversa transferida para ${nome}`, "sucesso");
  } catch (_) { mostrarErroTransferir("Erro de conexão."); }
}

// =============================================================================
// SOCKET
// =============================================================================

function configurarSocket() {
  socket.on("nova_conversa", async () => {
    await carregarConversas();
    if (window.AVSEGNotify) { AVSEGNotify.tocarNovaConversa(); AVSEGNotify.toast("💬 Nova conversa recebida", "aviso"); }
    _recalcularBadge();
  });

  socket.on("conversa_atualizada", async (conversaAtualizada) => {
    conversas = conversas.map((c) => c.id === conversaAtualizada.id ? { ...c, ...conversaAtualizada } : c);
    if (conversaAtual?.id === conversaAtualizada.id) {
      conversaAtual = { ...conversaAtual, ...conversaAtualizada };
      chatStatus.value = conversaAtual.status;
      atualizarInfoAtendente(conversaAtual); atualizarBotoesConversa(conversaAtual);
      renderizarEtiquetasNoChat(conversaAtual);
    }
    renderizarConversas(); atualizarEstatisticas(); _recalcularBadge();
  });

  socket.on("nova_mensagem", async ({ conversaId, mensagem }) => {
    await carregarConversas();
    if (conversaAtual?.id === conversaId) {
      if (window.AVSEGNotify) AVSEGNotify.ocultarDigitando(conversaId);
      adicionarMensagemNaTela(mensagem); rolarParaBaixo();
      if (mensagem.origem === "cliente") {
        await marcarComoLidas(conversaId);
        if (document.hidden && window.AVSEGNotify) AVSEGNotify.tocarMensagem();
      }
    } else if (mensagem.origem === "cliente" && window.AVSEGNotify) {
      AVSEGNotify.tocarMensagem(); _recalcularBadge();
    }
  });

  socket.on("cliente_digitando", ({ conversaId }) => {
    if (conversaAtual?.id === conversaId && window.AVSEGNotify) AVSEGNotify.mostrarDigitando(conversaId, chatMensagens);
  });
}

// =============================================================================
// EVENTOS
// =============================================================================

function configurarEventos() {
  btnSair.addEventListener("click", sair);
  btnLogoutMobile?.addEventListener("click", sair);
  btnEnviar.addEventListener("click", enviarMensagem);

  chatInput.addEventListener("input", () => {
    ajustarAlturaTextarea();
    const val = chatInput.value.trim();
    if (val.startsWith("/")) renderizarTemplatesRapidos(val);
    else esconderTemplatesRapidos();
  });

  btnAnexar?.addEventListener("click", () => fileAnexo?.click());
  fileAnexo?.addEventListener("change", selecionarArquivo);

  // Usa mousedown para não conflitar com o click global que fecha o painel
  btnTemplates?.addEventListener("mousedown", (e) => {
    e.preventDefault(); // evita blur no input
    if (templatesRapidos?.style.display === "block") {
      esconderTemplatesRapidos();
    } else {
      renderizarTemplatesRapidos("");
    }
  });

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarMensagem(); }
  });

  chatStatus.addEventListener("change", () => atualizarStatus(chatStatus.value));
  btnAtribuir.addEventListener("click", assumirConversa);
  btnFinalizarConversa?.addEventListener("click", finalizarConversa);
  btnReabrirConversa?.addEventListener("click", reabrirConversa);
  btnTransferirConversa?.addEventListener("click", abrirModalTransferir);

  searchConversas.addEventListener("input", (e) => { buscaAtual = e.target.value; renderizarConversas(); });

  document.querySelectorAll(".filter-btn, .filter-btn-mobile").forEach((btn) => {
    btn.addEventListener("click", () => {
      filtroAtual = btn.dataset.status;
      document.querySelectorAll(".filter-btn, .filter-btn-mobile").forEach((b) => b.classList.toggle("active", b.dataset.status === filtroAtual));
      renderizarConversas();
    });
  });

  // Filtro por etiqueta na sidebar
  document.getElementById("sidebarEtiquetasFiltro")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".filtro-etiqueta-btn");
    if (!btn) return;
    const id = btn.dataset.etiquetaId;
    filtroEtiqueta = id === "limpar" ? null : (filtroEtiqueta === id ? null : id);
    renderizarFiltrosEtiqueta();
    renderizarConversas();
  });

  // Botão adicionar etiqueta no chat
  document.getElementById("chatEtiquetasRow")?.addEventListener("click", (e) => {
    const btnAdd = e.target.closest("#btnAdicionarEtiqueta");
    if (btnAdd) { abrirDropdownEtiquetas(); return; }

    const btnRemover = e.target.closest(".chat-etiqueta-remover");
    if (btnRemover) { removerEtiqueta(btnRemover.dataset.etiquetaId); return; }

    const dropdownItem = e.target.closest(".etiquetas-dropdown-item");
    if (dropdownItem) { aplicarEtiqueta(dropdownItem.dataset.id); return; }
  });

  // Fechar dropdown ao clicar fora
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#etiquetasWrapperBtn") && !e.target.closest("#etiquetasDropdown")) fecharDropdownEtiquetas();

    const imagemMensagem = e.target.closest(".mensagem-imagem");
    if (imagemMensagem) { abrirModalImagem(imagemMensagem.dataset.url); return; }

    const btnExcluir = e.target.closest(".btn-excluir-atendente");
    if (btnExcluir) { excluirAtendente(btnExcluir.dataset.id, btnExcluir.dataset.nome); return; }

    const btnExcluirEt = e.target.closest(".btn-excluir-etiqueta");
    if (btnExcluirEt) { excluirEtiqueta(btnExcluirEt.dataset.id, btnExcluirEt.dataset.nome); return; }

    const btnTransferirAt = e.target.closest(".transferir-atendente-item");
    if (btnTransferirAt) { transferirConversa(btnTransferirAt.dataset.id, btnTransferirAt.dataset.nome); return; }

    const templateItem = e.target.closest(".template-item");
    if (templateItem) { inserirTemplate(templateItem.dataset.atalho); return; }

    // Fecha templates se clicar fora — mas não fecha se clicar no botão (mousedown já cuida)
    if (templatesRapidos && templatesRapidos.style.display === "block") {
      if (!templatesRapidos.contains(e.target) && !btnTemplates?.contains(e.target) && e.target !== chatInput) {
        esconderTemplatesRapidos();
      }
    }
  });

  // Modais
  const modalImagem = document.getElementById("modalImagem");
  document.getElementById("btnFecharImagem")?.addEventListener("click", fecharModalImagem);
  document.getElementById("btnBaixarImagem")?.addEventListener("click", baixarImagemAtual);
  modalImagem?.addEventListener("click", (e) => { if (e.target === modalImagem) fecharModalImagem(); });
  document.getElementById("btnVoltarConversas")?.addEventListener("click", () => document.body.classList.remove("chat-mobile-aberto"));

  document.getElementById("btnAbrirAtendentes")?.addEventListener("click", abrirModalAtendentes);
  document.getElementById("btnFecharAtendentes")?.addEventListener("click", fecharModalAtendentes);
  document.getElementById("formNovoAtendente")?.addEventListener("submit", criarAtendente);
  document.getElementById("modalAtendentes")?.addEventListener("click", (e) => { if (e.target === document.getElementById("modalAtendentes")) fecharModalAtendentes(); });

  document.getElementById("btnFecharTransferir")?.addEventListener("click", fecharModalTransferir);
  document.getElementById("modalTransferir")?.addEventListener("click", (e) => { if (e.target === document.getElementById("modalTransferir")) fecharModalTransferir(); });

  // Modal etiquetas
  document.getElementById("btnAbrirEtiquetas")?.addEventListener("click", abrirModalEtiquetas);
  document.getElementById("btnFecharEtiquetas")?.addEventListener("click", fecharModalEtiquetas);
  document.getElementById("formNovaEtiqueta")?.addEventListener("submit", criarEtiqueta);
  document.getElementById("modalEtiquetas")?.addEventListener("click", (e) => { if (e.target === document.getElementById("modalEtiquetas")) fecharModalEtiquetas(); });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { fecharModalImagem(); fecharModalAtendentes(); fecharModalTransferir(); fecharModalEtiquetas(); fecharDropdownEtiquetas(); }
  });
}

// =============================================================================
// INICIALIZAÇÃO
// =============================================================================

async function iniciar() {
  await verificarAutenticacao();
  await carregarEtiquetas();
  configurarEventos();
  configurarSocket();
  await carregarConversas();
}

iniciar();