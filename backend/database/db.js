// =============================================================================
// AVSEG CHAT — conexão SQLite + schema
// Substitui os arquivos JSON (usuarios/conversas/mensagens/clientes/
// etiquetas/templates) por um único arquivo avseg.db, com índices reais e
// escrita transacional. Nomes de coluna em camelCase — iguais aos campos que
// a API já devolve — pra manter o contrato com o frontend idêntico.
// =============================================================================

const path = require("path");
const Database = require("better-sqlite3");

const CAMINHO_DB = path.join(__dirname, "avseg.db");
const db = new Database(CAMINHO_DB);

// WAL: leitura concorrente durante escrita + muito mais resistente a
// corrupção em caso de crash do que uma escrita comum de arquivo.
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    email TEXT NOT NULL,
    senha TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'atendente',
    ativo INTEGER NOT NULL DEFAULT 1,
    criadoEm TEXT NOT NULL,
    excluidoEm TEXT,
    resetToken TEXT,
    resetTokenExpira TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);

  CREATE TABLE IF NOT EXISTS clientes (
    id TEXT PRIMARY KEY,
    telefone TEXT NOT NULL,
    nome TEXT,
    criadoEm TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_clientes_telefone ON clientes(telefone);

  CREATE TABLE IF NOT EXISTS conversas (
    id TEXT PRIMARY KEY,
    telefone TEXT NOT NULL,
    clienteId TEXT,
    clienteNome TEXT,
    status TEXT NOT NULL DEFAULT 'aguardando',
    atendenteId TEXT,
    solicitouHumano INTEGER NOT NULL DEFAULT 0,
    criadoEm TEXT NOT NULL,
    atualizadoEm TEXT NOT NULL,
    finalizadaEm TEXT,
    ultimaMensagem TEXT DEFAULT '',
    ultimaMensagemTipo TEXT DEFAULT 'texto',
    ultimaMensagemNomeArquivo TEXT DEFAULT '',
    ultimaMensagemData TEXT,
    mensagensNaoLidas INTEGER NOT NULL DEFAULT 0,
    totalMensagens INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_conversas_status ON conversas(status);
  CREATE INDEX IF NOT EXISTS idx_conversas_telefone ON conversas(telefone);
  CREATE INDEX IF NOT EXISTS idx_conversas_atendente ON conversas(atendenteId);
  CREATE INDEX IF NOT EXISTS idx_conversas_ultimaMsg ON conversas(ultimaMensagemData);
  CREATE INDEX IF NOT EXISTS idx_conversas_finalizada ON conversas(status, finalizadaEm);

  CREATE TABLE IF NOT EXISTS mensagens (
    id TEXT PRIMARY KEY,
    conversaId TEXT NOT NULL,
    tipo TEXT DEFAULT 'texto',
    texto TEXT,
    arquivoUrl TEXT,
    mimeType TEXT,
    nomeArquivo TEXT,
    origem TEXT NOT NULL,
    usuarioId TEXT,
    lida INTEGER NOT NULL DEFAULT 0,
    privado INTEGER NOT NULL DEFAULT 0,
    criadoEm TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_mensagens_conversa ON mensagens(conversaId, criadoEm);

  CREATE TABLE IF NOT EXISTS etiquetas (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    cor TEXT NOT NULL,
    criadoEm TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversaEtiquetas (
    conversaId TEXT NOT NULL,
    etiquetaId TEXT NOT NULL,
    PRIMARY KEY (conversaId, etiquetaId)
  );
  CREATE INDEX IF NOT EXISTS idx_conversaEtiquetas_conversa ON conversaEtiquetas(conversaId);

  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    ordem INTEGER DEFAULT 0,
    atalho TEXT NOT NULL,
    titulo TEXT NOT NULL,
    texto TEXT NOT NULL,
    criadoEm TEXT,
    atualizadoEm TEXT
  );

  CREATE TABLE IF NOT EXISTS motivos (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    criadoEm TEXT NOT NULL
  );
`);

// Migração leve pra bancos criados antes da coluna existir — CREATE TABLE
// IF NOT EXISTS não adiciona coluna em tabela que já existe.
const colunasUsuarios = db.prepare("PRAGMA table_info(usuarios)").all().map((c) => c.name);
if (!colunasUsuarios.includes("resetToken")) db.exec("ALTER TABLE usuarios ADD COLUMN resetToken TEXT");
if (!colunasUsuarios.includes("resetTokenExpira")) db.exec("ALTER TABLE usuarios ADD COLUMN resetTokenExpira TEXT");

const colunasConversas = db.prepare("PRAGMA table_info(conversas)").all().map((c) => c.name);
if (!colunasConversas.includes("motivoFinalizacaoId")) db.exec("ALTER TABLE conversas ADD COLUMN motivoFinalizacaoId TEXT");

module.exports = db;
