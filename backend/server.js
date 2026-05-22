require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE"],
  },
});

// =============================================================================
// CONFIGURAÇÕES
// =============================================================================
const PORT = process.env.CHAT_PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "sua-chave-secreta-super-segura";
const WHATSAPP_API_URL = process.env.API_BASE_URL || "http://localhost:10000";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || process.env.CHAT_PUBLIC_URL || "";

// =============================================================================
// PASTAS
// =============================================================================
const DB_PATH = path.join(__dirname, "database");
const UPLOADS_PATH = path.join(__dirname, "uploads");
fs.mkdirSync(DB_PATH, { recursive: true });
fs.mkdirSync(UPLOADS_PATH, { recursive: true });

// =============================================================================
// MIDDLEWARES
// =============================================================================
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
app.use("/uploads", express.static(UPLOADS_PATH));
app.use(express.static(path.join(__dirname, "../frontend")));

// =============================================================================
// UPLOAD DE ARQUIVOS
// =============================================================================
function limparNomeArquivo(nome) {
  return String(nome || "arquivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_PATH),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const base = path.basename(file.originalname || "arquivo", ext);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}-${limparNomeArquivo(base)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB
  },
});

// =============================================================================
// BANCO DE DADOS SIMPLES (JSON)
// =============================================================================
const ARQUIVOS_DB = {
  usuarios: path.join(DB_PATH, "usuarios.json"),
  conversas: path.join(DB_PATH, "conversas.json"),
  mensagens: path.join(DB_PATH, "mensagens.json"),
  clientes: path.join(DB_PATH, "clientes.json"),
};

function carregarDB(arquivo) {
  try {
    if (!fs.existsSync(arquivo)) {
      fs.writeFileSync(arquivo, JSON.stringify([], null, 2));
      return [];
    }

    const conteudo = fs.readFileSync(arquivo, "utf8");
    return JSON.parse(conteudo || "[]");
  } catch (erro) {
    console.error(`Erro ao carregar ${arquivo}:`, erro.message);
    return [];
  }
}

function salvarDB(arquivo, dados) {
  try {
    fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2));
  } catch (erro) {
    console.error(`Erro ao salvar ${arquivo}:`, erro.message);
  }
}

// =============================================================================
// UTILITÁRIOS
// =============================================================================
function gerarId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function normalizarTelefone(telefone) {
  let digitos = String(telefone || "").replace(/\D/g, "");

  if (!digitos) return "";

  if (!digitos.startsWith("55")) {
    digitos = `55${digitos}`;
  }

  if (digitos.length === 12) {
    const ddd = digitos.slice(2, 4);
    const numero = digitos.slice(4);

    if (!numero.startsWith("9")) {
      digitos = `55${ddd}9${numero}`;
    }
  }

  return digitos;
}

function baseUrlReq(req) {
  return (PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}

function detectarTipoPorMime(mimeType = "") {
  if (mimeType.startsWith("image/")) return "imagem";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "arquivo";
}

function buscarAtendenteNome(usuarios, atendenteId) {
  if (!atendenteId) return null;

  const atendente = usuarios.find((u) => u.id === atendenteId);
  return atendente?.nome || null;
}

function montarConversaDetalhada(conversa, mensagens, usuarios) {
  const mensagensConv = mensagens.filter((m) => m.conversaId === conversa.id);
  const ultimaMensagem = mensagensConv[mensagensConv.length - 1];

  const naoLidas = mensagensConv.filter(
    (m) => !m.lida && m.origem === "cliente"
  ).length;

  return {
    ...conversa,
    atendenteNome: buscarAtendenteNome(usuarios, conversa.atendenteId),
    ultimaMensagem: ultimaMensagem?.texto || "",
    ultimaMensagemTipo: ultimaMensagem?.tipo || "texto",
    ultimaMensagemNomeArquivo: ultimaMensagem?.nomeArquivo || "",
    ultimaMensagemData: ultimaMensagem?.criadoEm || conversa.atualizadoEm,
    mensagensNaoLidas: naoLidas,
    totalMensagens: mensagensConv.length,
  };
}

// =============================================================================
// CRIAR ADMIN PADRÃO
// =============================================================================
function criarAdminSeNaoExistir() {
  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);

  if (usuarios.length === 0) {
    const senhaHash = bcrypt.hashSync("admin123", 10);

    usuarios.push({
      id: gerarId(),
      nome: "Administrador",
      email: "admin@avseg.com",
      senha: senhaHash,
      role: "admin",
      ativo: true,
      criadoEm: new Date().toISOString(),
    });

    salvarDB(ARQUIVOS_DB.usuarios, usuarios);

    console.log("✅ Usuário admin criado:");
    console.log("   Email: admin@avseg.com");
    console.log("   Senha: admin123");
  }
}

// =============================================================================
// MIDDLEWARE DE AUTENTICAÇÃO
// =============================================================================
function autenticar(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ erro: "Token não fornecido" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.usuario = decoded;
    next();
  } catch (erro) {
    return res.status(401).json({ erro: "Token inválido" });
  }
}

// =============================================================================
// ROTAS DE AUTENTICAÇÃO
// =============================================================================
app.post("/api/auth/login", (req, res) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: "Email e senha são obrigatórios" });
  }

  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);
  const usuario = usuarios.find((u) => u.email === email && u.ativo !== false);

  if (!usuario) {
    return res.status(401).json({ erro: "Credenciais inválidas" });
  }

  const senhaValida = bcrypt.compareSync(senha, usuario.senha);

  if (!senhaValida) {
    return res.status(401).json({ erro: "Credenciais inválidas" });
  }

  const token = jwt.sign(
    {
      id: usuario.id,
      email: usuario.email,
      role: usuario.role,
    },
    JWT_SECRET,
    { expiresIn: "24h" }
  );

  res.json({
    token,
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      role: usuario.role,
    },
  });
});

app.post("/api/auth/registrar", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") {
    return res.status(403).json({ erro: "Sem permissão" });
  }

  const { nome, email, senha, role } = req.body;

  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: "Dados incompletos" });
  }

  if (senha.length < 6) {
    return res.status(400).json({ erro: "A senha precisa ter pelo menos 6 caracteres" });
  }

  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);

  if (usuarios.find((u) => u.email === email && u.ativo !== false)) {
    return res.status(400).json({ erro: "Email já cadastrado" });
  }

  const senhaHash = bcrypt.hashSync(senha, 10);

  const novoUsuario = {
    id: gerarId(),
    nome,
    email,
    senha: senhaHash,
    role: role || "atendente",
    ativo: true,
    criadoEm: new Date().toISOString(),
  };

  usuarios.push(novoUsuario);
  salvarDB(ARQUIVOS_DB.usuarios, usuarios);

  res.json({
    id: novoUsuario.id,
    nome: novoUsuario.nome,
    email: novoUsuario.email,
    role: novoUsuario.role,
  });
});

app.get("/api/auth/verificar", autenticar, (req, res) => {
  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);
  const usuario = usuarios.find((u) => u.id === req.usuario.id && u.ativo !== false);

  if (!usuario) {
    return res.status(401).json({ erro: "Usuário não encontrado" });
  }

  res.json({
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      role: usuario.role,
    },
  });
});

// =============================================================================
// ROTAS DE UPLOAD
// =============================================================================
app.post("/api/upload", autenticar, upload.single("arquivo"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ erro: "Arquivo não enviado" });
  }

  const arquivoUrl = `${baseUrlReq(req)}/uploads/${req.file.filename}`;
  const mimeType = req.file.mimetype || "application/octet-stream";

  res.json({
    ok: true,
    tipo: detectarTipoPorMime(mimeType),
    arquivoUrl,
    mimeType,
    nomeArquivo: req.file.originalname || req.file.filename,
    tamanho: req.file.size,
  });
});

// =============================================================================
// ROTAS DE CONVERSAS
// =============================================================================
app.get("/api/conversas", autenticar, (req, res) => {
  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  const mensagens = carregarDB(ARQUIVOS_DB.mensagens);
  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);

  const conversasComDetalhes = conversas.map((conv) =>
    montarConversaDetalhada(conv, mensagens, usuarios)
  );

  conversasComDetalhes.sort((a, b) => {
    return new Date(b.ultimaMensagemData) - new Date(a.ultimaMensagemData);
  });

  res.json(conversasComDetalhes);
});

app.get("/api/conversas/:id", autenticar, (req, res) => {
  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  const mensagens = carregarDB(ARQUIVOS_DB.mensagens);
  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);

  const conversa = conversas.find((c) => c.id === req.params.id);

  if (!conversa) {
    return res.status(404).json({ erro: "Conversa não encontrada" });
  }

  res.json(montarConversaDetalhada(conversa, mensagens, usuarios));
});

app.patch("/api/conversas/:id", autenticar, async (req, res) => {
  const { status, atendenteId, assumir } = req.body;

  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  const mensagens = carregarDB(ARQUIVOS_DB.mensagens);
  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);

  const indice = conversas.findIndex((c) => c.id === req.params.id);

  if (indice === -1) {
    return res.status(404).json({ erro: "Conversa não encontrada" });
  }

  const conversa = conversas[indice];

  if (assumir) {
    if (
      conversa.atendenteId &&
      conversa.atendenteId !== req.usuario.id &&
      conversa.status === "em_atendimento"
    ) {
      const atendenteAtual = usuarios.find((u) => u.id === conversa.atendenteId);

      return res.status(409).json({
        erro: `Essa conversa já está com ${atendenteAtual?.nome || "outro atendente"}.`,
      });
    }

    conversa.atendenteId = req.usuario.id;
    conversa.status = "em_atendimento";
  }

  if (status) {
    conversa.status = status;

    if (status === "finalizada") {
      conversa.finalizadaEm = new Date().toISOString();
    }

    if (status === "aguardando" || status === "em_atendimento") {
      conversa.finalizadaEm = null;
    }
  }

  if (atendenteId !== undefined) {
    conversa.atendenteId = atendenteId;
  }

  conversa.atualizadoEm = new Date().toISOString();

  salvarDB(ARQUIVOS_DB.conversas, conversas);

  const conversaAtualizada = montarConversaDetalhada(conversa, mensagens, usuarios);

  io.emit("conversa_atualizada", conversaAtualizada);

  // Futuro: avisar bot para liberar atendimento automático quando finalizar.
  if (status === "finalizada") {
    try {
      const axios = require("axios");
      await axios.post(
        `${WHATSAPP_API_URL}/chat/finalizar`,
        { telefone: conversa.telefone, conversaId: conversa.id },
        { headers: { "x-api-key": INTERNAL_API_KEY } }
      );
    } catch (erro) {
      console.error("Aviso ao bot sobre finalização falhou:", erro.response?.data || erro.message);
    }
  }

  res.json(conversaAtualizada);
});


// Transferir conversa para outro atendente
app.patch("/api/conversas/:id/transferir", autenticar, (req, res) => {
  const { atendenteId } = req.body;

  if (!atendenteId) {
    return res.status(400).json({ erro: "Informe o atendente de destino." });
  }

  if (atendenteId === req.usuario.id) {
    return res.status(400).json({ erro: "Você não pode transferir a conversa para você mesmo." });
  }

  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  const mensagens = carregarDB(ARQUIVOS_DB.mensagens);
  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);

  const indice = conversas.findIndex((c) => c.id === req.params.id);

  if (indice === -1) {
    return res.status(404).json({ erro: "Conversa não encontrada" });
  }

  const conversa = conversas[indice];

  if (conversa.status === "finalizada") {
    return res.status(400).json({
      erro: "Esta conversa está finalizada. Reabra antes de transferir.",
    });
  }

  const usuarioLogado = usuarios.find((u) => u.id === req.usuario.id && u.ativo !== false);
  const destino = usuarios.find((u) => u.id === atendenteId && u.ativo !== false);

  if (!destino) {
    return res.status(404).json({ erro: "Atendente de destino não encontrado." });
  }

  const podeTransferir =
    usuarioLogado?.role === "admin" ||
    !conversa.atendenteId ||
    conversa.atendenteId === req.usuario.id;

  if (!podeTransferir) {
    const atendenteAtual = usuarios.find((u) => u.id === conversa.atendenteId);

    return res.status(403).json({
      erro: `Somente administrador ou o atendente responsável (${atendenteAtual?.nome || "atual"}) pode transferir esta conversa.`,
    });
  }

  const atendenteAnterior = usuarios.find((u) => u.id === conversa.atendenteId);

  conversa.atendenteId = destino.id;
  conversa.status = "em_atendimento";
  conversa.finalizadaEm = null;
  conversa.atualizadoEm = new Date().toISOString();

  const mensagemSistema = {
    id: gerarId(),
    conversaId: conversa.id,
    tipo: "sistema",
    texto: `Conversa transferida ${atendenteAnterior?.nome ? `de ${atendenteAnterior.nome} ` : ""}para ${destino.nome}.`,
    origem: "sistema",
    usuarioId: req.usuario.id,
    lida: true,
    criadoEm: new Date().toISOString(),
  };

  mensagens.push(mensagemSistema);

  salvarDB(ARQUIVOS_DB.conversas, conversas);
  salvarDB(ARQUIVOS_DB.mensagens, mensagens);

  const conversaAtualizada = montarConversaDetalhada(conversa, mensagens, usuarios);

  io.emit("nova_mensagem", {
    conversaId: conversa.id,
    mensagem: mensagemSistema,
  });

  io.emit("conversa_atualizada", conversaAtualizada);

  res.json(conversaAtualizada);
});

// =============================================================================
// ROTAS DE MENSAGENS
// =============================================================================
app.get("/api/conversas/:id/mensagens", autenticar, (req, res) => {
  const mensagens = carregarDB(ARQUIVOS_DB.mensagens);
  const mensagensConv = mensagens.filter((m) => m.conversaId === req.params.id);

  res.json(mensagensConv);
});

app.post("/api/conversas/:id/mensagens", autenticar, async (req, res) => {
  const { texto, tipo, arquivoUrl, mimeType, nomeArquivo } = req.body;

  if (!texto && !arquivoUrl) {
    return res.status(400).json({ erro: "Texto ou arquivo é obrigatório" });
  }

  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  const conversa = conversas.find((c) => c.id === req.params.id);

  if (!conversa) {
    return res.status(404).json({ erro: "Conversa não encontrada" });
  }

  if (conversa.status === "finalizada") {
    return res.status(400).json({
      erro: "Esta conversa está finalizada. Reabra antes de responder.",
    });
  }

  const mensagens = carregarDB(ARQUIVOS_DB.mensagens);

  const novaMensagem = {
    id: gerarId(),
    conversaId: conversa.id,
    tipo: tipo || detectarTipoPorMime(mimeType || "") || "texto",
    texto: texto || "",
    arquivoUrl: arquivoUrl || null,
    mimeType: mimeType || null,
    nomeArquivo: nomeArquivo || null,
    origem: "atendente",
    usuarioId: req.usuario.id,
    lida: true,
    criadoEm: new Date().toISOString(),
  };

  mensagens.push(novaMensagem);
  salvarDB(ARQUIVOS_DB.mensagens, mensagens);

  const indice = conversas.findIndex((c) => c.id === conversa.id);
  conversas[indice].atualizadoEm = new Date().toISOString();

  if (!conversas[indice].atendenteId) {
    conversas[indice].atendenteId = req.usuario.id;
  }

  if (conversas[indice].status === "aguardando") {
    conversas[indice].status = "em_atendimento";
  }

  salvarDB(ARQUIVOS_DB.conversas, conversas);

  // Enviar para o WhatsApp via API do bot.
  // Se o bot ainda só aceitar texto, ele vai ignorar/erro nos campos de mídia sem quebrar o chat.
  try {
    const axios = require("axios");

    await axios.post(
      `${WHATSAPP_API_URL}/enviar-mensagem`,
      {
        telefone: conversa.telefone,
        texto: texto || "",
        tipo: novaMensagem.tipo,
        arquivoUrl: novaMensagem.arquivoUrl,
        mimeType: novaMensagem.mimeType,
        nomeArquivo: novaMensagem.nomeArquivo,
      },
      {
        headers: {
          "x-api-key": INTERNAL_API_KEY,
        },
      }
    );
  } catch (erro) {
    console.error(
      "Erro ao enviar para WhatsApp:",
      erro.response?.data || erro.message
    );
  }

  io.emit("nova_mensagem", {
    conversaId: conversa.id,
    mensagem: novaMensagem,
  });

  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);
  const conversaAtualizada = montarConversaDetalhada(
    conversas[indice],
    mensagens,
    usuarios
  );

  io.emit("conversa_atualizada", conversaAtualizada);

  res.json(novaMensagem);
});

app.patch("/api/conversas/:id/mensagens/marcar-lidas", autenticar, (req, res) => {
  const mensagens = carregarDB(ARQUIVOS_DB.mensagens);

  let atualizadas = 0;

  mensagens.forEach((m) => {
    if (m.conversaId === req.params.id && !m.lida && m.origem === "cliente") {
      m.lida = true;
      atualizadas++;
    }
  });

  if (atualizadas > 0) {
    salvarDB(ARQUIVOS_DB.mensagens, mensagens);
  }

  res.json({ mensagensAtualizadas: atualizadas });
});

// =============================================================================
// ROTAS DE CLIENTES
// =============================================================================
app.get("/api/clientes", autenticar, (req, res) => {
  const clientes = carregarDB(ARQUIVOS_DB.clientes);
  res.json(clientes);
});


// Listar atendentes ativos para transferência
app.get("/api/usuarios/atendentes", autenticar, (req, res) => {
  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);

  const atendentes = usuarios
    .filter((u) => u.ativo !== false)
    .map(({ senha, ...usuario }) => usuario);

  res.json(atendentes);
});

// =============================================================================
// ROTAS DE ADMINISTRAÇÃO
// =============================================================================
app.get("/api/usuarios", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") {
    return res.status(403).json({ erro: "Sem permissão" });
  }

  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);

  const usuariosSemSenha = usuarios
    .filter((u) => u.ativo !== false)
    .map(({ senha, ...usuario }) => usuario);

  res.json(usuariosSemSenha);
});

app.delete("/api/usuarios/:id", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") {
    return res.status(403).json({ erro: "Sem permissão" });
  }

  const usuarioId = req.params.id;

  if (usuarioId === req.usuario.id) {
    return res.status(400).json({
      erro: "Você não pode excluir seu próprio usuário logado.",
    });
  }

  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);
  const indice = usuarios.findIndex(
    (u) => u.id === usuarioId && u.ativo !== false
  );

  if (indice === -1) {
    return res.status(404).json({ erro: "Usuário não encontrado" });
  }

  const usuario = usuarios[indice];

  if (usuario.role === "admin") {
    const adminsAtivos = usuarios.filter(
      (u) => u.role === "admin" && u.ativo !== false
    );

    if (adminsAtivos.length <= 1) {
      return res.status(400).json({
        erro: "Não é possível excluir o último administrador.",
      });
    }
  }

  usuarios[indice].ativo = false;
  usuarios[indice].excluidoEm = new Date().toISOString();

  salvarDB(ARQUIVOS_DB.usuarios, usuarios);

  res.json({
    ok: true,
    mensagem: "Usuário excluído com sucesso.",
  });
});

// =============================================================================
// WEBHOOK PARA RECEBER MENSAGENS DO WHATSAPP
// =============================================================================
app.post("/api/webhook/whatsapp", (req, res) => {
  const apiKey = req.headers["x-api-key"];

  if (INTERNAL_API_KEY && apiKey !== INTERNAL_API_KEY) {
    return res.status(401).json({ erro: "API key inválida" });
  }

  const {
    telefone,
    mensagem,
    nomeCliente,
    tipo,
    arquivoUrl,
    mimeType,
    nomeArquivo,
  } = req.body;

  if (!telefone || (!mensagem && !arquivoUrl)) {
    return res.status(400).json({ erro: "Dados incompletos" });
  }

  const telefoneNormalizado = normalizarTelefone(telefone);

  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  const clientes = carregarDB(ARQUIVOS_DB.clientes);
  const mensagens = carregarDB(ARQUIVOS_DB.mensagens);

  let cliente = clientes.find((c) => c.telefone === telefoneNormalizado);

  if (!cliente) {
    cliente = {
      id: gerarId(),
      telefone: telefoneNormalizado,
      nome: nomeCliente || "Cliente",
      criadoEm: new Date().toISOString(),
    };

    clientes.push(cliente);
    salvarDB(ARQUIVOS_DB.clientes, clientes);
  } else if (nomeCliente && cliente.nome !== nomeCliente) {
    cliente.nome = nomeCliente;
    salvarDB(ARQUIVOS_DB.clientes, clientes);
  }

  let conversa = conversas.find(
    (c) => c.telefone === telefoneNormalizado && c.status !== "finalizada"
  );

  let novaConversa = false;

  if (!conversa) {
    conversa = {
      id: gerarId(),
      telefone: telefoneNormalizado,
      clienteId: cliente.id,
      clienteNome: cliente.nome,
      status: "aguardando",
      atendenteId: null,
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    };

    conversas.push(conversa);
    novaConversa = true;
  } else {
    const indice = conversas.findIndex((c) => c.id === conversa.id);
    conversas[indice].atualizadoEm = new Date().toISOString();
    conversa = conversas[indice];
  }

  salvarDB(ARQUIVOS_DB.conversas, conversas);

  const novaMensagem = {
    id: gerarId(),
    conversaId: conversa.id,
    tipo: tipo || detectarTipoPorMime(mimeType || "") || "texto",
    texto: mensagem || "",
    arquivoUrl: arquivoUrl || null,
    mimeType: mimeType || null,
    nomeArquivo: nomeArquivo || null,
    origem: "cliente",
    lida: false,
    criadoEm: new Date().toISOString(),
  };

  mensagens.push(novaMensagem);
  salvarDB(ARQUIVOS_DB.mensagens, mensagens);

  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);
  const conversaDetalhada = montarConversaDetalhada(conversa, mensagens, usuarios);

  if (novaConversa) {
    io.emit("nova_conversa", conversaDetalhada);
  }

  io.emit("nova_mensagem", {
    conversaId: conversa.id,
    mensagem: novaMensagem,
  });

  io.emit("conversa_atualizada", conversaDetalhada);

  res.json({ ok: true, conversaId: conversa.id });
});

// =============================================================================
// WEBSOCKET
// =============================================================================
io.on("connection", (socket) => {
  console.log("✅ Cliente conectado:", socket.id);

  socket.on("entrar_conversa", (conversaId) => {
    socket.join(`conversa_${conversaId}`);
    console.log(`👤 Socket ${socket.id} entrou na conversa ${conversaId}`);
  });

  socket.on("sair_conversa", (conversaId) => {
    socket.leave(`conversa_${conversaId}`);
    console.log(`👋 Socket ${socket.id} saiu da conversa ${conversaId}`);
  });

  socket.on("disconnect", () => {
    console.log("❌ Cliente desconectado:", socket.id);
  });
});

// =============================================================================
// INICIALIZAÇÃO
// =============================================================================
criarAdminSeNaoExistir();

server.listen(PORT, () => {
  console.log(`🚀 Servidor de chat rodando na porta ${PORT}`);
  console.log(`📱 Dashboard: http://localhost:${PORT}`);
  console.log(`🔑 Login padrão: admin@avseg.com / admin123`);
});
