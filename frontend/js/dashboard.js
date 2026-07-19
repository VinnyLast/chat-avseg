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
const btnNotaInterna = document.getElementById("btnNotaInterna");
const chatInputContainer = document.querySelector(".chat-input-container");
const contadorCaracteres = document.getElementById("contadorCaracteres");

let arquivoSelecionado = null;
let modoNotaInterna = false;

let TEMPLATES_RAPIDOS = []; // carregado da API

// =============================================================================
// TEMA CLARO / ESCURO
// =============================================================================

function aplicarTema(tema) {
  document.documentElement.setAttribute("data-theme", tema);
  localStorage.setItem("avseg_tema", tema);
  const icone = document.getElementById("iconeTema");
  const label = document.getElementById("labelTema");
  if (icone) icone.innerHTML = svgIcon(tema === "light" ? "sol" : "lua", 15);
  if (label) label.textContent = tema === "light" ? "Tema claro" : "Tema escuro";
}

function alternarTema() {
  const atual = document.documentElement.getAttribute("data-theme") || "dark";
  aplicarTema(atual === "light" ? "dark" : "light");
}

// =============================================================================
// INDICADOR DE HORÁRIO DE ATENDIMENTO (seg-sex 8h-18h, sáb 8h-12h, UTC-3)
// =============================================================================

function dentroDoHorarioAtendimento() {
  const agora = new Date();
  const utcMs = agora.getTime() + agora.getTimezoneOffset() * 60000;
  const horaLocal = new Date(utcMs - 3 * 60 * 60 * 1000);
  const dia = horaLocal.getDay();
  const hora = horaLocal.getHours() + horaLocal.getMinutes() / 60;

  if (dia === 0) return false;
  if (dia === 6) return hora >= 8 && hora < 12;
  return hora >= 8 && hora < 18;
}

function atualizarIndicadorHorario() {
  const el = document.getElementById("indicadorHorario");
  if (!el) return;
  const dentro = dentroDoHorarioAtendimento();
  el.innerHTML = `<span class="indicador-horario-bolinha ${dentro ? "dentro" : "fora"}"></span>${dentro ? "Dentro do horário" : "Fora do horário"}`;
}

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
  window.location.href = "/";
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
    chevron:   `<svg viewBox="0 0 24 24" ${attrs}><path d="M9 18l6-6-6-6"></path></svg>`,
    check:     `<svg viewBox="0 0 24 24" ${attrs}><path d="M20 6L9 17l-5-5"></path></svg>`,
    trash:     `<svg viewBox="0 0 24 24" ${attrs}><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`,
    info:      `<svg viewBox="0 0 24 24" ${attrs}><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,
    responder: `<svg viewBox="0 0 24 24" ${attrs}><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg>`,
    lua:       `<svg viewBox="0 0 24 24" ${attrs}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`,
    sol:       `<svg viewBox="0 0 24 24" ${attrs}><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`,
    nota:      `<svg viewBox="0 0 24 24" ${attrs}><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`,
    transferir: `<svg viewBox="0 0 24 24" ${attrs}><path d="M17 1l4 4-4 4"></path><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><path d="M7 23l-4-4 4-4"></path><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>`,
    reabrir:   `<svg viewBox="0 0 24 24" ${attrs}><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>`,
  };
  return icons[nome] || icons.clip;
}


// =============================================================================
// HUMANO PENDENTE — HELPERS
// =============================================================================

function estaHumanoPendente(conversa) {
  // Só marca como urgente quando o associado realmente pediu atendimento
  // humano (solicitouHumano) — uma conversa nova "aguardando" sem atendente
  // ainda não é, por si só, um pedido urgente.
  return Boolean(conversa.solicitouHumano);
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

// Dropdown de seleção — recebe o elemento que disparou a abertura (botão inline
// no desktop, ou o item "Adicionar etiqueta" do menu "..." no mobile) e
// posiciona o dropdown com position:fixed a partir dele. Assim funciona igual
// nos dois casos, sem depender de um wrapper ancestral com position:relative
// (que no mobile fica escondido dentro do menu "...").
function abrirDropdownEtiquetas(triggerEl) {
  fecharDropdownEtiquetas();

  const trigger = triggerEl || document.getElementById("btnAdicionarEtiqueta");
  if (!trigger || !conversaAtual) return;

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
  document.body.appendChild(dropdown);

  const rect = trigger.getBoundingClientRect();
  dropdown.style.position = "fixed";
  dropdown.style.top = `${rect.bottom + 6}px`;
  const larguraMinima = 220;
  let left = rect.left;
  const maxLeft = window.innerWidth - larguraMinima - 10;
  if (left > maxLeft) left = Math.max(10, maxLeft);
  dropdown.style.left = `${left}px`;
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
// MOTIVOS DE FINALIZAÇÃO — MODAL ADMIN
// =============================================================================

let todosMotivos = [];

async function carregarMotivos() {
  try {
    const resposta = await fetch(`${API_URL}/api/motivos`, { headers: authHeaders() });
    if (!resposta.ok) return;
    todosMotivos = await resposta.json();
  } catch (_) {}
}

function abrirModalMotivos() {
  const modal = document.getElementById("modalMotivos");
  if (!modal) return;
  modal.style.display = "flex";
  carregarMotivosAdmin();
}

function fecharModalMotivos() {
  const modal = document.getElementById("modalMotivos");
  if (modal) modal.style.display = "none";
}

async function carregarMotivosAdmin() {
  const lista = document.getElementById("listaMotivosAdmin");
  if (!lista) return;
  lista.innerHTML = `<div class="loading">Carregando motivos...</div>`;

  await carregarMotivos();

  if (!todosMotivos.length) {
    lista.innerHTML = `<div class="loading">Nenhum motivo criado ainda.</div>`;
    return;
  }

  lista.innerHTML = todosMotivos.map((m) => `
    <div class="etiqueta-admin-item motivo-admin-item">
      <span class="etiqueta-admin-nome">${escaparHTML(m.nome)}</span>
      <div class="etiqueta-admin-acoes">
        <button class="btn-excluir-motivo" data-id="${m.id}" data-nome="${escaparHTML(m.nome)}">
          Excluir
        </button>
      </div>
    </div>
  `).join("");
}

async function criarMotivo(e) {
  e.preventDefault();
  const nome = document.getElementById("novoMotivoNome")?.value.trim();
  const erroEl = document.getElementById("erroMotivo");

  if (!nome) {
    if (erroEl) { erroEl.textContent = "Informe o nome do motivo."; erroEl.style.display = "block"; }
    return;
  }
  if (erroEl) { erroEl.textContent = ""; erroEl.style.display = "none"; }

  try {
    const resposta = await fetch(`${API_URL}/api/motivos`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ nome }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) {
      if (erroEl) { erroEl.textContent = dados.erro || "Erro ao criar motivo."; erroEl.style.display = "block"; }
      return;
    }
    document.getElementById("formNovoMotivo")?.reset();
    await carregarMotivosAdmin();
    if (window.AVSEGNotify) AVSEGNotify.toast("Motivo criado!", "sucesso");
  } catch (_) {
    if (erroEl) { erroEl.textContent = "Erro de conexão."; erroEl.style.display = "block"; }
  }
}

async function excluirMotivo(id, nome) {
  if (!confirm(`Excluir o motivo "${nome}"?`)) return;
  try {
    const resposta = await fetch(`${API_URL}/api/motivos/${id}`, {
      method: "DELETE", headers: authHeaders(),
    });
    if (!resposta.ok) { alert("Erro ao excluir motivo."); return; }
    await carregarMotivosAdmin();
    if (window.AVSEGNotify) AVSEGNotify.toast("Motivo excluído.", "aviso");
  } catch (_) {}
}

// =============================================================================
// FINALIZAR CONVERSA — SELEÇÃO DE MOTIVO
// =============================================================================

// Dropdown ancorado no botão "Finalizar" (mesmo padrão do abrirDropdownEtiquetas
// e do dropdown de status) — funciona tanto a partir do botão do desktop quanto
// do item do menu "..." no mobile, sem precisar de modal/aba separada.
function abrirDropdownFinalizar(triggerEl) {
  fecharDropdownFinalizar();

  const trigger = triggerEl || btnFinalizarConversa;
  if (!trigger || !conversaAtual) return;

  const dropdown = document.createElement("div");
  dropdown.className = "status-dropdown-list finalizar-dropdown";
  dropdown.id = "finalizarDropdown";
  dropdown.innerHTML = `<div class="loading">Carregando motivos...</div>`;
  document.body.appendChild(dropdown);

  const rect = trigger.getBoundingClientRect();
  dropdown.style.position = "fixed";
  dropdown.style.top = `${rect.bottom + 6}px`;
  const larguraMinima = 260;
  let left = rect.left;
  const maxLeft = window.innerWidth - larguraMinima - 10;
  if (left > maxLeft) left = Math.max(10, maxLeft);
  dropdown.style.left = `${left}px`;

  carregarMotivosNoDropdownFinalizar(dropdown);
}

function fecharDropdownFinalizar() {
  document.getElementById("finalizarDropdown")?.remove();
}

async function carregarMotivosNoDropdownFinalizar(dropdown) {
  await carregarMotivos();
  if (!dropdown.isConnected) return; // usuário já fechou antes de carregar

  const itensMotivos = todosMotivos.map((m) => `
    <button type="button" class="status-dropdown-item finalizar-dropdown-item" data-id="${m.id}">${escaparHTML(m.nome)}</button>
  `).join("");

  dropdown.innerHTML = `
    ${itensMotivos}
    ${todosMotivos.length ? '<div class="finalizar-dropdown-separador"></div>' : ""}
    <button type="button" class="status-dropdown-item finalizar-dropdown-item" data-id="">Finalizar sem motivo</button>
  `;
}

// =============================================================================
// AUTENTICAÇÃO
// =============================================================================

async function verificarAutenticacao() {
  if (!token) { window.location.href = "/"; return; }
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

    const btnMotivos = document.getElementById("btnAbrirMotivos");
    if (btnMotivos) btnMotivos.style.display = usuario.role === "admin" ? "flex" : "none";
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
  const normais = lista.filter((c) => !estaHumanoPendente(c)).sort((a, b) => {
    const aFinalizada = a.status === "finalizada" ? 1 : 0;
    const bFinalizada = b.status === "finalizada" ? 1 : 0;
    if (aFinalizada !== bFinalizada) return aFinalizada - bFinalizada;
    return dataOrdem(b) - dataOrdem(a);
  });
  return { humanos, normais };
}

function _renderizarItemConversa(conversa) {
  const item = document.createElement("div");
  item.className = "conversa-item";
  item.dataset.conversaId = conversa.id;
  if (conversaAtual?.id === conversa.id) item.classList.add("active");
  if (conversa.status === "finalizada") item.classList.add("finalizada");

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
        <h4 class="conversa-nome">${escaparHTML(conversa.clienteNome || "Associado")}</h4>
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

  if (modoNotaInterna) alternarModoNota();
  cancelarResposta();
  fecharPainelClienteInfo();
  fecharMenuChatMobile();

  chatVazio.style.display = "none";
  chatAtivo.style.display = "flex";

  chatClienteInicial.textContent = primeiraLetra(conversa.clienteNome);
  chatClienteNome.textContent = conversa.clienteNome || "Associado";
  chatClienteTelefone.textContent = formatarTelefone(conversa.telefone);
  definirStatusDropdown(conversa.status || "aguardando");
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

let mensagensCarregadas = [];
let _offsetMensagens = 0;
let respondendoAtual = null; // { id, autor, texto } — mensagem sendo respondida no momento

function rotuloAutorMensagem(mensagem) {
  if (mensagem.origem === "atendente") return "Você";
  if (mensagem.origem === "sistema") return "Bot";
  return conversaAtual?.clienteNome || "Associado";
}

function resumoTextoMensagem(mensagem) {
  if (mensagem.texto && mensagem.texto.trim()) return mensagem.texto.trim().slice(0, 120);
  if (mensagem.tipo === "imagem") return "📷 Imagem";
  if (mensagem.tipo === "audio") return "🎤 Áudio";
  if (mensagem.tipo === "video") return "🎬 Vídeo";
  if (mensagem.arquivoUrl) return `📎 ${mensagem.nomeArquivo || "Arquivo"}`;
  return "Mensagem";
}

function iniciarResposta(mensagemId) {
  const mensagem = mensagensCarregadas.find((m) => m.id === mensagemId);
  if (!mensagem) return;
  respondendoAtual = { id: mensagem.id, autor: rotuloAutorMensagem(mensagem), texto: resumoTextoMensagem(mensagem) };

  const banner = document.getElementById("respostaCitadaBanner");
  if (banner) {
    document.getElementById("respostaCitadaAutor").textContent = respondendoAtual.autor;
    document.getElementById("respostaCitadaTexto").textContent = respondendoAtual.texto;
    banner.style.display = "flex";
  }
  chatInput?.focus();
}

function cancelarResposta() {
  respondendoAtual = null;
  const banner = document.getElementById("respostaCitadaBanner");
  if (banner) banner.style.display = "none";
}

function criarBotaoCarregarAnteriores(temMais) {
  const btn = document.createElement("button");
  btn.id = "btnCarregarAnteriores";
  btn.className = "btn-carregar-anteriores";
  btn.type = "button";
  btn.textContent = "Carregar mensagens anteriores";
  btn.style.display = temMais ? "block" : "none";
  return btn;
}

function renderizarMensagensCarregadas(temMais) {
  _ultimaDataMensagem = null;
  chatMensagens.innerHTML = "";
  chatMensagens.appendChild(criarBotaoCarregarAnteriores(temMais));
  mensagensCarregadas.forEach((m) => adicionarMensagemNaTela(m));
}

async function carregarMensagens(conversaId) {
  try {
    chatMensagens.innerHTML = `<div class="loading">Carregando mensagens...</div>`;
    _offsetMensagens = 0;
    mensagensCarregadas = [];
    const resposta = await fetch(`${API_URL}/api/conversas/${conversaId}/mensagens?limite=50&offset=0`, { headers: authHeaders() });
    if (!resposta.ok) { chatMensagens.innerHTML = `<div class="loading">Erro ao carregar mensagens.</div>`; return; }
    const dados = await resposta.json();
    mensagensCarregadas = dados.mensagens || [];
    _offsetMensagens = mensagensCarregadas.length;
    renderizarMensagensCarregadas(dados.temMais);
    rolarParaBaixo();
  } catch (_) {
    chatMensagens.innerHTML = `<div class="loading">Erro ao carregar mensagens.</div>`;
  }
}

async function carregarMensagensAnteriores() {
  if (!conversaAtual) return;
  const btn = document.getElementById("btnCarregarAnteriores");
  if (btn) { btn.disabled = true; btn.textContent = "Carregando..."; }
  try {
    const resposta = await fetch(`${API_URL}/api/conversas/${conversaAtual.id}/mensagens?limite=50&offset=${_offsetMensagens}`, { headers: authHeaders() });
    if (!resposta.ok) return;
    const dados = await resposta.json();
    const antigas = dados.mensagens || [];
    _offsetMensagens += antigas.length;
    mensagensCarregadas = [...antigas, ...mensagensCarregadas];

    const alturaAntes = chatMensagens.scrollHeight;
    renderizarMensagensCarregadas(dados.temMais);
    chatMensagens.scrollTop = chatMensagens.scrollHeight - alturaAntes;
  } catch (_) {
    const btnErro = document.getElementById("btnCarregarAnteriores");
    if (btnErro) { btnErro.disabled = false; btnErro.textContent = "Carregar mensagens anteriores"; }
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

  const tipo = mensagem.tipo || "texto";
  const ehRespostaBot = mensagem.origem === "sistema" && mensagem.privado && tipo !== "sistema";

  const div = document.createElement("div");
  div.className = tipo === "nota"
    ? "mensagem nota-interna"
    : ehRespostaBot
      ? "mensagem bot-espelho"
      : `mensagem ${mensagem.origem === "atendente" ? "atendente" : mensagem.origem === "sistema" ? "sistema" : "cliente"}`;

  // Classe explícita (não depende do seletor CSS :has(), sem suporte no Safari < 16.4 / iOS antigo)
  if (tipo === "imagem") div.classList.add("mensagem-com-imagem");

  div.dataset.mensagemId = mensagem.id || "";

  const arquivoUrl  = mensagem.arquivoUrl  || "";
  const nomeArquivo = mensagem.nomeArquivo || "Arquivo enviado";
  const mimeType    = mensagem.mimeType    || "";
  let conteudo = "";

  // Só mensagens do associado/atendente têm wamid de verdade — só essas
  // conseguem virar uma resposta citada nativa no WhatsApp.
  const podeResponder = mensagem.id && (mensagem.origem === "cliente" || mensagem.origem === "atendente");
  const botaoResponder = podeResponder
    ? `<button type="button" class="btn-responder-mensagem" title="Responder" aria-label="Responder">${svgIcon("responder", 15)}</button>`
    : "";

  let citacaoHTML = "";
  if (mensagem.respondendoA) {
    const original = mensagensCarregadas.find((m) => m.id === mensagem.respondendoA);
    if (original) {
      citacaoHTML = `
        <div class="mensagem-citacao">
          <strong>${escaparHTML(rotuloAutorMensagem(original))}</strong>
          <span>${escaparHTML(resumoTextoMensagem(original))}</span>
        </div>
      `;
    }
  }

  if (tipo === "nota") {
    conteudo = `<p class="nota-interna-label">🔒 Nota interna</p><p class="mensagem-texto">${escaparHTML(mensagem.texto || "")}</p>`;
  } else if (ehRespostaBot) {
    conteudo = `<p class="bot-espelho-label">🤖 Bot (resposta automática)</p><p class="mensagem-texto">${escaparHTML(mensagem.texto || "")}</p>`;
  } else if (tipo === "imagem" && arquivoUrl) {
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

  div.innerHTML = `${botaoResponder}<div class="mensagem-conteudo">${citacaoHTML}${conteudo}<span class="mensagem-hora">${formatarHora(mensagem.criadoEm)}</span></div>`;
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

// Somente imagens e documentos — sem áudio/vídeo (política da Meta para
// mensagens de voz/mídia iniciadas pela empresa).
const EXTENSOES_ANEXO_PERMITIDAS = ["jpg", "jpeg", "png", "gif", "webp", "pdf", "doc", "docx", "xls", "xlsx"];

function extensaoPermitida(nomeArquivo = "") {
  const ext = nomeArquivo.split(".").pop()?.toLowerCase() || "";
  return EXTENSOES_ANEXO_PERMITIDAS.includes(ext);
}

function selecionarArquivo(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!extensaoPermitida(file.name)) {
    alert("Tipo de arquivo não permitido. Envie apenas imagens (jpg, png, gif, webp) ou documentos (pdf, doc, docx, xls, xlsx).");
    fileAnexo.value = "";
    return;
  }
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
// PAINEL LATERAL — INFORMAÇÕES DO ASSOCIADO
// =============================================================================

function renderizarPainelClienteInfo(conversa) {
  const container = document.getElementById("painelClienteConteudo");
  if (!container || !conversa) return;

  const outras = conversas
    .filter((c) => conversa.clienteId && c.clienteId === conversa.clienteId && c.id !== conversa.id)
    .sort((a, b) => new Date(b.atualizadoEm || b.criadoEm) - new Date(a.atualizadoEm || a.criadoEm));

  const etiquetasHistorico = new Set();
  [conversa, ...outras].forEach((c) => (Array.isArray(c.etiquetas) ? c.etiquetas : []).forEach((id) => etiquetasHistorico.add(id)));
  const tagsHTML = [...etiquetasHistorico].map((id) => {
    const et = todasEtiquetas.find((e) => e.id === id);
    return et ? renderizarEtiquetaTag(et, "lista") : "";
  }).join("");

  const rotuloStatus = (c) => c.status === "finalizada" ? "Finalizada" : c.status === "aguardando" ? "Aguardando" : "Em atendimento";

  const ultimasHTML = outras.slice(0, 3).map((c) => `
    <button type="button" class="painel-cliente-conversa-item" data-conversa-id="${c.id}">
      ${escaparHTML(formatarUltimaMensagem(c))}
      <span class="conversa-item-data">${formatarHora(c.ultimaMensagemData)} • ${rotuloStatus(c)}</span>
    </button>
  `).join("");

  container.innerHTML = `
    <div>
      <div class="painel-cliente-secao-titulo">Associado</div>
      <p style="font-size:14px;font-weight:700;color:var(--text-primary);">${escaparHTML(conversa.clienteNome || "Associado")}</p>
      <p style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${formatarTelefone(conversa.telefone)}</p>
    </div>
    <div>
      <div class="painel-cliente-secao-titulo">Total de conversas anteriores</div>
      <p style="font-size:20px;font-weight:800;color:var(--primary);">${outras.length}</p>
    </div>
    <div>
      <div class="painel-cliente-secao-titulo">Últimas conversas</div>
      ${ultimasHTML || `<p style="font-size:12px;color:var(--text-secondary);">Nenhuma conversa anterior.</p>`}
    </div>
    <div>
      <div class="painel-cliente-secao-titulo">Etiquetas do histórico</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">${tagsHTML || `<p style="font-size:12px;color:var(--text-secondary);">Nenhuma etiqueta aplicada.</p>`}</div>
    </div>
  `;
}

function abrirPainelClienteInfo() {
  const painel = document.getElementById("painelClienteInfo");
  if (!painel || !conversaAtual) return;
  renderizarPainelClienteInfo(conversaAtual);
  painel.classList.add("aberto");
}

function fecharPainelClienteInfo() {
  document.getElementById("painelClienteInfo")?.classList.remove("aberto");
}

function togglePainelClienteInfo() {
  const painel = document.getElementById("painelClienteInfo");
  if (!painel) return;
  painel.classList.contains("aberto") ? fecharPainelClienteInfo() : abrirPainelClienteInfo();
}

// =============================================================================
// NOTAS INTERNAS
// =============================================================================

function alternarModoNota() {
  modoNotaInterna = !modoNotaInterna;
  if (modoNotaInterna) cancelarResposta();
  btnNotaInterna?.classList.toggle("ativo", modoNotaInterna);
  chatInputContainer?.classList.toggle("modo-nota", modoNotaInterna);
  chatInput.placeholder = modoNotaInterna
    ? "Adicionar nota interna..."
    : "Digite sua mensagem... ou / para respostas rápidas";
  chatInput.focus();
}

async function enviarNotaInterna(texto) {
  if (!conversaAtual) return;
  try {
    const resposta = await fetch(`${API_URL}/api/conversas/${conversaAtual.id}/notas`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ texto }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) { alert(dados.erro || "Erro ao salvar nota."); return; }
    chatInput.value = "";
    ajustarAlturaTextarea();
    atualizarContadorCaracteres();
  } catch (_) {
    alert("Erro de conexão ao salvar nota.");
  }
}

// =============================================================================
// MENU "..." DO HEADER (mobile) — concentra Assumir/Etiqueta/Transferir/
// Info/Nota/Finalizar/Reabrir, que no mobile não cabem expostos no header.
// =============================================================================

function abrirMenuChatMobile() {
  const menu = document.getElementById("menuChatMobile");
  if (!menu) return;
  menu.style.display = "flex";
  document.getElementById("btnMenuChatMobile")?.setAttribute("aria-expanded", "true");
}

function fecharMenuChatMobile() {
  const menu = document.getElementById("menuChatMobile");
  if (menu) menu.style.display = "none";
  document.getElementById("btnMenuChatMobile")?.setAttribute("aria-expanded", "false");
}

function alternarMenuChatMobile() {
  const menu = document.getElementById("menuChatMobile");
  if (!menu) return;
  if (menu.style.display === "flex") fecharMenuChatMobile();
  else abrirMenuChatMobile();
}

function executarAcaoMenuChatMobile(acao, itemEl) {
  // Executa a ação antes de fechar o menu — abrirDropdownEtiquetas() precisa
  // medir a posição do item enquanto ele ainda está visível.
  switch (acao) {
    case "assumir": assumirConversa(); break;
    case "etiqueta": abrirDropdownEtiquetas(itemEl); break;
    case "transferir": abrirModalTransferir(); break;
    case "info": abrirPainelClienteInfo(); break;
    case "nota": alternarModoNota(); break;
    case "finalizar": finalizarConversa(itemEl); break;
    case "reabrir": reabrirConversa(); break;
    case "excluir": excluirConversa(); break;
  }
  fecharMenuChatMobile();
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

  if (modoNotaInterna) { await enviarNotaInterna(texto); return; }

  btnEnviar.disabled = true; chatInput.disabled = true;
  if (btnAnexar) btnAnexar.disabled = true;
  if (btnTemplates) btnTemplates.disabled = true;

  try {
    let arquivo = null;
    if (arquivoSelecionado) arquivo = await uploadArquivoSelecionado();
    const payload = { texto };
    if (arquivo) { payload.tipo = arquivo.tipo; payload.arquivoUrl = arquivo.arquivoUrl; payload.mimeType = arquivo.mimeType; payload.nomeArquivo = arquivo.nomeArquivo; }
    if (respondendoAtual) payload.respondendoA = respondendoAtual.id;
    const resposta = await fetch(`${API_URL}/api/conversas/${conversaAtual.id}/mensagens`, { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) });
    const dados = await resposta.json();
    if (!resposta.ok) { alert(dados.erro || "Erro ao enviar mensagem."); return; }
    chatInput.value = ""; limparAnexo(); esconderTemplatesRapidos(); ajustarAlturaTextarea(); cancelarResposta();
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

const STATUS_LABELS = { aguardando: "Aguardando", em_atendimento: "Em Atendimento", finalizada: "Finalizada" };

// Dropdown de status customizado — o <select id="chatStatus"> continua existindo
// (oculto) como fonte de valor pro resto do código, só a UI visível muda.
function definirStatusDropdown(valor) {
  chatStatus.value = valor;
  const dot = document.getElementById("statusDropdownDot");
  const label = document.getElementById("statusDropdownLabel");
  if (dot) dot.className = `status-dot-indicador status-dot-${valor}`;
  if (label) label.textContent = STATUS_LABELS[valor] || valor;
}

function fecharStatusDropdown() {
  document.getElementById("statusDropdownList")?.style.setProperty("display", "none");
  document.getElementById("statusDropdownWrapper")?.classList.remove("aberto");
}

function abrirStatusDropdown() {
  document.getElementById("statusDropdownList")?.style.setProperty("display", "flex");
  document.getElementById("statusDropdownWrapper")?.classList.add("aberto");
}

async function atualizarStatus(status, extra = {}) {
  if (!conversaAtual) return;
  try {
    const resposta = await fetch(`${API_URL}/api/conversas/${conversaAtual.id}`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ status, ...extra }) });
    if (!resposta.ok) return;
    const atualizada = await resposta.json();
    conversas = conversas.map((c) => c.id === atualizada.id ? { ...c, ...atualizada } : c);
    conversaAtual = { ...conversaAtual, ...atualizada };
    definirStatusDropdown(conversaAtual.status);
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
    definirStatusDropdown(conversaAtual.status);

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

function rotuloStatusConversa(conversa) {
  const status = conversa?.status === "finalizada" ? "finalizada" : conversa?.status === "em_atendimento" ? "em_atendimento" : "aguardando";
  return `<span class="status-dot-indicador status-dot-${status}"></span>${STATUS_LABELS[status]}`;
}

function atualizarInfoAtendente(conversa) {
  if (!chatAtendenteInfo) return;
  const status = rotuloStatusConversa(conversa);
  const sufixoMotivo = conversa?.status === "finalizada" && conversa?.motivoFinalizacaoNome
    ? ` • Motivo: ${escaparHTML(conversa.motivoFinalizacaoNome)}`
    : "";
  if (conversa?.atendenteNome) { chatAtendenteInfo.innerHTML = `${status} • Atendente: ${escaparHTML(conversa.atendenteNome)}${sufixoMotivo}`; chatAtendenteInfo.classList.add("com-atendente"); }
  else { chatAtendenteInfo.innerHTML = `${status} • Sem atendente${sufixoMotivo}`; chatAtendenteInfo.classList.remove("com-atendente"); }

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
      Associado aguardando atendimento humano — assuma a conversa para iniciar
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

  const ehAdmin = usuario?.role === "admin";
  document.getElementById("btnExcluirConversa")?.style.setProperty("display", ehAdmin ? "inline-flex" : "none");
  document.getElementById("menuItemExcluir")?.style.setProperty("display", ehAdmin ? "flex" : "none");

  // Espelha a visibilidade nos itens do menu "..." (mobile)
  document.getElementById("menuItemFinalizar")?.style.setProperty("display", finalizada ? "none" : "flex");
  document.getElementById("menuItemReabrir")?.style.setProperty("display", finalizada ? "flex" : "none");
  document.getElementById("menuItemAssumir")?.style.setProperty("display", finalizada ? "none" : "flex");
  document.getElementById("menuItemTransferir")?.style.setProperty("display", finalizada ? "none" : "flex");
  document.getElementById("menuItemEtiqueta")?.style.setProperty("display", finalizada ? "none" : "flex");
  document.getElementById("menuItemNota")?.style.setProperty("display", finalizada ? "none" : "flex");

  chatInput.disabled = finalizada; btnEnviar.disabled = finalizada;
  if (btnAnexar) btnAnexar.disabled = finalizada;
  if (btnTemplates) btnTemplates.disabled = finalizada;
  if (finalizada) {
    chatInput.placeholder = window.innerWidth <= 480
      ? "Conversa finalizada"
      : "Conversa finalizada. Reabra para responder.";
  } else if (typeof ajustarPlaceholder === "function") {
    // mobile-patch.js define o texto certo pro tamanho de tela atual (evita quebra de linha no iPhone)
    ajustarPlaceholder();
  } else {
    chatInput.placeholder = "Digite sua mensagem... ou / para respostas rápidas";
  }
}

async function finalizarConversa(triggerEl) {
  if (!conversaAtual) return;
  abrirDropdownFinalizar(triggerEl);
}

async function finalizarComMotivo(motivoId) {
  fecharDropdownFinalizar();
  await atualizarStatus("finalizada", { motivoFinalizacaoId: motivoId || null });
}

async function reabrirConversa() {
  if (!conversaAtual) return;
  await atualizarStatus("aguardando");
}

async function excluirConversa() {
  if (!conversaAtual) return;
  if (!confirm(`Tem certeza que deseja excluir a conversa com ${conversaAtual.clienteNome || "este associado"}?\n\nEssa ação não pode ser desfeita.`)) return;

  try {
    const resposta = await fetch(`${API_URL}/api/conversas/${conversaAtual.id}`, { method: "DELETE", headers: authHeaders() });
    const dados = await resposta.json();
    if (!resposta.ok) { alert(dados.erro || "Erro ao excluir conversa."); return; }
    removerConversaDaLista(conversaAtual.id);
  } catch (_) {
    alert("Erro ao excluir conversa.");
  }
}

function removerConversaDaLista(conversaId) {
  conversas = conversas.filter((c) => c.id !== conversaId);
  if (conversaAtual?.id === conversaId) {
    conversaAtual = null;
    chatVazio.style.display = "flex";
    chatAtivo.style.display = "none";
  }
  renderizarConversas();
  atualizarEstatisticas();
}

function ajustarAlturaTextarea() {
  chatInput.style.height = "auto";
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
}

// =============================================================================
// CONTADOR DE CARACTERES
// =============================================================================

function atualizarContadorCaracteres() {
  if (!contadorCaracteres) return;
  const total = chatInput.value.length;
  if (total === 0) { contadorCaracteres.style.display = "none"; return; }
  contadorCaracteres.style.display = "block";
  contadorCaracteres.textContent = `${total} / 1000`;
  contadorCaracteres.classList.toggle("limite-alto", total > 900);
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
    definirStatusDropdown(conversaAtual.status);
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
      definirStatusDropdown(conversaAtual.status);
      atualizarInfoAtendente(conversaAtual); atualizarBotoesConversa(conversaAtual);
      renderizarEtiquetasNoChat(conversaAtual);
    }
    renderizarConversas(); atualizarEstatisticas(); _recalcularBadge();
  });

  socket.on("conversa_excluida", ({ conversaId }) => {
    removerConversaDaLista(conversaId);
    _recalcularBadge();
  });

  socket.on("nova_mensagem", async ({ conversaId, mensagem }) => {
    await carregarConversas();
    if (conversaAtual?.id === conversaId) {
      if (window.AVSEGNotify) AVSEGNotify.ocultarDigitando(conversaId);
      mensagensCarregadas.push(mensagem);
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

// =============================================================================
// MOSTRAR / OCULTAR SENHA
// =============================================================================
const ICONE_OLHO_ABERTO = '<svg class="icone-olho" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
const ICONE_OLHO_FECHADO = '<svg class="icone-olho" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.4 18.4 0 0 1 5.06-5.94M9.9 4.24A10.6 10.6 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

function configurarToggleSenha() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-toggle-senha");
    if (!btn) return;
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    const mostrandoAgora = input.type === "text";
    input.type = mostrandoAgora ? "password" : "text";
    btn.innerHTML = mostrandoAgora ? ICONE_OLHO_ABERTO : ICONE_OLHO_FECHADO;
    btn.setAttribute("aria-label", mostrandoAgora ? "Mostrar senha" : "Ocultar senha");
  });
}

function configurarEventos() {
  configurarToggleSenha();
  document.getElementById("btnAlternarTema")?.addEventListener("click", alternarTema);

  btnSair.addEventListener("click", sair);
  btnLogoutMobile?.addEventListener("click", sair);
  btnEnviar.addEventListener("click", enviarMensagem);

  chatInput.addEventListener("input", () => {
    ajustarAlturaTextarea();
    atualizarContadorCaracteres();
    const val = chatInput.value.trim();
    if (val.startsWith("/")) renderizarTemplatesRapidos(val);
    else esconderTemplatesRapidos();
  });

  btnAnexar?.addEventListener("click", () => fileAnexo?.click());
  fileAnexo?.addEventListener("change", selecionarArquivo);
  btnNotaInterna?.addEventListener("click", alternarModoNota);

  document.getElementById("btnMenuChatMobile")?.addEventListener("click", (e) => {
    e.stopPropagation();
    alternarMenuChatMobile();
  });

  document.getElementById("menuChatMobile")?.addEventListener("click", (e) => {
    const item = e.target.closest(".menu-chat-mobile-item");
    if (item) executarAcaoMenuChatMobile(item.dataset.acao, item);
  });

  chatMensagens.addEventListener("click", (e) => {
    if (e.target.closest("#btnCarregarAnteriores")) carregarMensagensAnteriores();
  });

  document.getElementById("btnToggleInfoCliente")?.addEventListener("click", togglePainelClienteInfo);
  document.getElementById("btnFecharInfoCliente")?.addEventListener("click", fecharPainelClienteInfo);
  document.getElementById("painelClienteConteudo")?.addEventListener("click", (e) => {
    const item = e.target.closest(".painel-cliente-conversa-item");
    if (item) { fecharPainelClienteInfo(); abrirConversa(item.dataset.conversaId); }
  });

  // "mousedown"/"touchstart" só para não perder o foco do input (evita fechar o teclado
  // no mobile). A ação em si fica em "click", que é o único evento garantido em
  // touch e mouse — "mousedown" sozinho não disparava no toque em vários navegadores
  // mobile, deixando o botão de respostas rápidas sem reação no celular.
  const evitarBlurInput = (e) => e.preventDefault();
  btnTemplates?.addEventListener("mousedown", evitarBlurInput);
  btnTemplates?.addEventListener("touchstart", evitarBlurInput, { passive: false });

  btnTemplates?.addEventListener("click", () => {
    if (templatesRapidos?.style.display === "block") {
      esconderTemplatesRapidos();
    } else {
      renderizarTemplatesRapidos("");
    }
  });

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || !e.shiftKey)) { e.preventDefault(); enviarMensagem(); }
  });

  chatStatus.addEventListener("change", () => atualizarStatus(chatStatus.value));
  btnAtribuir.addEventListener("click", assumirConversa);
  btnFinalizarConversa?.addEventListener("click", () => finalizarConversa(btnFinalizarConversa));
  btnReabrirConversa?.addEventListener("click", reabrirConversa);
  btnTransferirConversa?.addEventListener("click", abrirModalTransferir);
  document.getElementById("btnExcluirConversa")?.addEventListener("click", excluirConversa);

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

  // Botão adicionar/remover etiqueta no chat (desktop)
  document.getElementById("chatEtiquetasRow")?.addEventListener("click", (e) => {
    const btnAdd = e.target.closest("#btnAdicionarEtiqueta");
    if (btnAdd) { abrirDropdownEtiquetas(btnAdd); return; }

    const btnRemover = e.target.closest(".chat-etiqueta-remover");
    if (btnRemover) { removerEtiqueta(btnRemover.dataset.etiquetaId); return; }
  });

  // Fechar dropdown ao clicar fora
  document.addEventListener("click", (e) => {
    // O dropdown de etiquetas é anexado ao <body> (position:fixed), não mais
    // dentro de #chatEtiquetasRow — por isso os itens são tratados aqui.
    const dropdownItem = e.target.closest(".etiquetas-dropdown-item");
    if (dropdownItem) { aplicarEtiqueta(dropdownItem.dataset.id); return; }

    if (!e.target.closest("#etiquetasWrapperBtn") && !e.target.closest("#etiquetasDropdown") && !e.target.closest("#menuChatMobile")) fecharDropdownEtiquetas();

    if (!e.target.closest("#menuChatMobile") && !e.target.closest("#btnMenuChatMobile")) fecharMenuChatMobile();

    const imagemMensagem = e.target.closest(".mensagem-imagem");
    if (imagemMensagem) { abrirModalImagem(imagemMensagem.dataset.url); return; }

    const btnExcluir = e.target.closest(".btn-excluir-atendente");
    if (btnExcluir) { excluirAtendente(btnExcluir.dataset.id, btnExcluir.dataset.nome); return; }

    const btnExcluirEt = e.target.closest(".btn-excluir-etiqueta");
    if (btnExcluirEt) { excluirEtiqueta(btnExcluirEt.dataset.id, btnExcluirEt.dataset.nome); return; }

    const btnExcluirMot = e.target.closest(".btn-excluir-motivo");
    if (btnExcluirMot) { excluirMotivo(btnExcluirMot.dataset.id, btnExcluirMot.dataset.nome); return; }

    const btnMotivoFinalizar = e.target.closest(".finalizar-dropdown-item");
    if (btnMotivoFinalizar) { finalizarComMotivo(btnMotivoFinalizar.dataset.id || null); return; }
    if (!e.target.closest("#finalizarDropdown") && !e.target.closest("#btnFinalizarConversa") && !e.target.closest("#menuItemFinalizar")) fecharDropdownFinalizar();

    const btnResponder = e.target.closest(".btn-responder-mensagem");
    if (btnResponder) { iniciarResposta(btnResponder.closest(".mensagem")?.dataset.mensagemId); return; }

    if (e.target.closest("#btnCancelarResposta")) { cancelarResposta(); return; }

    const statusItem = e.target.closest(".status-dropdown-item");
    if (statusItem) {
      definirStatusDropdown(statusItem.dataset.value);
      chatStatus.dispatchEvent(new Event("change"));
      fecharStatusDropdown();
      return;
    }
    if (!e.target.closest("#statusDropdownWrapper")) fecharStatusDropdown();

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

  document.getElementById("btnAbrirMotivos")?.addEventListener("click", abrirModalMotivos);
  document.getElementById("btnFecharMotivos")?.addEventListener("click", fecharModalMotivos);
  document.getElementById("formNovoMotivo")?.addEventListener("submit", criarMotivo);
  document.getElementById("modalMotivos")?.addEventListener("click", (e) => { if (e.target === document.getElementById("modalMotivos")) fecharModalMotivos(); });

  document.getElementById("statusDropdownBtn")?.addEventListener("click", () => {
    const wrapper = document.getElementById("statusDropdownWrapper");
    if (wrapper?.classList.contains("aberto")) fecharStatusDropdown();
    else abrirStatusDropdown();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { fecharModalImagem(); fecharModalAtendentes(); fecharModalTransferir(); fecharModalEtiquetas(); fecharDropdownEtiquetas(); fecharPainelClienteInfo(); fecharMenuChatMobile(); }

    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      searchConversas.focus();
    }

    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === "n" && conversaAtual) {
      e.preventDefault();
      alternarModoNota();
    }
  });
}

// =============================================================================
// INICIALIZAÇÃO
// =============================================================================

function configurarAvisoSaida() {
  window.addEventListener("beforeunload", (e) => {
    const temConversaAtiva = conversas.some((c) => c.status === "em_atendimento" && c.atendenteId === usuario?.id);
    if (!temConversaAtiva) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

async function iniciar() {
  aplicarTema(document.documentElement.getAttribute("data-theme") || "dark");
  await verificarAutenticacao();
  await carregarEtiquetas();
  await carregarTemplates();
  configurarEventos();
  configurarSocket();
  configurarAvisoSaida();
  atualizarIndicadorHorario();
  setInterval(atualizarIndicadorHorario, 60000);
  await carregarConversas();
}

iniciar();