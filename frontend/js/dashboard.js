const API_URL = window.location.origin;

let token = localStorage.getItem("avseg_token");
let usuario = JSON.parse(localStorage.getItem("avseg_usuario") || "null");

let conversas = [];
let conversaAtual = null;
let filtroAtual = "todas";
let buscaAtual = "";

const socket = io(API_URL);

const userName = document.getElementById("userName");
const btnSair = document.getElementById("btnSair");
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

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
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

  if (mesmoDia) {
    return data.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function formatarTelefone(telefone) {
  const digitos = String(telefone || "").replace(/\D/g, "");

  if (digitos.startsWith("55") && digitos.length >= 12) {
    const ddd = digitos.slice(2, 4);
    const numero = digitos.slice(4);

    if (numero.length === 9) {
      return `(${ddd}) ${numero.slice(0, 5)}-${numero.slice(5)}`;
    }

    if (numero.length === 8) {
      return `(${ddd}) ${numero.slice(0, 4)}-${numero.slice(4)}`;
    }
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

async function verificarAutenticacao() {
  if (!token) {
    window.location.href = "index.html";
    return;
  }

  try {
    const resposta = await fetch(`${API_URL}/api/auth/verificar`, {
      headers: authHeaders(),
    });

    if (!resposta.ok) {
      sair();
      return;
    }

    const dados = await resposta.json();
    usuario = dados.usuario;

    localStorage.setItem("avseg_usuario", JSON.stringify(usuario));
    userName.textContent = usuario.nome || usuario.email;
  } catch (erro) {
    console.error("Erro ao verificar autenticação:", erro);
    sair();
  }
}

async function carregarConversas() {
  try {
    const resposta = await fetch(`${API_URL}/api/conversas`, {
      headers: authHeaders(),
    });

    if (!resposta.ok) {
      if (resposta.status === 401) sair();
      return;
    }

    conversas = await resposta.json();
    renderizarConversas();
    atualizarEstatisticas();
  } catch (erro) {
    console.error("Erro ao carregar conversas:", erro);
    listaConversas.innerHTML = `<div class="loading">Erro ao carregar conversas.</div>`;
  }
}

function atualizarEstatisticas() {
  const ativas = conversas.filter((c) => c.status !== "finalizada").length;
  const aguardando = conversas.filter((c) => c.status === "aguardando").length;

  totalConversasEl.textContent = ativas;
  aguardandoEl.textContent = aguardando;
}

function filtrarConversas() {
  return conversas.filter((conversa) => {
    const passaFiltro =
      filtroAtual === "todas" || conversa.status === filtroAtual;

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

  if (texto.toLowerCase().includes("áudio")) {
    return "🎧 Áudio enviado";
  }

  if (texto.toLowerCase().includes("foto") || texto.toLowerCase().includes("imagem")) {
    return "🖼️ Imagem enviada";
  }

  return texto || "Sem mensagens";
}
function renderizarConversas() {
  const lista = filtrarConversas();

  if (lista.length === 0) {
    listaConversas.innerHTML = `<div class="loading">Nenhuma conversa encontrada.</div>`;
    return;
  }

  listaConversas.innerHTML = "";

  lista.forEach((conversa) => {
    const item = document.createElement("div");
    item.className = "conversa-item";
    item.dataset.conversaId = conversa.id;

    if (conversaAtual?.id === conversa.id) {
      item.classList.add("active");
    }

    const badge =
      conversa.mensagensNaoLidas > 0
        ? `<span class="conversa-badge">${conversa.mensagensNaoLidas}</span>`
        : `<span class="conversa-badge" style="display:none;">0</span>`;

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
          <p class="conversa-ultima-msg">${escaparHTML(formatarUltimaMensagem(conversa))}</p>
          ${badge}
        </div>
      </div>

      <div class="conversa-status ${conversa.status || "aguardando"}"></div>
    `;

    item.addEventListener("click", () => abrirConversa(conversa.id));

    listaConversas.appendChild(item);
  });
}

async function abrirConversa(conversaId) {
  const conversa = conversas.find((c) => c.id === conversaId);
  if (!conversa) return;

  if (conversaAtual?.id) {
    socket.emit("sair_conversa", conversaAtual.id);
  }

  conversaAtual = conversa;
  socket.emit("entrar_conversa", conversaAtual.id);

  chatVazio.style.display = "none";
  chatAtivo.style.display = "flex";

  chatClienteInicial.textContent = primeiraLetra(conversa.clienteNome);
  chatClienteNome.textContent = conversa.clienteNome || "Cliente";
  chatClienteTelefone.textContent = formatarTelefone(conversa.telefone);
  chatStatus.value = conversa.status || "aguardando";

  renderizarConversas();

  await carregarMensagens(conversa.id);
  await marcarComoLidas(conversa.id);
}

async function carregarMensagens(conversaId) {
  try {
    chatMensagens.innerHTML = `<div class="loading">Carregando mensagens...</div>`;

    const resposta = await fetch(`${API_URL}/api/conversas/${conversaId}/mensagens`, {
      headers: authHeaders(),
    });

    if (!resposta.ok) {
      chatMensagens.innerHTML = `<div class="loading">Erro ao carregar mensagens.</div>`;
      return;
    }

    const mensagens = await resposta.json();

    chatMensagens.innerHTML = "";

    mensagens.forEach((mensagem) => {
      adicionarMensagemNaTela(mensagem);
    });

    rolarParaBaixo();
  } catch (erro) {
    console.error("Erro ao carregar mensagens:", erro);
    chatMensagens.innerHTML = `<div class="loading">Erro ao carregar mensagens.</div>`;
  }
}

function adicionarMensagemNaTela(mensagem) {
  const div = document.createElement("div");
  div.className = `mensagem ${mensagem.origem === "atendente" ? "atendente" : "cliente"}`;

  const tipo = mensagem.tipo || "texto";
  let conteudo = "";

  if (tipo === "imagem" && mensagem.arquivoUrl) {
    conteudo = `
      <div class="mensagem-midia">
        <img 
          src="${mensagem.arquivoUrl}" 
          alt="Imagem enviada" 
          class="mensagem-imagem"
          onclick="window.open('${mensagem.arquivoUrl}', '_blank')"
        >
      </div>
      ${mensagem.texto ? `<p class="mensagem-texto legenda-midia">${escaparHTML(mensagem.texto)}</p>` : ""}
    `;
  } else if (tipo === "audio" && mensagem.arquivoUrl) {
    conteudo = `
      <div class="mensagem-midia">
        <audio controls class="mensagem-audio">
          <source src="${mensagem.arquivoUrl}" type="${mensagem.mimeType || "audio/mpeg"}">
          Seu navegador não suporta áudio.
        </audio>
      </div>
      ${mensagem.texto ? `<p class="mensagem-texto legenda-midia">${escaparHTML(mensagem.texto)}</p>` : ""}
    `;
  } else if (tipo === "arquivo" && mensagem.arquivoUrl) {
    conteudo = `
      <a href="${mensagem.arquivoUrl}" target="_blank" class="mensagem-arquivo">
        📎 ${escaparHTML(mensagem.nomeArquivo || "Abrir arquivo")}
      </a>
      ${mensagem.texto ? `<p class="mensagem-texto legenda-midia">${escaparHTML(mensagem.texto)}</p>` : ""}
    `;
  } else {
    conteudo = `<p class="mensagem-texto">${escaparHTML(mensagem.texto || "")}</p>`;
  }

  div.innerHTML = `
    <div class="mensagem-conteudo">
      ${conteudo}
      <span class="mensagem-hora">${formatarHora(mensagem.criadoEm)}</span>
    </div>
  `;

  chatMensagens.appendChild(div);
}

function rolarParaBaixo() {
  chatMensagens.scrollTop = chatMensagens.scrollHeight;
}

async function enviarMensagem() {
  const texto = chatInput.value.trim();

  if (!texto || !conversaAtual) return;

  btnEnviar.disabled = true;
  chatInput.disabled = true;

  try {
    const resposta = await fetch(`${API_URL}/api/conversas/${conversaAtual.id}/mensagens`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ texto }),
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      alert(dados.erro || "Erro ao enviar mensagem.");
      return;
    }

    chatInput.value = "";
    ajustarAlturaTextarea();

    await carregarConversas();
  } catch (erro) {
    console.error("Erro ao enviar mensagem:", erro);
    alert("Erro de conexão ao enviar mensagem.");
  } finally {
    btnEnviar.disabled = false;
    chatInput.disabled = false;
    chatInput.focus();
  }
}

async function marcarComoLidas(conversaId) {
  try {
    await fetch(`${API_URL}/api/conversas/${conversaId}/mensagens/marcar-lidas`, {
      method: "PATCH",
      headers: authHeaders(),
    });

    const conversa = conversas.find((c) => c.id === conversaId);
    if (conversa) conversa.mensagensNaoLidas = 0;

    renderizarConversas();
    atualizarEstatisticas();
  } catch (erro) {
    console.error("Erro ao marcar como lidas:", erro);
  }
}

async function atualizarStatus(status) {
  if (!conversaAtual) return;

  try {
    const resposta = await fetch(`${API_URL}/api/conversas/${conversaAtual.id}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ status }),
    });

    if (!resposta.ok) return;

    const conversaAtualizada = await resposta.json();

    conversas = conversas.map((c) =>
      c.id === conversaAtualizada.id ? { ...c, ...conversaAtualizada } : c
    );

    conversaAtual = { ...conversaAtual, ...conversaAtualizada };

    renderizarConversas();
    atualizarEstatisticas();
  } catch (erro) {
    console.error("Erro ao atualizar status:", erro);
  }
}

async function assumirConversa() {
  if (!conversaAtual || !usuario) return;

  try {
    const resposta = await fetch(`${API_URL}/api/conversas/${conversaAtual.id}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({
        status: "em_atendimento",
        atendenteId: usuario.id,
      }),
    });

    if (!resposta.ok) return;

    const conversaAtualizada = await resposta.json();

    conversas = conversas.map((c) =>
      c.id === conversaAtualizada.id ? { ...c, ...conversaAtualizada } : c
    );

    conversaAtual = { ...conversaAtual, ...conversaAtualizada };
    chatStatus.value = conversaAtual.status;

    renderizarConversas();
    atualizarEstatisticas();
  } catch (erro) {
    console.error("Erro ao assumir conversa:", erro);
  }
}

function ajustarAlturaTextarea() {
  chatInput.style.height = "auto";
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
}

function configurarEventos() {
  btnSair.addEventListener("click", sair);

  btnEnviar.addEventListener("click", enviarMensagem);

  chatInput.addEventListener("input", ajustarAlturaTextarea);

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviarMensagem();
    }
  });

  chatStatus.addEventListener("change", () => {
    atualizarStatus(chatStatus.value);
  });

  btnAtribuir.addEventListener("click", assumirConversa);

  searchConversas.addEventListener("input", (e) => {
    buscaAtual = e.target.value;
    renderizarConversas();
  });

  document.querySelectorAll(".filter-btn").forEach((botao) => {
    botao.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach((b) => {
        b.classList.remove("active");
      });

      botao.classList.add("active");
      filtroAtual = botao.dataset.status;
      renderizarConversas();
    });
  });
}

function configurarSocket() {
  socket.on("nova_conversa", async () => {
    await carregarConversas();
  });

  socket.on("conversa_atualizada", async (conversaAtualizada) => {
    conversas = conversas.map((c) =>
      c.id === conversaAtualizada.id ? { ...c, ...conversaAtualizada } : c
    );

    if (conversaAtual?.id === conversaAtualizada.id) {
      conversaAtual = { ...conversaAtual, ...conversaAtualizada };
      chatStatus.value = conversaAtual.status;
    }

    renderizarConversas();
    atualizarEstatisticas();
  });

  socket.on("nova_mensagem", async ({ conversaId, mensagem }) => {
    await carregarConversas();

    if (conversaAtual?.id === conversaId) {
      adicionarMensagemNaTela(mensagem);
      rolarParaBaixo();

      if (mensagem.origem === "cliente") {
        await marcarComoLidas(conversaId);
      }
    }
  });
}

async function iniciar() {
  await verificarAutenticacao();
  configurarEventos();
  configurarSocket();
  await carregarConversas();
}

iniciar();