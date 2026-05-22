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
const chatAtendenteInfo = document.getElementById("chatAtendenteInfo");
const btnFinalizarConversa = document.getElementById("btnFinalizarConversa");
const btnReabrirConversa = document.getElementById("btnReabrirConversa");

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
    let passaFiltro = true;

    if (filtroAtual === "minhas") {
      passaFiltro = conversa.atendenteId === usuario?.id;
    } else if (filtroAtual !== "todas") {
      passaFiltro = conversa.status === filtroAtual;
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

  if (tipo === "imagem") return "🖼️ Imagem enviada";
  if (tipo === "audio") return "🎧 Áudio enviado";
  if (tipo === "video") return "🎬 Vídeo enviado";
  if (tipo === "arquivo") return "📎 Arquivo enviado";

  if (texto.toLowerCase().includes("áudio")) return "🎧 Áudio enviado";
  if (texto.toLowerCase().includes("foto") || texto.toLowerCase().includes("imagem")) return "🖼️ Imagem enviada";
  if (texto.toLowerCase().includes("arquivo") || texto.toLowerCase().includes("documento")) return "📎 Arquivo enviado";

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

        ${conversa.atendenteNome ? `<small class="conversa-atendente">👤 ${escaparHTML(conversa.atendenteNome)}</small>` : ""}
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
  atualizarInfoAtendente(conversa);
  atualizarBotoesConversa(conversa);

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
function iconeArquivo(mimeType = "", nomeArquivo = "") {
  const nome = nomeArquivo.toLowerCase();

  if (mimeType.includes("pdf") || nome.endsWith(".pdf")) return "📄";
  if (mimeType.includes("word") || nome.endsWith(".doc") || nome.endsWith(".docx")) return "📝";
  if (mimeType.includes("excel") || nome.endsWith(".xls") || nome.endsWith(".xlsx")) return "📊";
  if (mimeType.includes("zip") || nome.endsWith(".zip") || nome.endsWith(".rar")) return "🗜️";
  if (mimeType.includes("video")) return "🎬";
  if (mimeType.includes("audio")) return "🎧";
  if (mimeType.includes("image")) return "🖼️";

  return "📎";
}
function adicionarMensagemNaTela(mensagem) {
  const div = document.createElement("div");
  div.className = `mensagem ${mensagem.origem === "atendente" ? "atendente" : "cliente"}`;

  const tipo = mensagem.tipo || "texto";
  const arquivoUrl = mensagem.arquivoUrl || "";
  const nomeArquivo = mensagem.nomeArquivo || "Arquivo enviado";
  const mimeType = mensagem.mimeType || "";

  let conteudo = "";

  if (tipo === "imagem" && arquivoUrl) {
    conteudo = `
      <div class="mensagem-midia">
        <img 
          src="${arquivoUrl}" 
          alt="Imagem enviada" 
          class="mensagem-imagem"
          data-url="${arquivoUrl}"
        >
      </div>
      ${mensagem.texto ? `<p class="mensagem-texto legenda-midia">${escaparHTML(mensagem.texto)}</p>` : ""}
    `;
  } else if (tipo === "audio" && arquivoUrl) {
    conteudo = `
      <div class="mensagem-midia">
        <audio controls class="mensagem-audio">
          <source src="${arquivoUrl}" type="${mimeType || "audio/mpeg"}">
          Seu navegador não suporta áudio.
        </audio>
      </div>
      ${mensagem.texto ? `<p class="mensagem-texto legenda-midia">${escaparHTML(mensagem.texto)}</p>` : ""}
    `;
  } else if (tipo === "video" && arquivoUrl) {
    conteudo = `
      <div class="mensagem-midia">
        <video controls class="mensagem-video">
          <source src="${arquivoUrl}" type="${mimeType || "video/mp4"}">
          Seu navegador não suporta vídeo.
        </video>
      </div>
      ${mensagem.texto ? `<p class="mensagem-texto legenda-midia">${escaparHTML(mensagem.texto)}</p>` : ""}
    `;
  } else if (arquivoUrl) {
    conteudo = `
      <div class="mensagem-arquivo-card">
        <div class="arquivo-icone">${iconeArquivo(mimeType, nomeArquivo)}</div>

        <div class="arquivo-info">
          <strong>${escaparHTML(nomeArquivo)}</strong>
          <span>${escaparHTML(mimeType || "Arquivo")}</span>
        </div>

        <div class="arquivo-acoes">
          <a href="${arquivoUrl}" target="_blank" class="arquivo-btn">
            Abrir
          </a>
          <a href="${arquivoUrl}" download="${escaparHTML(nomeArquivo)}" class="arquivo-btn">
            Baixar
          </a>
        </div>
      </div>

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

  if (conversaAtual.status === "finalizada") {
    alert("Esta conversa está finalizada. Reabra antes de responder.");
    return;
  }

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
    atualizarBotoesConversa(conversaAtual);
    if (conversaAtual?.status !== "finalizada") {
      chatInput.focus();
    }
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
    chatStatus.value = conversaAtual.status;
    atualizarInfoAtendente(conversaAtual);
    atualizarBotoesConversa(conversaAtual);

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
        assumir: true,
      }),
    });

    const conversaAtualizada = await resposta.json();

    if (!resposta.ok) {
      alert(conversaAtualizada.erro || "Erro ao assumir conversa.");
      return;
    }

    conversas = conversas.map((c) =>
      c.id === conversaAtualizada.id ? { ...c, ...conversaAtualizada } : c
    );

    conversaAtual = { ...conversaAtual, ...conversaAtualizada };
    chatStatus.value = conversaAtual.status;

    atualizarInfoAtendente(conversaAtual);
    atualizarBotoesConversa(conversaAtual);
    renderizarConversas();
    atualizarEstatisticas();
  } catch (erro) {
    console.error("Erro ao assumir conversa:", erro);
    alert("Erro de conexão ao assumir conversa.");
  }
}

function atualizarInfoAtendente(conversa) {
  if (!chatAtendenteInfo) return;

  if (conversa?.atendenteNome) {
    chatAtendenteInfo.textContent = `Atendente: ${conversa.atendenteNome}`;
    chatAtendenteInfo.classList.add("com-atendente");
  } else {
    chatAtendenteInfo.textContent = "Sem atendente responsável";
    chatAtendenteInfo.classList.remove("com-atendente");
  }
}

function atualizarBotoesConversa(conversa) {
  if (!chatInput || !btnEnviar) return;

  const finalizada = conversa?.status === "finalizada";

  if (btnFinalizarConversa) {
    btnFinalizarConversa.style.display = finalizada ? "none" : "inline-flex";
  }

  if (btnReabrirConversa) {
    btnReabrirConversa.style.display = finalizada ? "inline-flex" : "none";
  }

  if (btnAtribuir) {
    btnAtribuir.style.display = finalizada ? "none" : "inline-flex";
  }

  chatInput.disabled = finalizada;
  btnEnviar.disabled = finalizada;
  chatInput.placeholder = finalizada
    ? "Conversa finalizada. Reabra para responder."
    : "Digite sua mensagem...";
}

async function finalizarConversa() {
  if (!conversaAtual) return;

  const confirmar = confirm("Deseja finalizar esta conversa?");
  if (!confirmar) return;

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
function abrirModalImagem(url) {
  const modal = document.getElementById("modalImagem");
  const imagem = document.getElementById("imagemAmpliada");

  if (!modal || !imagem || !url) return;

  imagem.src = url;
  modal.style.display = "flex";
  document.body.classList.add("modal-aberto");
}

function fecharModalImagem() {
  const modal = document.getElementById("modalImagem");
  const imagem = document.getElementById("imagemAmpliada");

  if (!modal || !imagem) return;

  modal.style.display = "none";
  imagem.src = "";
  document.body.classList.remove("modal-aberto");
}

async function baixarImagemAtual() {
  const imagem = document.getElementById("imagemAmpliada");
  const url = imagem?.src;

  if (!url) return;

  try {
    const resposta = await fetch(url);
    const blob = await resposta.blob();

    const urlTemporaria = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = urlTemporaria;
    link.download = `imagem-avseg-${Date.now()}.jpg`;
    document.body.appendChild(link);
    link.click();

    link.remove();
    URL.revokeObjectURL(urlTemporaria);
  } catch (erro) {
    console.error("Erro ao baixar imagem:", erro);

    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.download = `imagem-avseg-${Date.now()}.jpg`;
    link.click();
  }
}
function abrirModalAtendentes() {
  const modal = document.getElementById("modalAtendentes");
  if (!modal) return;

  modal.style.display = "flex";
  carregarAtendentes();
}

function fecharModalAtendentes() {
  const modal = document.getElementById("modalAtendentes");
  if (!modal) return;

  modal.style.display = "none";
}

function primeiraLetraUsuario(nome, email) {
  const base = nome || email || "U";
  return base.trim().charAt(0).toUpperCase();
}

function mostrarErroAtendente(mensagem) {
  const erro = document.getElementById("erroAtendente");
  if (!erro) return;

  erro.textContent = mensagem;
  erro.style.display = "block";
}

function esconderErroAtendente() {
  const erro = document.getElementById("erroAtendente");
  if (!erro) return;

  erro.textContent = "";
  erro.style.display = "none";
}

async function carregarAtendentes() {
  const lista = document.getElementById("listaAtendentes");

  if (!lista) return;

  lista.innerHTML = `<div class="loading">Carregando atendentes...</div>`;

  try {
    const resposta = await fetch(`${API_URL}/api/usuarios`, {
      headers: authHeaders(),
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      lista.innerHTML = `<div class="loading">${dados.erro || "Erro ao carregar atendentes."}</div>`;
      return;
    }

    if (!dados.length) {
      lista.innerHTML = `<div class="loading">Nenhum usuário cadastrado.</div>`;
      return;
    }

    lista.innerHTML = "";

    dados.forEach((atendente) => {
      const item = document.createElement("div");
      item.className = "atendente-item";

      const podeExcluir = usuario?.role === "admin" && atendente.id !== usuario.id;

item.innerHTML = `
  <div class="atendente-avatar">
    ${primeiraLetraUsuario(atendente.nome, atendente.email)}
  </div>

  <div class="atendente-info">
    <h5>${escaparHTML(atendente.nome || "Sem nome")}</h5>
    <p>${escaparHTML(atendente.email || "")}</p>
  </div>

  <div class="atendente-acoes">
    <span class="atendente-role ${atendente.role}">
      ${atendente.role === "admin" ? "Admin" : "Atendente"}
    </span>

    ${
      podeExcluir
        ? `<button class="btn-excluir-atendente" data-id="${atendente.id}" data-nome="${escaparHTML(atendente.nome || atendente.email)}">
            Excluir
          </button>`
        : ""
    }
  </div>
`;

      lista.appendChild(item);
    });
  } catch (erro) {
    console.error("Erro ao carregar atendentes:", erro);
    lista.innerHTML = `<div class="loading">Erro de conexão ao carregar atendentes.</div>`;
  }
}

async function criarAtendente(e) {
  e.preventDefault();
  esconderErroAtendente();

  const nome = document.getElementById("novoNome")?.value.trim();
  const email = document.getElementById("novoEmail")?.value.trim();
  const senha = document.getElementById("novaSenha")?.value;
  const role = document.getElementById("novoRole")?.value || "atendente";

  if (!nome || !email || !senha) {
    mostrarErroAtendente("Preencha nome, email e senha.");
    return;
  }

  if (senha.length < 6) {
    mostrarErroAtendente("Use uma senha com pelo menos 6 caracteres.");
    return;
  }

  try {
    const resposta = await fetch(`${API_URL}/api/auth/registrar`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        nome,
        email,
        senha,
        role,
      }),
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      mostrarErroAtendente(dados.erro || "Erro ao criar atendente.");
      return;
    }

    document.getElementById("formNovoAtendente").reset();
    await carregarAtendentes();
  } catch (erro) {
    console.error("Erro ao criar atendente:", erro);
    mostrarErroAtendente("Erro de conexão ao criar atendente.");
  }
}
async function excluirAtendente(id, nome) {
  if (!id) return;

  const confirmar = confirm(
    `Tem certeza que deseja excluir o usuário "${nome}"?\n\nEle não poderá mais acessar o chat.`
  );

  if (!confirmar) return;

  try {
    const resposta = await fetch(`${API_URL}/api/usuarios/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      alert(dados.erro || "Erro ao excluir usuário.");
      return;
    }

    await carregarAtendentes();
  } catch (erro) {
    console.error("Erro ao excluir atendente:", erro);
    alert("Erro de conexão ao excluir usuário.");
  }
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
  btnFinalizarConversa?.addEventListener("click", finalizarConversa);
  btnReabrirConversa?.addEventListener("click", reabrirConversa);

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

  const modalImagem = document.getElementById("modalImagem");
  const btnFecharImagem = document.getElementById("btnFecharImagem");
  const btnBaixarImagem = document.getElementById("btnBaixarImagem");

  btnFecharImagem?.addEventListener("click", fecharModalImagem);
  btnBaixarImagem?.addEventListener("click", baixarImagemAtual);

  modalImagem?.addEventListener("click", (e) => {
    if (e.target === modalImagem) {
      fecharModalImagem();
    }
  });

  const btnAbrirAtendentes = document.getElementById("btnAbrirAtendentes");
  const btnFecharAtendentes = document.getElementById("btnFecharAtendentes");
  const modalAtendentes = document.getElementById("modalAtendentes");
  const formNovoAtendente = document.getElementById("formNovoAtendente");

  btnAbrirAtendentes?.addEventListener("click", abrirModalAtendentes);
  btnFecharAtendentes?.addEventListener("click", fecharModalAtendentes);
  formNovoAtendente?.addEventListener("submit", criarAtendente);

  modalAtendentes?.addEventListener("click", (e) => {
    if (e.target === modalAtendentes) {
      fecharModalAtendentes();
    }
  });

  document.addEventListener("click", (e) => {
    const imagemMensagem = e.target.closest(".mensagem-imagem");

    if (imagemMensagem) {
      abrirModalImagem(imagemMensagem.dataset.url);
      return;
    }

    const btnExcluir = e.target.closest(".btn-excluir-atendente");

    if (btnExcluir) {
      excluirAtendente(btnExcluir.dataset.id, btnExcluir.dataset.nome);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      fecharModalImagem();
      fecharModalAtendentes();
    }
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
      atualizarInfoAtendente(conversaAtual);
      atualizarBotoesConversa(conversaAtual);
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