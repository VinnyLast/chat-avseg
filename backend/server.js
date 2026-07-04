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
  cors: { origin: "*", methods: ["GET", "POST", "PATCH", "DELETE"] },
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

const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

// =============================================================================
// BANCO DE DADOS (JSON)
// =============================================================================
const ARQUIVOS_DB = {
  usuarios:  path.join(DB_PATH, "usuarios.json"),
  conversas: path.join(DB_PATH, "conversas.json"),
  mensagens: path.join(DB_PATH, "mensagens.json"),
  clientes:  path.join(DB_PATH, "clientes.json"),
  etiquetas: path.join(DB_PATH, "etiquetas.json"),
};

function carregarDB(arquivo) {
  try {
    if (!fs.existsSync(arquivo)) { fs.writeFileSync(arquivo, JSON.stringify([], null, 2)); return []; }
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
  if (!digitos.startsWith("55")) digitos = `55${digitos}`;
  if (digitos.length === 12) {
    const ddd = digitos.slice(2, 4);
    const numero = digitos.slice(4);
    if (!numero.startsWith("9")) digitos = `55${ddd}9${numero}`;
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
  return usuarios.find((u) => u.id === atendenteId)?.nome || null;
}

function montarConversaDetalhada(conversa, mensagens, usuarios) {
  const mensagensConv = mensagens.filter((m) => m.conversaId === conversa.id);
  const ultimaMensagem = mensagensConv[mensagensConv.length - 1];
  const naoLidas = mensagensConv.filter((m) => !m.lida && m.origem === "cliente").length;

  return {
    ...conversa,
    atendenteNome: buscarAtendenteNome(usuarios, conversa.atendenteId),
    ultimaMensagem: ultimaMensagem?.texto || "",
    ultimaMensagemTipo: ultimaMensagem?.tipo || "texto",
    ultimaMensagemNomeArquivo: ultimaMensagem?.nomeArquivo || "",
    ultimaMensagemData: ultimaMensagem?.criadoEm || conversa.atualizadoEm,
    mensagensNaoLidas: naoLidas,
    totalMensagens: mensagensConv.length,
    etiquetas: Array.isArray(conversa.etiquetas) ? conversa.etiquetas : [],
    solicitouHumano: conversa.solicitouHumano === true,
  };
}

// =============================================================================
// INICIALIZAÇÃO DE DADOS PADRÃO
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
    console.log("✅ Usuário admin criado: admin@avseg.com / admin123");
  }
}

function criarEtiquetasPadraoSeNaoExistir() {
  if (fs.existsSync(ARQUIVOS_DB.etiquetas)) return;
  const etiquetasPadrao = [
    { id: gerarId(), nome: "Pagamento", cor: "#f5c400", criadoEm: new Date().toISOString() },
    { id: gerarId(), nome: "Urgente",   cor: "#ef4444", criadoEm: new Date().toISOString() },
    { id: gerarId(), nome: "Sinistro",  cor: "#3b82f6", criadoEm: new Date().toISOString() },
    { id: gerarId(), nome: "Vistoria",  cor: "#22c55e", criadoEm: new Date().toISOString() },
    { id: gerarId(), nome: "Cotação",   cor: "#a855f7", criadoEm: new Date().toISOString() },
  ];
  salvarDB(ARQUIVOS_DB.etiquetas, etiquetasPadrao);
  console.log("✅ Etiquetas padrão criadas.");
}

// =============================================================================
// MIDDLEWARE DE AUTENTICAÇÃO
// =============================================================================
function autenticar(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ erro: "Token não fornecido" });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch (_) {
    return res.status(401).json({ erro: "Token inválido" });
  }
}

// =============================================================================
// ROTAS DE AUTENTICAÇÃO
// =============================================================================
app.post("/api/auth/login", (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ erro: "Email e senha são obrigatórios" });

  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);
  const usuario = usuarios.find((u) => u.email === email && u.ativo !== false);
  if (!usuario) return res.status(401).json({ erro: "Credenciais inválidas" });

  if (!bcrypt.compareSync(senha, usuario.senha)) return res.status(401).json({ erro: "Credenciais inválidas" });

  const token = jwt.sign({ id: usuario.id, email: usuario.email, role: usuario.role }, JWT_SECRET, { expiresIn: "24h" });
  res.json({ token, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role } });
});

app.post("/api/auth/registrar", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") return res.status(403).json({ erro: "Sem permissão" });
  const { nome, email, senha, role } = req.body;
  if (!nome || !email || !senha) return res.status(400).json({ erro: "Dados incompletos" });
  if (senha.length < 6) return res.status(400).json({ erro: "A senha precisa ter pelo menos 6 caracteres" });

  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);
  if (usuarios.find((u) => u.email === email && u.ativo !== false)) return res.status(400).json({ erro: "Email já cadastrado" });

  const novoUsuario = { id: gerarId(), nome, email, senha: bcrypt.hashSync(senha, 10), role: role || "atendente", ativo: true, criadoEm: new Date().toISOString() };
  usuarios.push(novoUsuario);
  salvarDB(ARQUIVOS_DB.usuarios, usuarios);
  res.json({ id: novoUsuario.id, nome: novoUsuario.nome, email: novoUsuario.email, role: novoUsuario.role });
});

app.get("/api/auth/verificar", autenticar, (req, res) => {
  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);
  const usuario = usuarios.find((u) => u.id === req.usuario.id && u.ativo !== false);
  if (!usuario) return res.status(401).json({ erro: "Usuário não encontrado" });
  res.json({ usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role } });
});

// =============================================================================
// ROTAS DE UPLOAD
// =============================================================================
app.post("/api/upload", autenticar, upload.single("arquivo"), (req, res) => {
  if (!req.file) return res.status(400).json({ erro: "Arquivo não enviado" });
  const mimeType = req.file.mimetype || "application/octet-stream";
  res.json({
    ok: true,
    tipo: detectarTipoPorMime(mimeType),
    arquivoUrl: `${baseUrlReq(req)}/uploads/${req.file.filename}`,
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
  const usuarios  = carregarDB(ARQUIVOS_DB.usuarios);

  const conversasComDetalhes = conversas
    .map((conv) => montarConversaDetalhada(conv, mensagens, usuarios))
    .sort((a, b) => new Date(b.ultimaMensagemData) - new Date(a.ultimaMensagemData));

  res.json(conversasComDetalhes);
});

app.get("/api/conversas/:id", autenticar, (req, res) => {
  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  const conversa  = conversas.find((c) => c.id === req.params.id);
  if (!conversa) return res.status(404).json({ erro: "Conversa não encontrada" });
  const mensagens = carregarDB(ARQUIVOS_DB.mensagens);
  const usuarios  = carregarDB(ARQUIVOS_DB.usuarios);
  res.json(montarConversaDetalhada(conversa, mensagens, usuarios));
});

app.patch("/api/conversas/:id", autenticar, async (req, res) => {
  const { status, atendenteId, assumir } = req.body;
  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  const mensagens = carregarDB(ARQUIVOS_DB.mensagens);
  const usuarios  = carregarDB(ARQUIVOS_DB.usuarios);
  const indice = conversas.findIndex((c) => c.id === req.params.id);
  if (indice === -1) return res.status(404).json({ erro: "Conversa não encontrada" });

  const conversa = conversas[indice];

  if (assumir) {
    if (conversa.atendenteId && conversa.atendenteId !== req.usuario.id && conversa.status === "em_atendimento") {
      const atendenteAtual = usuarios.find((u) => u.id === conversa.atendenteId);
      return res.status(409).json({ erro: `Essa conversa já está com ${atendenteAtual?.nome || "outro atendente"}.` });
    }
    conversa.atendenteId = req.usuario.id;
    conversa.status = "em_atendimento";
  }

  if (status) {
    conversa.status = status;
    if (status === "finalizada") conversa.finalizadaEm = new Date().toISOString();
    if (status === "aguardando" || status === "em_atendimento") conversa.finalizadaEm = null;
  }

  if (atendenteId !== undefined) conversa.atendenteId = atendenteId;
  conversa.atualizadoEm = new Date().toISOString();
  salvarDB(ARQUIVOS_DB.conversas, conversas);

  const conversaAtualizada = montarConversaDetalhada(conversa, mensagens, usuarios);
  io.emit("conversa_atualizada", conversaAtualizada);

  if (status === "finalizada") {
    try {
      const axios = require("axios");
      await axios.post(`${WHATSAPP_API_URL}/chat/finalizar`, { telefone: conversa.telefone, conversaId: conversa.id }, { headers: { "x-api-key": INTERNAL_API_KEY } });
    } catch (_) {}
  }

  res.json(conversaAtualizada);
});

app.patch("/api/conversas/:id/transferir", autenticar, (req, res) => {
  const { atendenteId } = req.body;
  if (!atendenteId) return res.status(400).json({ erro: "Informe o atendente de destino." });
  if (atendenteId === req.usuario.id) return res.status(400).json({ erro: "Você não pode transferir para você mesmo." });

  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  const mensagens = carregarDB(ARQUIVOS_DB.mensagens);
  const usuarios  = carregarDB(ARQUIVOS_DB.usuarios);
  const indice = conversas.findIndex((c) => c.id === req.params.id);
  if (indice === -1) return res.status(404).json({ erro: "Conversa não encontrada" });

  const conversa = conversas[indice];
  if (conversa.status === "finalizada") return res.status(400).json({ erro: "Reabra a conversa antes de transferir." });

  const usuarioLogado = usuarios.find((u) => u.id === req.usuario.id && u.ativo !== false);
  const destino = usuarios.find((u) => u.id === atendenteId && u.ativo !== false);
  if (!destino) return res.status(404).json({ erro: "Atendente de destino não encontrado." });

  const podeTransferir = usuarioLogado?.role === "admin" || !conversa.atendenteId || conversa.atendenteId === req.usuario.id;
  if (!podeTransferir) {
    const atual = usuarios.find((u) => u.id === conversa.atendenteId);
    return res.status(403).json({ erro: `Somente o admin ou ${atual?.nome || "o responsável"} pode transferir.` });
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
  io.emit("nova_mensagem", { conversaId: conversa.id, mensagem: mensagemSistema });
  io.emit("conversa_atualizada", conversaAtualizada);

  res.json(conversaAtualizada);
});


// Ativar/desativar flag de solicitação de humano
app.patch('/api/conversas/:id/humano', autenticar, (req, res) => {
  const { ativo } = req.body;
  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  const mensagens = carregarDB(ARQUIVOS_DB.mensagens);
  const usuarios  = carregarDB(ARQUIVOS_DB.usuarios);
  const indice = conversas.findIndex((c) => c.id === req.params.id);
  if (indice === -1) return res.status(404).json({ erro: 'Conversa não encontrada.' });
  conversas[indice].solicitouHumano = ativo !== false ? true : false;
  conversas[indice].atualizadoEm = new Date().toISOString();
  salvarDB(ARQUIVOS_DB.conversas, conversas);
  const conversaAtualizada = montarConversaDetalhada(conversas[indice], mensagens, usuarios);
  io.emit('conversa_atualizada', conversaAtualizada);
  res.json(conversaAtualizada);
});

// =============================================================================
// ROTAS DE MENSAGENS
// =============================================================================
app.get("/api/conversas/:id/mensagens", autenticar, (req, res) => {
  const mensagensConv = carregarDB(ARQUIVOS_DB.mensagens).filter((m) => m.conversaId === req.params.id);
  const { limite, offset } = req.query;

  if (!limite) return res.json(mensagensConv);

  const lim = Math.max(1, parseInt(limite, 10) || 50);
  const off = Math.max(0, parseInt(offset, 10) || 0);
  const total = mensagensConv.length;
  const fim = total - off;
  const inicio = Math.max(0, fim - lim);

  res.json({
    mensagens: mensagensConv.slice(inicio, fim),
    total,
    temMais: inicio > 0,
  });
});

// Adicionar nota interna (visível apenas para a equipe, não enviada ao WhatsApp)
app.post("/api/conversas/:id/notas", autenticar, (req, res) => {
  const { texto } = req.body;
  if (!texto?.trim()) return res.status(400).json({ erro: "Texto da nota é obrigatório." });

  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  const conversa = conversas.find((c) => c.id === req.params.id);
  if (!conversa) return res.status(404).json({ erro: "Conversa não encontrada." });

  const mensagens = carregarDB(ARQUIVOS_DB.mensagens);
  const novaNota = {
    id: gerarId(),
    conversaId: conversa.id,
    tipo: "nota",
    texto: texto.trim(),
    origem: "sistema",
    usuarioId: req.usuario.id,
    privado: true,
    lida: true,
    criadoEm: new Date().toISOString(),
  };

  mensagens.push(novaNota);
  salvarDB(ARQUIVOS_DB.mensagens, mensagens);

  io.emit("nova_mensagem", { conversaId: conversa.id, mensagem: novaNota });
  res.json(novaNota);
});

app.post("/api/conversas/:id/mensagens", autenticar, async (req, res) => {
  const { texto, tipo, arquivoUrl, mimeType, nomeArquivo } = req.body;
  if (!texto && !arquivoUrl) return res.status(400).json({ erro: "Texto ou arquivo é obrigatório" });

  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  const conversa  = conversas.find((c) => c.id === req.params.id);
  if (!conversa) return res.status(404).json({ erro: "Conversa não encontrada" });
  if (conversa.status === "finalizada") return res.status(400).json({ erro: "Conversa finalizada. Reabra antes de responder." });

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
  if (!conversas[indice].atendenteId) conversas[indice].atendenteId = req.usuario.id;
  if (conversas[indice].status === "aguardando") conversas[indice].status = "em_atendimento";
  salvarDB(ARQUIVOS_DB.conversas, conversas);

  try {
    const axios = require("axios");
    await axios.post(`${WHATSAPP_API_URL}/enviar-mensagem`, {
      telefone: conversa.telefone,
      texto: texto || "",
      tipo: novaMensagem.tipo,
      arquivoUrl: novaMensagem.arquivoUrl,
      mimeType: novaMensagem.mimeType,
      nomeArquivo: novaMensagem.nomeArquivo,
    }, { headers: { "x-api-key": INTERNAL_API_KEY } });
  } catch (_) {}

  io.emit("nova_mensagem", { conversaId: conversa.id, mensagem: novaMensagem });
  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);
  io.emit("conversa_atualizada", montarConversaDetalhada(conversas[indice], mensagens, usuarios));

  res.json(novaMensagem);
});

app.patch("/api/conversas/:id/mensagens/marcar-lidas", autenticar, (req, res) => {
  const mensagens = carregarDB(ARQUIVOS_DB.mensagens);
  let atualizadas = 0;
  mensagens.forEach((m) => {
    if (m.conversaId === req.params.id && !m.lida && m.origem === "cliente") { m.lida = true; atualizadas++; }
  });
  if (atualizadas > 0) salvarDB(ARQUIVOS_DB.mensagens, mensagens);
  res.json({ mensagensAtualizadas: atualizadas });
});


// =============================================================================
// ROTAS DE TEMPLATES RÁPIDOS
// =============================================================================
const ARQUIVO_TEMPLATES = path.join(DB_PATH, 'templates.json');

const TEMPLATES_PADRAO = [
  { id: '1', ordem: 1, atalho: '/ola',       titulo: 'Saudação',             texto: 'Olá, tudo bem? Sou da equipe AVSEG. Como posso te ajudar?' },
  { id: '2', ordem: 2, atalho: '/cpf',       titulo: 'Pedir CPF ou placa',   texto: 'Me informe CPF ou placa do veículo, por favor.' },
  { id: '3', ordem: 3, atalho: '/verificar', titulo: 'Verificando',           texto: 'Vou verificar para você.' },
  { id: '4', ordem: 4, atalho: '/finalizar', titulo: 'Finalizar atendimento', texto: 'Seu atendimento foi finalizado. A AVSEG agradece!' },
  { id: '5', ordem: 5, atalho: '/atraso',    titulo: 'Pagamento em atraso',   texto: 'Olá, boa tarde! Devido ao atraso, será necessário realizar o pagamento em atraso.' },
  { id: '6', ordem: 6, atalho: '/pix',       titulo: 'Pagamento via PIX',     texto: 'Para pagar com PIX, é necessário selecionar e copiar a chave informada no boleto.' },
  { id: '7', ordem: 7, atalho: '/detalhes',  titulo: 'Pedir detalhes',        texto: 'Gostaríamos de entender melhor sua solicitação. Poderia nos passar mais detalhes?' },
  { id: '8', ordem: 8, atalho: '/setor',     titulo: 'Encaminhar setor',      texto: 'Encaminhei sua solicitação para o setor responsável. Peço que aguarde um momento.' },
];

function criarTemplatesPadraoSeNaoExistir() {
  if (fs.existsSync(ARQUIVO_TEMPLATES)) return;
  salvarDB(ARQUIVO_TEMPLATES, TEMPLATES_PADRAO);
  console.log('✅ Templates padrão criados.');
}

// Listar templates (público para atendentes)
app.get('/api/templates', autenticar, (req, res) => {
  const templates = carregarDB(ARQUIVO_TEMPLATES);
  res.json(templates.sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999)));
});

// Criar template (somente admin)
app.post('/api/templates', autenticar, (req, res) => {
  if (req.usuario.role !== 'admin') return res.status(403).json({ erro: 'Sem permissão.' });
  const { titulo, atalho, texto } = req.body;
  if (!titulo?.trim() || !atalho?.trim() || !texto?.trim()) return res.status(400).json({ erro: 'Título, atalho e texto são obrigatórios.' });

  const atalhoFinal = atalho.trim().startsWith('/') ? atalho.trim() : '/' + atalho.trim();
  const templates = carregarDB(ARQUIVO_TEMPLATES);

  if (templates.find((t) => t.atalho.toLowerCase() === atalhoFinal.toLowerCase())) {
    return res.status(400).json({ erro: 'Já existe um template com este atalho.' });
  }

  const maxOrdem = templates.reduce((max, t) => Math.max(max, t.ordem ?? 0), 0);
  const novo = { id: gerarId(), ordem: maxOrdem + 1, titulo: titulo.trim(), atalho: atalhoFinal, texto: texto.trim(), criadoEm: new Date().toISOString() };
  templates.push(novo);
  salvarDB(ARQUIVO_TEMPLATES, templates);
  res.json(novo);
});

// Editar template (somente admin)
app.patch('/api/templates/:id', autenticar, (req, res) => {
  if (req.usuario.role !== 'admin') return res.status(403).json({ erro: 'Sem permissão.' });
  const { titulo, atalho, texto } = req.body;
  const templates = carregarDB(ARQUIVO_TEMPLATES);
  const idx = templates.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ erro: 'Template não encontrado.' });

  if (titulo) templates[idx].titulo = titulo.trim();
  if (texto)  templates[idx].texto  = texto.trim();
  if (atalho) {
    const atalhoFinal = atalho.trim().startsWith('/') ? atalho.trim() : '/' + atalho.trim();
    const conflito = templates.find((t) => t.id !== req.params.id && t.atalho.toLowerCase() === atalhoFinal.toLowerCase());
    if (conflito) return res.status(400).json({ erro: 'Atalho já usado por outro template.' });
    templates[idx].atalho = atalhoFinal;
  }
  templates[idx].atualizadoEm = new Date().toISOString();
  salvarDB(ARQUIVO_TEMPLATES, templates);
  res.json(templates[idx]);
});

// Excluir template (somente admin)
app.delete('/api/templates/:id', autenticar, (req, res) => {
  if (req.usuario.role !== 'admin') return res.status(403).json({ erro: 'Sem permissão.' });
  const templates = carregarDB(ARQUIVO_TEMPLATES);
  const idx = templates.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ erro: 'Template não encontrado.' });
  templates.splice(idx, 1);
  salvarDB(ARQUIVO_TEMPLATES, templates);
  res.json({ ok: true });
});

// Reordenar templates (somente admin)
app.patch('/api/templates/reordenar', autenticar, (req, res) => {
  if (req.usuario.role !== 'admin') return res.status(403).json({ erro: 'Sem permissão.' });
  const { ordem } = req.body; // array de ids na nova ordem
  if (!Array.isArray(ordem)) return res.status(400).json({ erro: 'ordem deve ser um array de IDs.' });
  const templates = carregarDB(ARQUIVO_TEMPLATES);
  ordem.forEach((id, i) => {
    const t = templates.find((x) => x.id === id);
    if (t) t.ordem = i + 1;
  });
  salvarDB(ARQUIVO_TEMPLATES, templates);
  res.json({ ok: true });
});

// =============================================================================
// ROTAS DE ETIQUETAS
// =============================================================================
app.get("/api/etiquetas", autenticar, (req, res) => {
  res.json(carregarDB(ARQUIVOS_DB.etiquetas));
});

app.post("/api/etiquetas", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") return res.status(403).json({ erro: "Somente administradores podem criar etiquetas." });
  const { nome, cor } = req.body;
  if (!nome?.trim()) return res.status(400).json({ erro: "Nome da etiqueta é obrigatório." });

  const etiquetas = carregarDB(ARQUIVOS_DB.etiquetas);
  if (etiquetas.find((e) => e.nome.toLowerCase() === nome.trim().toLowerCase())) return res.status(400).json({ erro: "Já existe uma etiqueta com este nome." });

  const nova = { id: gerarId(), nome: nome.trim(), cor: cor || "#f5c400", criadoEm: new Date().toISOString() };
  etiquetas.push(nova);
  salvarDB(ARQUIVOS_DB.etiquetas, etiquetas);
  res.json(nova);
});

app.patch("/api/etiquetas/:id", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") return res.status(403).json({ erro: "Sem permissão." });
  const { nome, cor } = req.body;
  const etiquetas = carregarDB(ARQUIVOS_DB.etiquetas);
  const indice = etiquetas.findIndex((e) => e.id === req.params.id);
  if (indice === -1) return res.status(404).json({ erro: "Etiqueta não encontrada." });
  if (nome) etiquetas[indice].nome = nome.trim();
  if (cor)  etiquetas[indice].cor  = cor;
  salvarDB(ARQUIVOS_DB.etiquetas, etiquetas);
  res.json(etiquetas[indice]);
});

app.delete("/api/etiquetas/:id", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") return res.status(403).json({ erro: "Sem permissão." });
  const etiquetas = carregarDB(ARQUIVOS_DB.etiquetas);
  const indice = etiquetas.findIndex((e) => e.id === req.params.id);
  if (indice === -1) return res.status(404).json({ erro: "Etiqueta não encontrada." });
  etiquetas.splice(indice, 1);
  salvarDB(ARQUIVOS_DB.etiquetas, etiquetas);

  // Remove da todas as conversas
  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  let alterou = false;
  conversas.forEach((c) => {
    if (Array.isArray(c.etiquetas) && c.etiquetas.includes(req.params.id)) {
      c.etiquetas = c.etiquetas.filter((id) => id !== req.params.id);
      alterou = true;
    }
  });
  if (alterou) salvarDB(ARQUIVOS_DB.conversas, conversas);
  res.json({ ok: true });
});

// Aplicar etiqueta em conversa
app.post("/api/conversas/:id/etiquetas", autenticar, (req, res) => {
  const { etiquetaId } = req.body;
  if (!etiquetaId) return res.status(400).json({ erro: "etiquetaId é obrigatório." });

  const etiquetas = carregarDB(ARQUIVOS_DB.etiquetas);
  if (!etiquetas.find((e) => e.id === etiquetaId)) return res.status(404).json({ erro: "Etiqueta não encontrada." });

  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  const indice = conversas.findIndex((c) => c.id === req.params.id);
  if (indice === -1) return res.status(404).json({ erro: "Conversa não encontrada." });

  if (!Array.isArray(conversas[indice].etiquetas)) conversas[indice].etiquetas = [];
  if (!conversas[indice].etiquetas.includes(etiquetaId)) {
    conversas[indice].etiquetas.push(etiquetaId);
    conversas[indice].atualizadoEm = new Date().toISOString();
    salvarDB(ARQUIVOS_DB.conversas, conversas);
  }

  const mensagens = carregarDB(ARQUIVOS_DB.mensagens);
  const usuarios  = carregarDB(ARQUIVOS_DB.usuarios);
  const conversaAtualizada = montarConversaDetalhada(conversas[indice], mensagens, usuarios);
  io.emit("conversa_atualizada", conversaAtualizada);
  res.json(conversaAtualizada);
});

// Remover etiqueta de conversa
app.delete("/api/conversas/:id/etiquetas/:etiquetaId", autenticar, (req, res) => {
  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  const indice = conversas.findIndex((c) => c.id === req.params.id);
  if (indice === -1) return res.status(404).json({ erro: "Conversa não encontrada." });

  if (Array.isArray(conversas[indice].etiquetas)) {
    conversas[indice].etiquetas = conversas[indice].etiquetas.filter((id) => id !== req.params.etiquetaId);
    conversas[indice].atualizadoEm = new Date().toISOString();
    salvarDB(ARQUIVOS_DB.conversas, conversas);
  }

  const mensagens = carregarDB(ARQUIVOS_DB.mensagens);
  const usuarios  = carregarDB(ARQUIVOS_DB.usuarios);
  const conversaAtualizada = montarConversaDetalhada(conversas[indice], mensagens, usuarios);
  io.emit("conversa_atualizada", conversaAtualizada);
  res.json(conversaAtualizada);
});

// =============================================================================
// ROTAS DE CLIENTES
// =============================================================================
app.get("/api/clientes", autenticar, (req, res) => {
  res.json(carregarDB(ARQUIVOS_DB.clientes));
});

// =============================================================================
// ROTAS DE MÉTRICAS (admin)
// =============================================================================
app.get("/api/metricas", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") return res.status(403).json({ erro: "Sem permissão." });

  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);

  const inicioHoje = new Date();
  inicioHoje.setHours(0, 0, 0, 0);
  const inicioSemana = new Date(inicioHoje);
  inicioSemana.setDate(inicioSemana.getDate() - 7);

  const conversasHoje = conversas.filter((c) => new Date(c.criadoEm) >= inicioHoje).length;
  const conversasSemana = conversas.filter((c) => new Date(c.criadoEm) >= inicioSemana).length;

  const porStatus = {
    aguardando: conversas.filter((c) => c.status === "aguardando").length,
    em_atendimento: conversas.filter((c) => c.status === "em_atendimento").length,
    finalizada: conversas.filter((c) => c.status === "finalizada").length,
  };

  const porAtendente = usuarios
    .filter((u) => u.ativo !== false)
    .map((u) => ({ id: u.id, nome: u.nome, total: conversas.filter((c) => c.atendenteId === u.id).length }))
    .filter((a) => a.total > 0)
    .sort((a, b) => b.total - a.total);

  res.json({ conversasHoje, conversasSemana, porStatus, porAtendente });
});

// =============================================================================
// ROTAS DE USUÁRIOS
// =============================================================================
app.get("/api/usuarios/atendentes", autenticar, (req, res) => {
  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);
  res.json(usuarios.filter((u) => u.ativo !== false).map(({ senha, ...u }) => u));
});

app.get("/api/usuarios", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") return res.status(403).json({ erro: "Sem permissão" });
  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);
  res.json(usuarios.filter((u) => u.ativo !== false).map(({ senha, ...u }) => u));
});

app.delete("/api/usuarios/:id", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") return res.status(403).json({ erro: "Sem permissão" });
  if (req.params.id === req.usuario.id) return res.status(400).json({ erro: "Você não pode excluir seu próprio usuário." });

  const usuarios = carregarDB(ARQUIVOS_DB.usuarios);
  const indice = usuarios.findIndex((u) => u.id === req.params.id && u.ativo !== false);
  if (indice === -1) return res.status(404).json({ erro: "Usuário não encontrado" });

  const usuario = usuarios[indice];
  if (usuario.role === "admin") {
    const adminsAtivos = usuarios.filter((u) => u.role === "admin" && u.ativo !== false);
    if (adminsAtivos.length <= 1) return res.status(400).json({ erro: "Não é possível excluir o último administrador." });
  }

  usuarios[indice].ativo = false;
  usuarios[indice].excluidoEm = new Date().toISOString();
  salvarDB(ARQUIVOS_DB.usuarios, usuarios);
  res.json({ ok: true, mensagem: "Usuário excluído com sucesso." });
});

// =============================================================================
// WEBHOOK — RECEBER MENSAGENS DO WHATSAPP
// =============================================================================
app.post("/api/webhook/whatsapp", (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (INTERNAL_API_KEY && apiKey !== INTERNAL_API_KEY) return res.status(401).json({ erro: "API key inválida" });

  const { telefone, mensagem, nomeCliente, tipo, arquivoUrl, mimeType, nomeArquivo, solicitouHumano } = req.body;
  const textoMsg = String(mensagem || '').trim().toLowerCase();
  const pedidoHumano = solicitouHumano === true || textoMsg === '5';
  if (!telefone || (!mensagem && !arquivoUrl)) return res.status(400).json({ erro: "Dados incompletos" });

  const telefoneNormalizado = normalizarTelefone(telefone);
  const conversas = carregarDB(ARQUIVOS_DB.conversas);
  const clientes  = carregarDB(ARQUIVOS_DB.clientes);
  const mensagens = carregarDB(ARQUIVOS_DB.mensagens);

  let cliente = clientes.find((c) => c.telefone === telefoneNormalizado);
  if (!cliente) {
    cliente = { id: gerarId(), telefone: telefoneNormalizado, nome: nomeCliente || "Cliente", criadoEm: new Date().toISOString() };
    clientes.push(cliente);
    salvarDB(ARQUIVOS_DB.clientes, clientes);
  } else if (nomeCliente && cliente.nome !== nomeCliente) {
    cliente.nome = nomeCliente;
    salvarDB(ARQUIVOS_DB.clientes, clientes);
  }

  let conversa = conversas.find((c) => c.telefone === telefoneNormalizado && c.status !== "finalizada");
  let novaConversa = false;

  if (!conversa) {
    conversa = {
      id: gerarId(),
      telefone: telefoneNormalizado,
      clienteId: cliente.id,
      clienteNome: cliente.nome,
      status: "aguardando",
      atendenteId: null,
      etiquetas: [],
      solicitouHumano: pedidoHumano,
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    };
    conversas.push(conversa);
    novaConversa = true;
  } else {
    const indice = conversas.findIndex((c) => c.id === conversa.id);
    conversas[indice].atualizadoEm = new Date().toISOString();
    if (pedidoHumano) conversas[indice].solicitouHumano = true;
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

  if (novaConversa) io.emit("nova_conversa", conversaDetalhada);
  io.emit("nova_mensagem", { conversaId: conversa.id, mensagem: novaMensagem });
  io.emit("conversa_atualizada", conversaDetalhada);

  res.json({ ok: true, conversaId: conversa.id });
});

// =============================================================================
// WEBSOCKET
// =============================================================================
io.on("connection", (socket) => {
  console.log("✅ Cliente conectado:", socket.id);
  socket.on("entrar_conversa",  (id) => socket.join(`conversa_${id}`));
  socket.on("sair_conversa",    (id) => socket.leave(`conversa_${id}`));
  socket.on("disconnect", () => console.log("❌ Cliente desconectado:", socket.id));
});

// =============================================================================
// INICIALIZAÇÃO
// =============================================================================
criarAdminSeNaoExistir();
criarEtiquetasPadraoSeNaoExistir();
criarTemplatesPadraoSeNaoExistir();

server.listen(PORT, () => {
  console.log(`🚀 Servidor de chat rodando na porta ${PORT}`);
  console.log(`📱 Dashboard: http://localhost:${PORT}`);
  console.log(`🔑 Login padrão: admin@avseg.com / admin123`);
});