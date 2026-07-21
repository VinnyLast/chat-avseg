require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const db = require("./database/db");
const { enviarEmailRecuperacaoSenha } = require("./emailer");

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
// Quantos dias uma conversa finalizada fica na tabela ativa antes de ser
// arquivada automaticamente (ver limparConversasAntigas). Configurável via
// .env sem precisar mexer no código; 730 dias (2 anos) por padrão.
const RETENCAO_DIAS_CONVERSAS = parseInt(process.env.RETENCAO_DIAS_CONVERSAS, 10) || 730;

// =============================================================================
// PASTAS
// =============================================================================
const DB_PATH = path.join(__dirname, "database");
const ARQUIVO_HISTORICO_PATH = path.join(DB_PATH, "arquivo");
const UPLOADS_PATH = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOADS_PATH, { recursive: true });

// =============================================================================
// MIDDLEWARES
// =============================================================================
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
app.use("/uploads", express.static(UPLOADS_PATH));

// URLs limpas (sem .html) — o arquivo .html continua acessível pelo nome
// completo também, isso só evita expor a extensão na barra de endereço.
const FRONTEND_PATH = path.join(__dirname, "../frontend");
app.get("/dashboard", (req, res) => res.sendFile(path.join(FRONTEND_PATH, "dashboard.html")));
app.get("/configuracoes", (req, res) => res.sendFile(path.join(FRONTEND_PATH, "configuracoes.html")));
app.get("/resetar-senha", (req, res) => res.sendFile(path.join(FRONTEND_PATH, "resetar-senha.html")));

app.use(express.static(FRONTEND_PATH));

// =============================================================================
// UPLOAD DE ARQUIVOS
// =============================================================================
function limparNomeArquivo(nome) {
  return String(nome || "arquivo")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
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
  return mimeType ? "arquivo" : null;
}

// =============================================================================
// BANCO DE DADOS — helpers de leitura/escrita (SQLite)
// =============================================================================

// Converte uma linha de "mensagens" (booleans salvos como 0/1) pro formato
// que a API sempre devolveu.
function mapearMensagem(row) {
  return {
    id: row.id,
    conversaId: row.conversaId,
    tipo: row.tipo || "texto",
    texto: row.texto || "",
    arquivoUrl: row.arquivoUrl || null,
    mimeType: row.mimeType || null,
    nomeArquivo: row.nomeArquivo || null,
    origem: row.origem,
    usuarioId: row.usuarioId || null,
    lida: row.lida === 1 || row.lida === true,
    privado: row.privado === 1 || row.privado === true,
    whatsappMessageId: row.whatsappMessageId || null,
    respondendoA: row.respondendoA || null,
    criadoEm: row.criadoEm,
  };
}

// Ids de etiquetas aplicadas a UMA conversa (usado nas rotas de item único).
function etiquetasDeConversa(conversaId) {
  return db.prepare("SELECT etiquetaId FROM conversaEtiquetas WHERE conversaId = ?").all(conversaId).map((r) => r.etiquetaId);
}

// Todas as etiquetas de todas as conversas de uma vez, agrupadas por
// conversaId — usado na listagem, pra não fazer 1 consulta por conversa.
function mapaEtiquetasPorConversa() {
  const linhas = db.prepare("SELECT conversaId, etiquetaId FROM conversaEtiquetas").all();
  const mapa = new Map();
  linhas.forEach((l) => {
    if (!mapa.has(l.conversaId)) mapa.set(l.conversaId, []);
    mapa.get(l.conversaId).push(l.etiquetaId);
  });
  return mapa;
}

// Junta a linha da conversa (já com atendenteNome via LEFT JOIN e os campos
// de "última mensagem" denormalizados) com a lista de etiquetas — mesmo
// formato que o frontend sempre recebeu.
function mapearConversa(row, etiquetasIds) {
  return {
    id: row.id,
    telefone: row.telefone,
    clienteId: row.clienteId || null,
    clienteNome: row.clienteNome || "",
    status: row.status,
    atendenteId: row.atendenteId || null,
    atendenteNome: row.atendenteNome || null,
    ultimaMensagem: row.ultimaMensagem || "",
    ultimaMensagemTipo: row.ultimaMensagemTipo || "texto",
    ultimaMensagemNomeArquivo: row.ultimaMensagemNomeArquivo || "",
    ultimaMensagemData: row.ultimaMensagemData || row.atualizadoEm,
    mensagensNaoLidas: row.mensagensNaoLidas || 0,
    totalMensagens: row.totalMensagens || 0,
    etiquetas: etiquetasIds || [],
    solicitouHumano: row.solicitouHumano === 1 || row.solicitouHumano === true,
    criadoEm: row.criadoEm,
    atualizadoEm: row.atualizadoEm,
    finalizadaEm: row.finalizadaEm || null,
    motivoFinalizacaoId: row.motivoFinalizacaoId || null,
    motivoFinalizacaoNome: row.motivoFinalizacaoNome || null,
  };
}

function buscarConversaComAtendente(conversaId) {
  return db.prepare(`
    SELECT c.*, u.nome AS atendenteNome, m.nome AS motivoFinalizacaoNome
    FROM conversas c
    LEFT JOIN usuarios u ON u.id = c.atendenteId
    LEFT JOIN motivos m ON m.id = c.motivoFinalizacaoId
    WHERE c.id = ?
  `).get(conversaId);
}

function conversaDetalhadaPorId(conversaId) {
  const row = buscarConversaComAtendente(conversaId);
  if (!row) return null;
  return mapearConversa(row, etiquetasDeConversa(conversaId));
}

// Insere uma mensagem E atualiza os campos denormalizados da conversa
// (última mensagem, total, não lidas) numa única chamada — é isso que evita
// ter que recontar todas as mensagens da conversa a cada listagem.
function inserirMensagemEAtualizarConversa(msg) {
  const linha = {
    id: msg.id,
    conversaId: msg.conversaId,
    tipo: msg.tipo || "texto",
    texto: msg.texto || "",
    arquivoUrl: msg.arquivoUrl || null,
    mimeType: msg.mimeType || null,
    nomeArquivo: msg.nomeArquivo || null,
    origem: msg.origem,
    usuarioId: msg.usuarioId || null,
    lida: msg.lida ? 1 : 0,
    privado: msg.privado ? 1 : 0,
    whatsappMessageId: msg.whatsappMessageId || null,
    respondendoA: msg.respondendoA || null,
    criadoEm: msg.criadoEm,
  };

  db.prepare(`
    INSERT INTO mensagens (id, conversaId, tipo, texto, arquivoUrl, mimeType, nomeArquivo, origem, usuarioId, lida, privado, whatsappMessageId, respondendoA, criadoEm)
    VALUES (@id, @conversaId, @tipo, @texto, @arquivoUrl, @mimeType, @nomeArquivo, @origem, @usuarioId, @lida, @privado, @whatsappMessageId, @respondendoA, @criadoEm)
  `).run(linha);

  const incrementoNaoLida = linha.origem === "cliente" && linha.lida === 0 ? 1 : 0;
  db.prepare(`
    UPDATE conversas SET
      ultimaMensagem = ?, ultimaMensagemTipo = ?, ultimaMensagemNomeArquivo = ?, ultimaMensagemData = ?,
      totalMensagens = totalMensagens + 1,
      mensagensNaoLidas = mensagensNaoLidas + ?,
      atualizadoEm = ?
    WHERE id = ?
  `).run(linha.texto, linha.tipo, linha.nomeArquivo || "", linha.criadoEm, incrementoNaoLida, linha.criadoEm, linha.conversaId);

  return mapearMensagem(linha);
}

// =============================================================================
// LIMPEZA AUTOMÁTICA — arquiva (não apaga de verdade) conversas finalizadas
// mais antigas que a retenção configurada, mantendo a tabela ativa enxuta.
// Conversas aguardando/em atendimento nunca são tocadas, não importa a idade.
// =============================================================================
function limparConversasAntigas() {
  try {
    const corte = new Date();
    corte.setDate(corte.getDate() - RETENCAO_DIAS_CONVERSAS);
    const corteISO = corte.toISOString();

    const antigas = db.prepare(`
      SELECT * FROM conversas WHERE status = 'finalizada' AND finalizadaEm IS NOT NULL AND finalizadaEm < ?
    `).all(corteISO);

    if (antigas.length === 0) {
      console.log(`🧹 Limpeza automática: nada a arquivar (retenção de ${RETENCAO_DIAS_CONVERSAS} dias).`);
      return;
    }

    const ids = antigas.map((c) => c.id);
    const placeholders = ids.map(() => "?").join(",");
    const mensagensAntigas = db.prepare(`SELECT * FROM mensagens WHERE conversaId IN (${placeholders})`).all(...ids);
    const etiquetasAntigas = db.prepare(`SELECT * FROM conversaEtiquetas WHERE conversaId IN (${placeholders})`).all(...ids);

    fs.mkdirSync(ARQUIVO_HISTORICO_PATH, { recursive: true });
    const caminhoArquivo = path.join(ARQUIVO_HISTORICO_PATH, `arquivo-${new Date().toISOString().slice(0, 10)}-${gerarId()}.json`);
    fs.writeFileSync(caminhoArquivo, JSON.stringify({ conversas: antigas, mensagens: mensagensAntigas, conversaEtiquetas: etiquetasAntigas }, null, 2));

    const remover = db.transaction(() => {
      db.prepare(`DELETE FROM mensagens WHERE conversaId IN (${placeholders})`).run(...ids);
      db.prepare(`DELETE FROM conversaEtiquetas WHERE conversaId IN (${placeholders})`).run(...ids);
      db.prepare(`DELETE FROM conversas WHERE id IN (${placeholders})`).run(...ids);
    });
    remover();
    db.exec("VACUUM");

    console.log(`🧹 Limpeza automática: ${antigas.length} conversa(s) e ${mensagensAntigas.length} mensagem(ns) arquivadas em ${caminhoArquivo}.`);
  } catch (erro) {
    console.error("Erro na limpeza automática:", erro.message);
  }
}

// =============================================================================
// INICIALIZAÇÃO DE DADOS PADRÃO
// =============================================================================
function criarAdminSeNaoExistir() {
  const total = db.prepare("SELECT COUNT(*) n FROM usuarios").get().n;
  if (total === 0) {
    const senhaHash = bcrypt.hashSync("admin123", 10);
    db.prepare("INSERT INTO usuarios (id, nome, email, senha, role, ativo, criadoEm) VALUES (?, ?, ?, ?, 'admin', 1, ?)")
      .run(gerarId(), "Administrador", "admin@avseg.com", senhaHash, new Date().toISOString());
    console.log("✅ Usuário admin criado: admin@avseg.com / admin123");
  }
}

function criarEtiquetasPadraoSeNaoExistir() {
  const total = db.prepare("SELECT COUNT(*) n FROM etiquetas").get().n;
  if (total > 0) return;
  const etiquetasPadrao = [
    { nome: "Pagamento", cor: "#f5c400" },
    { nome: "Urgente", cor: "#ef4444" },
    { nome: "Sinistro", cor: "#3b82f6" },
    { nome: "Vistoria", cor: "#22c55e" },
    { nome: "Cotação", cor: "#a855f7" },
  ];
  const inserir = db.prepare("INSERT INTO etiquetas (id, nome, cor, criadoEm) VALUES (?, ?, ?, ?)");
  etiquetasPadrao.forEach((e) => inserir.run(gerarId(), e.nome, e.cor, new Date().toISOString()));
  console.log("✅ Etiquetas padrão criadas.");
}

function criarMotivosPadraoSeNaoExistir() {
  const total = db.prepare("SELECT COUNT(*) n FROM motivos").get().n;
  if (total > 0) return;
  const motivosPadrao = [
    "Dúvida resolvida",
    "Sem resposta do associado",
    "Solicitação encaminhada a outro setor",
    "Duplicidade",
  ];
  const inserir = db.prepare("INSERT INTO motivos (id, nome, criadoEm) VALUES (?, ?, ?)");
  motivosPadrao.forEach((nome) => inserir.run(gerarId(), nome, new Date().toISOString()));
  console.log("✅ Motivos padrão criados.");
}

const TEMPLATES_PADRAO = [
  { id: '1', ordem: 1, atalho: '/ola',       titulo: 'Saudação',             texto: 'Olá, tudo bem? Sou da equipe AVSEG. Como posso te ajudar?' },
  { id: '2', ordem: 2, atalho: '/cpf',       titulo: 'Pedir CPF ou placa',   texto: 'Me informe CPF ou placa do veículo, por favor.' },
  { id: '3', ordem: 3, atalho: '/verificar', titulo: 'Verificando',           texto: 'Vou verificar para você.' },
  { id: '4', ordem: 4, atalho: '/finalizar', titulo: 'Finalizar atendimento', texto: 'Seu atendimento foi finalizado. A AVSEG agradece!' },
  { id: '5', ordem: 5, atalho: '/atraso',    titulo: 'Pagamento em atraso',   texto: 'Olá, boa tarde! Devido ao atraso, será necessário realizar o pagamento em atraso.' },
  { id: '6', ordem: 6, atalho: '/pix',       titulo: 'Pagamento via PIX',     texto: 'Para pagar com PIX, é necessário selecionar e copiar a chave informada na participação mensal.' },
  { id: '7', ordem: 7, atalho: '/detalhes',  titulo: 'Pedir detalhes',        texto: 'Gostaríamos de entender melhor sua solicitação. Poderia nos passar mais detalhes?' },
  { id: '8', ordem: 8, atalho: '/setor',     titulo: 'Encaminhar setor',      texto: 'Encaminhei sua solicitação para o setor responsável. Peço que aguarde um momento.' },
];

function criarTemplatesPadraoSeNaoExistir() {
  const total = db.prepare("SELECT COUNT(*) n FROM templates").get().n;
  if (total > 0) return;
  const inserir = db.prepare("INSERT INTO templates (id, ordem, atalho, titulo, texto, criadoEm) VALUES (?, ?, ?, ?, ?, ?)");
  TEMPLATES_PADRAO.forEach((t) => inserir.run(t.id, t.ordem, t.atalho, t.titulo, t.texto, new Date().toISOString()));
  console.log("✅ Templates padrão criados.");
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

  const usuario = db.prepare("SELECT * FROM usuarios WHERE email = ? AND ativo = 1").get(email);
  if (!usuario) return res.status(401).json({ erro: "Credenciais inválidas" });

  if (!bcrypt.compareSync(senha, usuario.senha)) return res.status(401).json({ erro: "Credenciais inválidas" });

  const token = jwt.sign({ id: usuario.id, email: usuario.email, role: usuario.role }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role } });
});

app.post("/api/auth/registrar", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") return res.status(403).json({ erro: "Sem permissão" });
  const { nome, email, senha, role } = req.body;
  if (!nome || !email || !senha) return res.status(400).json({ erro: "Dados incompletos" });
  if (senha.length < 6) return res.status(400).json({ erro: "A senha precisa ter pelo menos 6 caracteres" });

  const existente = db.prepare("SELECT id FROM usuarios WHERE email = ? AND ativo = 1").get(email);
  if (existente) return res.status(400).json({ erro: "Email já cadastrado" });

  const novoUsuario = { id: gerarId(), nome, email, senha: bcrypt.hashSync(senha, 10), role: role || "atendente", criadoEm: new Date().toISOString() };
  db.prepare("INSERT INTO usuarios (id, nome, email, senha, role, ativo, criadoEm) VALUES (@id, @nome, @email, @senha, @role, 1, @criadoEm)").run(novoUsuario);
  res.json({ id: novoUsuario.id, nome: novoUsuario.nome, email: novoUsuario.email, role: novoUsuario.role });
});

app.get("/api/auth/verificar", autenticar, (req, res) => {
  const usuario = db.prepare("SELECT * FROM usuarios WHERE id = ? AND ativo = 1").get(req.usuario.id);
  if (!usuario) return res.status(401).json({ erro: "Usuário não encontrado" });
  res.json({ usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role } });
});

// Solicitar recuperação de senha — sempre responde com a mesma mensagem
// genérica (exista ou não o email), pra não revelar quais emails têm conta.
app.post("/api/auth/esqueci-senha", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ erro: "Informe o email." });

  const mensagemGenerica = "Se esse email estiver cadastrado, enviamos um link de redefinição de senha.";

  const usuario = db.prepare("SELECT * FROM usuarios WHERE email = ? AND ativo = 1").get(email.trim());
  if (usuario) {
    const token = crypto.randomBytes(32).toString("hex");
    const expira = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h
    db.prepare("UPDATE usuarios SET resetToken = ?, resetTokenExpira = ? WHERE id = ?").run(token, expira, usuario.id);

    const link = `${PUBLIC_BASE_URL || baseUrlReq(req)}/resetar-senha?token=${token}`;
    await enviarEmailRecuperacaoSenha(usuario.email, usuario.nome, link);
  }

  res.json({ ok: true, mensagem: mensagemGenerica });
});

// Redefinir senha usando o token recebido por email
app.post("/api/auth/resetar-senha", (req, res) => {
  const { token, novaSenha } = req.body;
  if (!token || !novaSenha) return res.status(400).json({ erro: "Dados incompletos." });
  if (novaSenha.length < 6) return res.status(400).json({ erro: "A senha precisa ter pelo menos 6 caracteres." });

  const usuario = db.prepare("SELECT * FROM usuarios WHERE resetToken = ? AND ativo = 1").get(token);
  if (!usuario || !usuario.resetTokenExpira || new Date(usuario.resetTokenExpira) < new Date()) {
    return res.status(400).json({ erro: "Link inválido ou expirado. Solicite a recuperação novamente." });
  }

  const senhaHash = bcrypt.hashSync(novaSenha, 10);
  db.prepare("UPDATE usuarios SET senha = ?, resetToken = NULL, resetTokenExpira = NULL WHERE id = ?").run(senhaHash, usuario.id);
  res.json({ ok: true, mensagem: "Senha redefinida com sucesso. Você já pode fazer login." });
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
  const linhas = db.prepare(`
    SELECT c.*, u.nome AS atendenteNome, m.nome AS motivoFinalizacaoNome
    FROM conversas c
    LEFT JOIN usuarios u ON u.id = c.atendenteId
    LEFT JOIN motivos m ON m.id = c.motivoFinalizacaoId
    ORDER BY c.ultimaMensagemData DESC
  `).all();

  const mapaEtiquetas = mapaEtiquetasPorConversa();
  res.json(linhas.map((row) => mapearConversa(row, mapaEtiquetas.get(row.id) || [])));
});

app.get("/api/conversas/:id", autenticar, (req, res) => {
  const row = buscarConversaComAtendente(req.params.id);
  if (!row) return res.status(404).json({ erro: "Conversa não encontrada" });
  res.json(mapearConversa(row, etiquetasDeConversa(row.id)));
});

app.patch("/api/conversas/:id", autenticar, async (req, res) => {
  const { status, atendenteId, assumir, motivoFinalizacaoId } = req.body;
  const conversa = db.prepare("SELECT * FROM conversas WHERE id = ?").get(req.params.id);
  if (!conversa) return res.status(404).json({ erro: "Conversa não encontrada" });

  let novoAtendenteId = conversa.atendenteId;
  let novoStatus = conversa.status;
  let novaFinalizadaEm = conversa.finalizadaEm;
  let novoMotivoFinalizacaoId = conversa.motivoFinalizacaoId;
  let novoSolicitouHumano = conversa.solicitouHumano;

  if (assumir) {
    if (conversa.atendenteId && conversa.atendenteId !== req.usuario.id && conversa.status === "em_atendimento") {
      const atendenteAtual = db.prepare("SELECT nome FROM usuarios WHERE id = ?").get(conversa.atendenteId);
      return res.status(409).json({ erro: `Essa conversa já está com ${atendenteAtual?.nome || "outro atendente"}.` });
    }
    novoAtendenteId = req.usuario.id;
    novoStatus = "em_atendimento";
  }

  if (status) {
    novoStatus = status;
    if (status === "finalizada") {
      novaFinalizadaEm = new Date().toISOString();
      novoMotivoFinalizacaoId = motivoFinalizacaoId || null;
      novoSolicitouHumano = 0;
    }
    if (status === "aguardando" || status === "em_atendimento") {
      novaFinalizadaEm = null;
      novoMotivoFinalizacaoId = null;
    }
  }

  if (atendenteId !== undefined) novoAtendenteId = atendenteId;
  const atualizadoEm = new Date().toISOString();

  db.prepare("UPDATE conversas SET status = ?, atendenteId = ?, finalizadaEm = ?, motivoFinalizacaoId = ?, solicitouHumano = ?, atualizadoEm = ? WHERE id = ?")
    .run(novoStatus, novoAtendenteId, novaFinalizadaEm, novoMotivoFinalizacaoId, novoSolicitouHumano, atualizadoEm, conversa.id);

  const conversaAtualizada = conversaDetalhadaPorId(conversa.id);
  io.emit("conversa_atualizada", conversaAtualizada);

  if (status === "finalizada") {
    try {
      const axios = require("axios");
      await axios.post(`${WHATSAPP_API_URL}/chat/finalizar`, {
        telefone: conversa.telefone,
        conversaId: conversa.id,
        mensagem: "Sua conversa com a equipe AVSEG foi finalizada. Se precisar de algo mais, é só nos chamar novamente! 😊",
      }, { headers: { "x-api-key": INTERNAL_API_KEY } });
    } catch (_) {}
  }

  res.json(conversaAtualizada);
});

app.patch("/api/conversas/:id/transferir", autenticar, (req, res) => {
  const { atendenteId } = req.body;
  if (!atendenteId) return res.status(400).json({ erro: "Informe o atendente de destino." });
  if (atendenteId === req.usuario.id) return res.status(400).json({ erro: "Você não pode transferir para você mesmo." });

  const conversa = db.prepare("SELECT * FROM conversas WHERE id = ?").get(req.params.id);
  if (!conversa) return res.status(404).json({ erro: "Conversa não encontrada" });
  if (conversa.status === "finalizada") return res.status(400).json({ erro: "Reabra a conversa antes de transferir." });

  const usuarioLogado = db.prepare("SELECT * FROM usuarios WHERE id = ? AND ativo = 1").get(req.usuario.id);
  const destino = db.prepare("SELECT * FROM usuarios WHERE id = ? AND ativo = 1").get(atendenteId);
  if (!destino) return res.status(404).json({ erro: "Atendente de destino não encontrado." });

  const podeTransferir = usuarioLogado?.role === "admin" || !conversa.atendenteId || conversa.atendenteId === req.usuario.id;
  if (!podeTransferir) {
    const atual = db.prepare("SELECT nome FROM usuarios WHERE id = ?").get(conversa.atendenteId);
    return res.status(403).json({ erro: `Somente o admin ou ${atual?.nome || "o responsável"} pode transferir.` });
  }

  const atendenteAnterior = conversa.atendenteId ? db.prepare("SELECT nome FROM usuarios WHERE id = ?").get(conversa.atendenteId) : null;
  const agora = new Date().toISOString();
  const mensagemSistema = {
    id: gerarId(),
    conversaId: conversa.id,
    tipo: "sistema",
    texto: `Conversa transferida ${atendenteAnterior?.nome ? `de ${atendenteAnterior.nome} ` : ""}para ${destino.nome}.`,
    origem: "sistema",
    usuarioId: req.usuario.id,
    lida: true,
    criadoEm: agora,
  };

  let mensagemInserida;
  const transacao = db.transaction(() => {
    db.prepare("UPDATE conversas SET atendenteId = ?, status = 'em_atendimento', finalizadaEm = NULL, atualizadoEm = ? WHERE id = ?")
      .run(destino.id, agora, conversa.id);
    mensagemInserida = inserirMensagemEAtualizarConversa(mensagemSistema);
  });
  transacao();

  const conversaAtualizada = conversaDetalhadaPorId(conversa.id);
  io.emit("nova_mensagem", { conversaId: conversa.id, mensagem: mensagemInserida });
  io.emit("conversa_atualizada", conversaAtualizada);

  res.json(conversaAtualizada);
});

// Ativar/desativar flag de solicitação de humano
app.patch('/api/conversas/:id/humano', autenticar, (req, res) => {
  const { ativo } = req.body;
  const conversa = db.prepare("SELECT id FROM conversas WHERE id = ?").get(req.params.id);
  if (!conversa) return res.status(404).json({ erro: 'Conversa não encontrada.' });

  db.prepare("UPDATE conversas SET solicitouHumano = ?, atualizadoEm = ? WHERE id = ?")
    .run(ativo !== false ? 1 : 0, new Date().toISOString(), conversa.id);

  const conversaAtualizada = conversaDetalhadaPorId(conversa.id);
  io.emit('conversa_atualizada', conversaAtualizada);
  res.json(conversaAtualizada);
});

// Exclui uma conversa e todo o seu histórico (irreversível) — somente admin
app.delete("/api/conversas/:id", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") return res.status(403).json({ erro: "Somente administradores podem excluir conversas." });

  const conversa = db.prepare("SELECT id FROM conversas WHERE id = ?").get(req.params.id);
  if (!conversa) return res.status(404).json({ erro: "Conversa não encontrada" });

  const transacao = db.transaction(() => {
    db.prepare("DELETE FROM mensagens WHERE conversaId = ?").run(conversa.id);
    db.prepare("DELETE FROM conversaEtiquetas WHERE conversaId = ?").run(conversa.id);
    db.prepare("DELETE FROM conversas WHERE id = ?").run(conversa.id);
  });
  transacao();

  io.emit("conversa_excluida", { conversaId: conversa.id });
  res.json({ ok: true });
});

// =============================================================================
// ROTAS DE MENSAGENS
// =============================================================================
app.get("/api/conversas/:id/mensagens", autenticar, (req, res) => {
  const { limite, offset } = req.query;

  if (!limite) {
    const todas = db.prepare("SELECT * FROM mensagens WHERE conversaId = ? ORDER BY criadoEm ASC").all(req.params.id);
    return res.json(todas.map(mapearMensagem));
  }

  const lim = Math.max(1, parseInt(limite, 10) || 50);
  const off = Math.max(0, parseInt(offset, 10) || 0);
  const total = db.prepare("SELECT COUNT(*) n FROM mensagens WHERE conversaId = ?").get(req.params.id).n;
  const fim = total - off;
  const inicio = Math.max(0, fim - lim);
  const qtd = fim - inicio;

  const pagina = qtd > 0
    ? db.prepare("SELECT * FROM mensagens WHERE conversaId = ? ORDER BY criadoEm ASC LIMIT ? OFFSET ?").all(req.params.id, qtd, inicio).map(mapearMensagem)
    : [];

  res.json({ mensagens: pagina, total, temMais: inicio > 0 });
});

// Adicionar nota interna (visível apenas para a equipe, não enviada ao WhatsApp)
app.post("/api/conversas/:id/notas", autenticar, (req, res) => {
  const { texto } = req.body;
  if (!texto?.trim()) return res.status(400).json({ erro: "Texto da nota é obrigatório." });

  const conversa = db.prepare("SELECT id FROM conversas WHERE id = ?").get(req.params.id);
  if (!conversa) return res.status(404).json({ erro: "Conversa não encontrada." });

  const novaNota = inserirMensagemEAtualizarConversa({
    id: gerarId(),
    conversaId: conversa.id,
    tipo: "nota",
    texto: texto.trim(),
    origem: "sistema",
    usuarioId: req.usuario.id,
    privado: true,
    lida: true,
    criadoEm: new Date().toISOString(),
  });

  io.emit("nova_mensagem", { conversaId: conversa.id, mensagem: novaNota });
  res.json(novaNota);
});

app.post("/api/conversas/:id/mensagens", autenticar, async (req, res) => {
  const { texto, tipo, arquivoUrl, mimeType, nomeArquivo, respondendoA } = req.body;
  if (!texto && !arquivoUrl) return res.status(400).json({ erro: "Texto ou arquivo é obrigatório" });

  const conversa = db.prepare("SELECT * FROM conversas WHERE id = ?").get(req.params.id);
  if (!conversa) return res.status(404).json({ erro: "Conversa não encontrada" });
  if (conversa.status === "finalizada") return res.status(400).json({ erro: "Conversa finalizada. Reabra antes de responder." });

  // Se está respondendo a uma mensagem específica, busca o wamid dela pra
  // pedir ao bot que mande como resposta citada de verdade no WhatsApp.
  let wamidRespondido = null;
  if (respondendoA) {
    const original = db.prepare("SELECT whatsappMessageId FROM mensagens WHERE id = ? AND conversaId = ?").get(respondendoA, conversa.id);
    wamidRespondido = original?.whatsappMessageId || null;
  }

  let novaMensagem = inserirMensagemEAtualizarConversa({
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
    respondendoA: respondendoA || null,
    criadoEm: new Date().toISOString(),
  });

  const novoAtendenteId = conversa.atendenteId || req.usuario.id;
  const novoStatus = conversa.status === "aguardando" ? "em_atendimento" : conversa.status;
  db.prepare("UPDATE conversas SET atendenteId = ?, status = ? WHERE id = ?").run(novoAtendenteId, novoStatus, conversa.id);

  try {
    const axios = require("axios");
    const respostaBot = await axios.post(`${WHATSAPP_API_URL}/enviar-mensagem`, {
      telefone: conversa.telefone,
      texto: texto || "",
      tipo: novaMensagem.tipo,
      arquivoUrl: novaMensagem.arquivoUrl,
      mimeType: novaMensagem.mimeType,
      nomeArquivo: novaMensagem.nomeArquivo,
      responderAoWhatsappId: wamidRespondido || undefined,
    }, { headers: { "x-api-key": INTERNAL_API_KEY } });

    const wamidNovo = respostaBot.data?.whatsappMessageId;
    if (wamidNovo) {
      db.prepare("UPDATE mensagens SET whatsappMessageId = ? WHERE id = ?").run(wamidNovo, novaMensagem.id);
      novaMensagem = { ...novaMensagem, whatsappMessageId: wamidNovo };
    }
  } catch (_) {}

  io.emit("nova_mensagem", { conversaId: conversa.id, mensagem: novaMensagem });
  io.emit("conversa_atualizada", conversaDetalhadaPorId(conversa.id));

  res.json(novaMensagem);
});

app.patch("/api/conversas/:id/mensagens/marcar-lidas", autenticar, (req, res) => {
  const resultado = db.prepare("UPDATE mensagens SET lida = 1 WHERE conversaId = ? AND lida = 0 AND origem = 'cliente'").run(req.params.id);
  if (resultado.changes > 0) {
    db.prepare("UPDATE conversas SET mensagensNaoLidas = mensagensNaoLidas - ? WHERE id = ?").run(resultado.changes, req.params.id);
  }
  res.json({ mensagensAtualizadas: resultado.changes });
});

// =============================================================================
// ROTAS DE TEMPLATES RÁPIDOS
// =============================================================================

// Listar templates (público para atendentes)
app.get('/api/templates', autenticar, (req, res) => {
  res.json(db.prepare("SELECT * FROM templates ORDER BY ordem ASC").all());
});

// Criar template (somente admin)
app.post('/api/templates', autenticar, (req, res) => {
  if (req.usuario.role !== 'admin') return res.status(403).json({ erro: 'Sem permissão.' });
  const { titulo, atalho, texto } = req.body;
  if (!titulo?.trim() || !atalho?.trim() || !texto?.trim()) return res.status(400).json({ erro: 'Título, atalho e texto são obrigatórios.' });

  const atalhoFinal = atalho.trim().startsWith('/') ? atalho.trim() : '/' + atalho.trim();
  const conflito = db.prepare("SELECT id FROM templates WHERE LOWER(atalho) = LOWER(?)").get(atalhoFinal);
  if (conflito) return res.status(400).json({ erro: 'Já existe um template com este atalho.' });

  const maxOrdem = db.prepare("SELECT MAX(ordem) m FROM templates").get().m || 0;
  const novo = { id: gerarId(), ordem: maxOrdem + 1, titulo: titulo.trim(), atalho: atalhoFinal, texto: texto.trim(), criadoEm: new Date().toISOString() };
  db.prepare("INSERT INTO templates (id, ordem, titulo, atalho, texto, criadoEm) VALUES (@id, @ordem, @titulo, @atalho, @texto, @criadoEm)").run(novo);
  res.json(novo);
});

// Editar template (somente admin)
app.patch('/api/templates/:id', autenticar, (req, res) => {
  if (req.usuario.role !== 'admin') return res.status(403).json({ erro: 'Sem permissão.' });
  const { titulo, atalho, texto } = req.body;
  const existente = db.prepare("SELECT * FROM templates WHERE id = ?").get(req.params.id);
  if (!existente) return res.status(404).json({ erro: 'Template não encontrado.' });

  const novoTitulo = titulo ? titulo.trim() : existente.titulo;
  const novoTexto = texto ? texto.trim() : existente.texto;
  let novoAtalho = existente.atalho;
  if (atalho) {
    const atalhoFinal = atalho.trim().startsWith('/') ? atalho.trim() : '/' + atalho.trim();
    const conflito = db.prepare("SELECT id FROM templates WHERE id != ? AND LOWER(atalho) = LOWER(?)").get(req.params.id, atalhoFinal);
    if (conflito) return res.status(400).json({ erro: 'Atalho já usado por outro template.' });
    novoAtalho = atalhoFinal;
  }

  db.prepare("UPDATE templates SET titulo = ?, texto = ?, atalho = ?, atualizadoEm = ? WHERE id = ?")
    .run(novoTitulo, novoTexto, novoAtalho, new Date().toISOString(), req.params.id);
  res.json(db.prepare("SELECT * FROM templates WHERE id = ?").get(req.params.id));
});

// Excluir template (somente admin)
app.delete('/api/templates/:id', autenticar, (req, res) => {
  if (req.usuario.role !== 'admin') return res.status(403).json({ erro: 'Sem permissão.' });
  const resultado = db.prepare("DELETE FROM templates WHERE id = ?").run(req.params.id);
  if (resultado.changes === 0) return res.status(404).json({ erro: 'Template não encontrado.' });
  res.json({ ok: true });
});

// Reordenar templates (somente admin)
app.patch('/api/templates/reordenar', autenticar, (req, res) => {
  if (req.usuario.role !== 'admin') return res.status(403).json({ erro: 'Sem permissão.' });
  const { ordem } = req.body; // array de ids na nova ordem
  if (!Array.isArray(ordem)) return res.status(400).json({ erro: 'ordem deve ser um array de IDs.' });

  const atualizar = db.prepare("UPDATE templates SET ordem = ? WHERE id = ?");
  const transacao = db.transaction(() => { ordem.forEach((id, i) => atualizar.run(i + 1, id)); });
  transacao();
  res.json({ ok: true });
});

// =============================================================================
// ROTAS DE ETIQUETAS
// =============================================================================
app.get("/api/etiquetas", autenticar, (req, res) => {
  res.json(db.prepare("SELECT * FROM etiquetas").all());
});

app.post("/api/etiquetas", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") return res.status(403).json({ erro: "Somente administradores podem criar etiquetas." });
  const { nome, cor } = req.body;
  if (!nome?.trim()) return res.status(400).json({ erro: "Nome da etiqueta é obrigatório." });

  const conflito = db.prepare("SELECT id FROM etiquetas WHERE LOWER(nome) = LOWER(?)").get(nome.trim());
  if (conflito) return res.status(400).json({ erro: "Já existe uma etiqueta com este nome." });

  const nova = { id: gerarId(), nome: nome.trim(), cor: cor || "#f5c400", criadoEm: new Date().toISOString() };
  db.prepare("INSERT INTO etiquetas (id, nome, cor, criadoEm) VALUES (@id, @nome, @cor, @criadoEm)").run(nova);
  res.json(nova);
});

app.patch("/api/etiquetas/:id", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") return res.status(403).json({ erro: "Sem permissão." });
  const { nome, cor } = req.body;
  const existente = db.prepare("SELECT * FROM etiquetas WHERE id = ?").get(req.params.id);
  if (!existente) return res.status(404).json({ erro: "Etiqueta não encontrada." });

  db.prepare("UPDATE etiquetas SET nome = ?, cor = ? WHERE id = ?")
    .run(nome ? nome.trim() : existente.nome, cor || existente.cor, req.params.id);
  res.json(db.prepare("SELECT * FROM etiquetas WHERE id = ?").get(req.params.id));
});

app.delete("/api/etiquetas/:id", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") return res.status(403).json({ erro: "Sem permissão." });
  const resultado = db.prepare("DELETE FROM etiquetas WHERE id = ?").run(req.params.id);
  if (resultado.changes === 0) return res.status(404).json({ erro: "Etiqueta não encontrada." });

  // Remove de todas as conversas
  db.prepare("DELETE FROM conversaEtiquetas WHERE etiquetaId = ?").run(req.params.id);
  res.json({ ok: true });
});

// Aplicar etiqueta em conversa
app.post("/api/conversas/:id/etiquetas", autenticar, (req, res) => {
  const { etiquetaId } = req.body;
  if (!etiquetaId) return res.status(400).json({ erro: "etiquetaId é obrigatório." });

  const etiqueta = db.prepare("SELECT id FROM etiquetas WHERE id = ?").get(etiquetaId);
  if (!etiqueta) return res.status(404).json({ erro: "Etiqueta não encontrada." });

  const conversa = db.prepare("SELECT id FROM conversas WHERE id = ?").get(req.params.id);
  if (!conversa) return res.status(404).json({ erro: "Conversa não encontrada." });

  db.prepare("INSERT OR IGNORE INTO conversaEtiquetas (conversaId, etiquetaId) VALUES (?, ?)").run(conversa.id, etiquetaId);
  db.prepare("UPDATE conversas SET atualizadoEm = ? WHERE id = ?").run(new Date().toISOString(), conversa.id);

  const conversaAtualizada = conversaDetalhadaPorId(conversa.id);
  io.emit("conversa_atualizada", conversaAtualizada);
  res.json(conversaAtualizada);
});

// Remover etiqueta de conversa
app.delete("/api/conversas/:id/etiquetas/:etiquetaId", autenticar, (req, res) => {
  const conversa = db.prepare("SELECT id FROM conversas WHERE id = ?").get(req.params.id);
  if (!conversa) return res.status(404).json({ erro: "Conversa não encontrada." });

  db.prepare("DELETE FROM conversaEtiquetas WHERE conversaId = ? AND etiquetaId = ?").run(conversa.id, req.params.etiquetaId);
  db.prepare("UPDATE conversas SET atualizadoEm = ? WHERE id = ?").run(new Date().toISOString(), conversa.id);

  const conversaAtualizada = conversaDetalhadaPorId(conversa.id);
  io.emit("conversa_atualizada", conversaAtualizada);
  res.json(conversaAtualizada);
});

// =============================================================================
// ROTAS DE MOTIVOS DE FINALIZAÇÃO
// =============================================================================
app.get("/api/motivos", autenticar, (req, res) => {
  res.json(db.prepare("SELECT * FROM motivos ORDER BY nome").all());
});

app.post("/api/motivos", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") return res.status(403).json({ erro: "Somente administradores podem criar motivos." });
  const { nome } = req.body;
  if (!nome?.trim()) return res.status(400).json({ erro: "Nome do motivo é obrigatório." });

  const conflito = db.prepare("SELECT id FROM motivos WHERE LOWER(nome) = LOWER(?)").get(nome.trim());
  if (conflito) return res.status(400).json({ erro: "Já existe um motivo com este nome." });

  const novo = { id: gerarId(), nome: nome.trim(), criadoEm: new Date().toISOString() };
  db.prepare("INSERT INTO motivos (id, nome, criadoEm) VALUES (@id, @nome, @criadoEm)").run(novo);
  res.json(novo);
});

app.delete("/api/motivos/:id", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") return res.status(403).json({ erro: "Sem permissão." });
  const resultado = db.prepare("DELETE FROM motivos WHERE id = ?").run(req.params.id);
  if (resultado.changes === 0) return res.status(404).json({ erro: "Motivo não encontrado." });

  // Conversas que já usaram esse motivo mantêm o histórico, só perdem a referência
  db.prepare("UPDATE conversas SET motivoFinalizacaoId = NULL WHERE motivoFinalizacaoId = ?").run(req.params.id);
  res.json({ ok: true });
});

// =============================================================================
// ROTAS DE CLIENTES
// =============================================================================
app.get("/api/clientes", autenticar, (req, res) => {
  res.json(db.prepare("SELECT * FROM clientes").all());
});

// =============================================================================
// ROTAS DE MÉTRICAS (admin)
// =============================================================================
app.get("/api/metricas", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") return res.status(403).json({ erro: "Sem permissão." });

  const inicioHoje = new Date();
  inicioHoje.setHours(0, 0, 0, 0);
  const inicioSemana = new Date(inicioHoje);
  inicioSemana.setDate(inicioSemana.getDate() - 7);

  const conversasHoje = db.prepare("SELECT COUNT(*) n FROM conversas WHERE criadoEm >= ?").get(inicioHoje.toISOString()).n;
  const conversasSemana = db.prepare("SELECT COUNT(*) n FROM conversas WHERE criadoEm >= ?").get(inicioSemana.toISOString()).n;

  const porStatus = { aguardando: 0, em_atendimento: 0, finalizada: 0 };
  db.prepare("SELECT status, COUNT(*) n FROM conversas GROUP BY status").all()
    .forEach((r) => { if (porStatus[r.status] !== undefined) porStatus[r.status] = r.n; });

  const porAtendente = db.prepare(`
    SELECT u.id AS id, u.nome AS nome, COUNT(c.id) AS total
    FROM usuarios u
    JOIN conversas c ON c.atendenteId = u.id
    WHERE u.ativo = 1
    GROUP BY u.id
    HAVING total > 0
    ORDER BY total DESC
  `).all();

  res.json({ conversasHoje, conversasSemana, porStatus, porAtendente });
});

// =============================================================================
// ROTAS DE USUÁRIOS
// =============================================================================
app.get("/api/usuarios/atendentes", autenticar, (req, res) => {
  const usuarios = db.prepare("SELECT id, nome, email, role, ativo, criadoEm FROM usuarios WHERE ativo = 1").all();
  res.json(usuarios.map((u) => ({ ...u, ativo: true })));
});

app.get("/api/usuarios", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") return res.status(403).json({ erro: "Sem permissão" });
  const usuarios = db.prepare("SELECT id, nome, email, role, ativo, criadoEm FROM usuarios WHERE ativo = 1").all();
  res.json(usuarios.map((u) => ({ ...u, ativo: true })));
});

app.delete("/api/usuarios/:id", autenticar, (req, res) => {
  if (req.usuario.role !== "admin") return res.status(403).json({ erro: "Sem permissão" });
  if (req.params.id === req.usuario.id) return res.status(400).json({ erro: "Você não pode excluir seu próprio usuário." });

  const usuario = db.prepare("SELECT * FROM usuarios WHERE id = ? AND ativo = 1").get(req.params.id);
  if (!usuario) return res.status(404).json({ erro: "Usuário não encontrado" });

  if (usuario.role === "admin") {
    const totalAdmins = db.prepare("SELECT COUNT(*) n FROM usuarios WHERE role = 'admin' AND ativo = 1").get().n;
    if (totalAdmins <= 1) return res.status(400).json({ erro: "Não é possível excluir o último administrador." });
  }

  db.prepare("UPDATE usuarios SET ativo = 0, excluidoEm = ? WHERE id = ?").run(new Date().toISOString(), usuario.id);
  res.json({ ok: true, mensagem: "Usuário excluído com sucesso." });
});

// =============================================================================
// WEBHOOK — RECEBER MENSAGENS DO WHATSAPP
// =============================================================================
app.post("/api/webhook/whatsapp", (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (INTERNAL_API_KEY && apiKey !== INTERNAL_API_KEY) return res.status(401).json({ erro: "API key inválida" });

  const { telefone, mensagem, nomeCliente, tipo, arquivoUrl, mimeType, nomeArquivo, solicitouHumano, origemMsg, whatsappMessageId, respondendoAoWhatsappId } = req.body;
  const textoMsg = String(mensagem || '').trim().toLowerCase();
  const pedidoHumano = solicitouHumano === true || textoMsg === '5';
  // Chamada "só sinaliza humano" — usada pela IA do bot quando detecta que o associado
  // quer falar com atendente numa mensagem que já foi encaminhada antes (evita duplicar
  // a mensagem só pra atualizar a flag).
  const apenasSinalizarHumano = !mensagem && !arquivoUrl && solicitouHumano === true;
  // Resposta automática do próprio bot (menu, confirmações) — grava como nota interna
  // (origem "sistema", privada), igual já acontecia no Chatwoot, em vez de como se fosse
  // o associado falando.
  const ehMensagemBot = origemMsg === "bot";
  if (!telefone || (!mensagem && !arquivoUrl && !apenasSinalizarHumano)) return res.status(400).json({ erro: "Dados incompletos" });

  const telefoneNormalizado = normalizarTelefone(telefone);
  const agora = new Date().toISOString();

  let novaConversa = false;
  let conversaId;
  let mensagemInserida;

  const transacao = db.transaction(() => {
    let cliente = db.prepare("SELECT * FROM clientes WHERE telefone = ?").get(telefoneNormalizado);
    if (!cliente) {
      if (apenasSinalizarHumano) return;
      cliente = { id: gerarId(), telefone: telefoneNormalizado, nome: nomeCliente || "Associado", criadoEm: agora };
      db.prepare("INSERT INTO clientes (id, telefone, nome, criadoEm) VALUES (@id, @telefone, @nome, @criadoEm)").run(cliente);
    } else if (nomeCliente && cliente.nome !== nomeCliente) {
      db.prepare("UPDATE clientes SET nome = ? WHERE id = ?").run(nomeCliente, cliente.id);
      cliente.nome = nomeCliente;
    }

    let conversa = db.prepare("SELECT * FROM conversas WHERE telefone = ? AND status != 'finalizada'").get(telefoneNormalizado);

    if (!conversa) {
      if (apenasSinalizarHumano || ehMensagemBot) return;
      conversa = {
        id: gerarId(), telefone: telefoneNormalizado, clienteId: cliente.id, clienteNome: cliente.nome,
        status: "aguardando", atendenteId: null, solicitouHumano: pedidoHumano ? 1 : 0,
        criadoEm: agora, atualizadoEm: agora, finalizadaEm: null,
        ultimaMensagem: "", ultimaMensagemTipo: "texto", ultimaMensagemNomeArquivo: "", ultimaMensagemData: agora,
        mensagensNaoLidas: 0, totalMensagens: 0,
      };
      db.prepare(`
        INSERT INTO conversas (
          id, telefone, clienteId, clienteNome, status, atendenteId, solicitouHumano,
          criadoEm, atualizadoEm, finalizadaEm,
          ultimaMensagem, ultimaMensagemTipo, ultimaMensagemNomeArquivo, ultimaMensagemData,
          mensagensNaoLidas, totalMensagens
        ) VALUES (
          @id, @telefone, @clienteId, @clienteNome, @status, @atendenteId, @solicitouHumano,
          @criadoEm, @atualizadoEm, @finalizadaEm,
          @ultimaMensagem, @ultimaMensagemTipo, @ultimaMensagemNomeArquivo, @ultimaMensagemData,
          @mensagensNaoLidas, @totalMensagens
        )
      `).run(conversa);
      novaConversa = true;
    } else {
      db.prepare("UPDATE conversas SET atualizadoEm = ?, solicitouHumano = CASE WHEN ? = 1 THEN 1 ELSE solicitouHumano END WHERE id = ?")
        .run(agora, pedidoHumano ? 1 : 0, conversa.id);
    }

    conversaId = conversa.id;
    if (!apenasSinalizarHumano) {
      let respondendoA = null;
      if (respondendoAoWhatsappId) {
        const original = db.prepare("SELECT id FROM mensagens WHERE whatsappMessageId = ?").get(respondendoAoWhatsappId);
        respondendoA = original?.id || null;
      }
      mensagemInserida = inserirMensagemEAtualizarConversa({
        id: gerarId(), conversaId: conversa.id, tipo: tipo || detectarTipoPorMime(mimeType || "") || "texto",
        texto: mensagem || "", arquivoUrl: arquivoUrl || null, mimeType: mimeType || null, nomeArquivo: nomeArquivo || null,
        origem: ehMensagemBot ? "sistema" : "cliente", privado: ehMensagemBot, lida: ehMensagemBot,
        whatsappMessageId: whatsappMessageId || null, respondendoA, criadoEm: agora,
      });
    }
  });
  transacao();

  if (!conversaId) return res.json({ ok: true });

  const conversaDetalhada = conversaDetalhadaPorId(conversaId);

  if (novaConversa) io.emit("nova_conversa", conversaDetalhada);
  if (mensagemInserida) io.emit("nova_mensagem", { conversaId, mensagem: mensagemInserida });
  io.emit("conversa_atualizada", conversaDetalhada);

  res.json({ ok: true, conversaId });
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
criarMotivosPadraoSeNaoExistir();
criarTemplatesPadraoSeNaoExistir();

server.listen(PORT, () => {
  console.log(`🚀 Servidor de chat rodando na porta ${PORT}`);
  console.log(`📱 Dashboard: http://localhost:${PORT}`);
  console.log(`🔑 Login padrão: admin@avseg.com / admin123`);

  // Limpeza automática de conversas antigas (arquiva, não apaga de verdade) —
  // roda pouco depois do boot e depois a cada 24h.
  setTimeout(limparConversasAntigas, 10_000);
  setInterval(limparConversasAntigas, 24 * 60 * 60 * 1000);
});
