require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// =============================================================================
// CONFIGURAÇÕES
// =============================================================================
const PORT = process.env.CHAT_PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "sua-chave-secreta-super-segura";
const WHATSAPP_API_URL = process.env.API_BASE_URL || "http://localhost:10000";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

// =============================================================================
// MIDDLEWARES
// =============================================================================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

// =============================================================================
// BANCO DE DADOS SIMPLES (JSON)
// =============================================================================
const DB_PATH = path.join(__dirname, "database");
fs.mkdirSync(DB_PATH, { recursive: true });

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

// Criar usuário admin padrão
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

// Login
app.post("/api/auth/login", (req, res) => {
  const { email, senha } = req.body;
  
  if (!email || !senha) {
    return res.status(400).json({ erro: "Email e senha são obrigatórios" });
  }
  
  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);
  const usuario = usuarios.find((u) => u.email === email && u.ativo);
  
  if (!usuario) {
    return res.status(401).json({ erro: "Credenciais inválidas" });
  }
  
  const senhaValida = bcrypt.compareSync(senha, usuario.senha);
  
  if (!senhaValida) {
    return res.status(401).json({ erro: "Credenciais inválidas" });
  }
  
  const token = jwt.sign(
    { id: usuario.id, email: usuario.email, role: usuario.role },
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

// Registrar novo usuário (apenas admin)
app.post("/api/auth/registrar", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") {
    return res.status(403).json({ erro: "Sem permissão" });
  }
  
  const { nome, email, senha, role } = req.body;
  
  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: "Dados incompletos" });
  }
  
  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);
  
  if (usuarios.find((u) => u.email === email)) {
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

// Verificar token
app.get("/api/auth/verificar", autenticar, (req, res) => {
  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);
  const usuario = usuarios.find((u) => u.id === req.usuario.id && u.ativo);
  
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
// ROTAS DE CONVERSAS
// =============================================================================

// Listar conversas
app.get("/api/conversas", autenticar, (req, res) => {
  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  const mensagens = carregarDB(ARQUIVOS_DB.mensagens);
  
  const conversasComDetalhes = conversas.map((conv) => {
    const mensagensConv = mensagens.filter((m) => m.conversaId === conv.id);
    const ultimaMensagem = mensagensConv[mensagensConv.length - 1];
    const naoLidas = mensagensConv.filter(
      (m) => !m.lida && m.origem === "cliente"
    ).length;
    
    return {
      ...conv,
      ultimaMensagem: ultimaMensagem?.texto || "",
      ultimaMensagemData: ultimaMensagem?.criadoEm || conv.atualizadoEm,
      mensagensNaoLidas: naoLidas,
      totalMensagens: mensagensConv.length,
    };
  });
  
  // Ordenar por última atualização
  conversasComDetalhes.sort((a, b) => {
    return new Date(b.ultimaMensagemData) - new Date(a.ultimaMensagemData);
  });
  
  res.json(conversasComDetalhes);
});

// Buscar conversa específica
app.get("/api/conversas/:id", autenticar, (req, res) => {
  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  const conversa = conversas.find((c) => c.id === req.params.id);
  
  if (!conversa) {
    return res.status(404).json({ erro: "Conversa não encontrada" });
  }
  
  res.json(conversa);
});

// Atualizar status da conversa
app.patch("/api/conversas/:id", autenticar, (req, res) => {
  const { status, atendenteId } = req.body;
  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  const indice = conversas.findIndex((c) => c.id === req.params.id);
  
  if (indice === -1) {
    return res.status(404).json({ erro: "Conversa não encontrada" });
  }
  
  if (status) conversas[indice].status = status;
  if (atendenteId !== undefined) conversas[indice].atendenteId = atendenteId;
  conversas[indice].atualizadoEm = new Date().toISOString();
  
  salvarDB(ARQUIVOS_DB.conversas, conversas);
  
  // Notificar via WebSocket
  io.emit("conversa_atualizada", conversas[indice]);
  
  res.json(conversas[indice]);
});

// =============================================================================
// ROTAS DE MENSAGENS
// =============================================================================

// Listar mensagens de uma conversa
app.get("/api/conversas/:id/mensagens", autenticar, (req, res) => {
  const mensagens = carregarDB(ARQUIVOS_DB.mensagens);
  const mensagensConv = mensagens.filter(
    (m) => m.conversaId === req.params.id
  );
  
  res.json(mensagensConv);
});

// Enviar mensagem
app.post("/api/conversas/:id/mensagens", autenticar, async (req, res) => {
  const { texto } = req.body;
  
  if (!texto) {
    return res.status(400).json({ erro: "Texto é obrigatório" });
  }
  
  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  const conversa = conversas.find((c) => c.id === req.params.id);
  
  if (!conversa) {
    return res.status(404).json({ erro: "Conversa não encontrada" });
  }
  
  const mensagens = carregarDB(ARQUIVOS_DB.mensagens);
  
  const novaMensagem = {
    id: gerarId(),
    conversaId: conversa.id,
    texto,
    origem: "atendente",
    usuarioId: req.usuario.id,
    lida: true,
    criadoEm: new Date().toISOString(),
  };
  
  mensagens.push(novaMensagem);
  salvarDB(ARQUIVOS_DB.mensagens, mensagens);
  
  // Atualizar conversa
  const indice = conversas.findIndex((c) => c.id === conversa.id);
  conversas[indice].atualizadoEm = new Date().toISOString();
  salvarDB(ARQUIVOS_DB.conversas, conversas);
  
  // Enviar para o WhatsApp via API do bot
  try {
    const axios = require("axios");
    await axios.post(
      `${WHATSAPP_API_URL}/enviar-mensagem`,
      {
        telefone: conversa.telefone,
        texto,
      },
      {
        headers: {
          "x-api-key": INTERNAL_API_KEY,
        },
      }
    );
  } catch (erro) {
    console.error("Erro ao enviar para WhatsApp:", erro.message);
  }
  
  // Notificar via WebSocket
  io.emit("nova_mensagem", {
    conversaId: conversa.id,
    mensagem: novaMensagem,
  });
  
  res.json(novaMensagem);
});

// Marcar mensagens como lidas
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

// Listar clientes
app.get("/api/clientes", autenticar, (req, res) => {
  const clientes = carregarDB(ARQUIVOS_DB.clientes);
  res.json(clientes);
});

// =============================================================================
// ROTAS DE ADMINISTRAÇÃO
// =============================================================================

// Listar usuários (apenas admin)
app.get("/api/usuarios", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") {
    return res.status(403).json({ erro: "Sem permissão" });
  }
  
  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);
  
  const usuariosSemSenha = usuarios.map(({ senha, ...usuario }) => usuario);
  
  res.json(usuariosSemSenha);
});

// =============================================================================
// WEBHOOK PARA RECEBER MENSAGENS DO WHATSAPP
// =============================================================================
app.post("/api/webhook/whatsapp", (req, res) => {
  const apiKey = req.headers["x-api-key"];

  if (INTERNAL_API_KEY && apiKey !== INTERNAL_API_KEY) {
    return res.status(401).json({ erro: "API key inválida" });
  }
  const { telefone, mensagem, nomeCliente } = req.body;
  
  if (!telefone || !mensagem) {
    return res.status(400).json({ erro: "Dados incompletos" });
  }
  
  const telefoneNormalizado = normalizarTelefone(telefone);
  
  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  const clientes = carregarDB(ARQUIVOS_DB.clientes);
  const mensagens = carregarDB(ARQUIVOS_DB.mensagens);
  
  // Buscar ou criar cliente
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
  
  // Buscar ou criar conversa
  let conversa = conversas.find(
    (c) => c.telefone === telefoneNormalizado && c.status !== "finalizada"
  );
  
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
    
    // Notificar nova conversa
    io.emit("nova_conversa", conversa);
  } else {
    const indice = conversas.findIndex((c) => c.id === conversa.id);
    conversas[indice].atualizadoEm = new Date().toISOString();
  }
  
  salvarDB(ARQUIVOS_DB.conversas, conversas);
  
  // Adicionar mensagem
  const novaMensagem = {
    id: gerarId(),
    conversaId: conversa.id,
    texto: mensagem,
    origem: "cliente",
    lida: false,
    criadoEm: new Date().toISOString(),
  };
  
  mensagens.push(novaMensagem);
  salvarDB(ARQUIVOS_DB.mensagens, mensagens);
  
  // Notificar via WebSocket
  io.emit("nova_mensagem", {
    conversaId: conversa.id,
    mensagem: novaMensagem,
  });
  
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