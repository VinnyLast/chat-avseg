// =============================================================================
// AVSEG CHAT — migração única de JSON para SQLite
// Roda manualmente uma vez: `node database/migrar-json-para-sqlite.js`
// Lê os *.json existentes em backend/database/ e insere no avseg.db (criado
// por db.js). Seguro rodar de novo — se as tabelas já tiverem dados, aborta
// sem duplicar nada.
// =============================================================================

const fs = require("fs");
const path = require("path");
const db = require("./db");

const DB_PATH = __dirname;

function lerJSON(nomeArquivo) {
  const caminho = path.join(DB_PATH, nomeArquivo);
  if (!fs.existsSync(caminho)) return [];
  try {
    return JSON.parse(fs.readFileSync(caminho, "utf8") || "[]");
  } catch (erro) {
    console.error(`Erro ao ler ${nomeArquivo}:`, erro.message);
    return [];
  }
}

function jaTemDados() {
  const total = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM usuarios)  +
      (SELECT COUNT(*) FROM clientes)  +
      (SELECT COUNT(*) FROM conversas) +
      (SELECT COUNT(*) FROM mensagens) +
      (SELECT COUNT(*) FROM etiquetas) +
      (SELECT COUNT(*) FROM templates) AS total
  `).get().total;
  return total > 0;
}

function migrar() {
  if (jaTemDados()) {
    console.log("⚠️  O banco SQLite já tem dados — migração não executada (evita duplicar).");
    console.log("   Se quiser migrar do zero, apague backend/database/avseg.db* e rode de novo.");
    return;
  }

  const usuarios  = lerJSON("usuarios.json");
  const clientes  = lerJSON("clientes.json");
  const conversas = lerJSON("conversas.json");
  const mensagens = lerJSON("mensagens.json");
  const etiquetas = lerJSON("etiquetas.json");
  const templates = lerJSON("templates.json");

  const inserirTudo = db.transaction(() => {
    const insUsuario = db.prepare(`
      INSERT INTO usuarios (id, nome, email, senha, role, ativo, criadoEm, excluidoEm)
      VALUES (@id, @nome, @email, @senha, @role, @ativo, @criadoEm, @excluidoEm)
    `);
    usuarios.forEach((u) => insUsuario.run({
      id: u.id, nome: u.nome, email: u.email, senha: u.senha,
      role: u.role || "atendente", ativo: u.ativo === false ? 0 : 1,
      criadoEm: u.criadoEm || new Date().toISOString(), excluidoEm: u.excluidoEm || null,
    }));

    const insCliente = db.prepare(`
      INSERT INTO clientes (id, telefone, nome, criadoEm) VALUES (@id, @telefone, @nome, @criadoEm)
    `);
    clientes.forEach((c) => insCliente.run({
      id: c.id, telefone: c.telefone, nome: c.nome || "",
      criadoEm: c.criadoEm || new Date().toISOString(),
    }));

    const insEtiqueta = db.prepare(`
      INSERT INTO etiquetas (id, nome, cor, criadoEm) VALUES (@id, @nome, @cor, @criadoEm)
    `);
    etiquetas.forEach((e) => insEtiqueta.run({
      id: e.id, nome: e.nome, cor: e.cor || "#f5c400",
      criadoEm: e.criadoEm || new Date().toISOString(),
    }));

    const insTemplate = db.prepare(`
      INSERT INTO templates (id, ordem, atalho, titulo, texto, criadoEm, atualizadoEm)
      VALUES (@id, @ordem, @atalho, @titulo, @texto, @criadoEm, @atualizadoEm)
    `);
    templates.forEach((t) => insTemplate.run({
      id: t.id, ordem: t.ordem ?? 0, atalho: t.atalho, titulo: t.titulo, texto: t.texto,
      criadoEm: t.criadoEm || null, atualizadoEm: t.atualizadoEm || null,
    }));

    const insMensagem = db.prepare(`
      INSERT INTO mensagens (id, conversaId, tipo, texto, arquivoUrl, mimeType, nomeArquivo, origem, usuarioId, lida, privado, criadoEm)
      VALUES (@id, @conversaId, @tipo, @texto, @arquivoUrl, @mimeType, @nomeArquivo, @origem, @usuarioId, @lida, @privado, @criadoEm)
    `);
    mensagens.forEach((m) => insMensagem.run({
      id: m.id, conversaId: m.conversaId, tipo: m.tipo || "texto", texto: m.texto || "",
      arquivoUrl: m.arquivoUrl || null, mimeType: m.mimeType || null, nomeArquivo: m.nomeArquivo || null,
      origem: m.origem, usuarioId: m.usuarioId || null,
      lida: m.lida ? 1 : 0, privado: m.privado ? 1 : 0,
      criadoEm: m.criadoEm || new Date().toISOString(),
    }));

    const insConversa = db.prepare(`
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
    `);
    const insConversaEtiqueta = db.prepare(`
      INSERT OR IGNORE INTO conversaEtiquetas (conversaId, etiquetaId) VALUES (?, ?)
    `);

    conversas.forEach((c) => {
      const mensagensConv = mensagens.filter((m) => m.conversaId === c.id);
      const ultima = mensagensConv[mensagensConv.length - 1];
      const naoLidas = mensagensConv.filter((m) => !m.lida && m.origem === "cliente").length;

      insConversa.run({
        id: c.id, telefone: c.telefone, clienteId: c.clienteId || null, clienteNome: c.clienteNome || "",
        status: c.status || "aguardando", atendenteId: c.atendenteId || null,
        solicitouHumano: c.solicitouHumano ? 1 : 0,
        criadoEm: c.criadoEm || new Date().toISOString(), atualizadoEm: c.atualizadoEm || c.criadoEm || new Date().toISOString(),
        finalizadaEm: c.finalizadaEm || null,
        ultimaMensagem: ultima?.texto || "", ultimaMensagemTipo: ultima?.tipo || "texto",
        ultimaMensagemNomeArquivo: ultima?.nomeArquivo || "",
        ultimaMensagemData: ultima?.criadoEm || c.atualizadoEm || c.criadoEm || new Date().toISOString(),
        mensagensNaoLidas: naoLidas, totalMensagens: mensagensConv.length,
      });

      (Array.isArray(c.etiquetas) ? c.etiquetas : []).forEach((etiquetaId) => {
        insConversaEtiqueta.run(c.id, etiquetaId);
      });
    });
  });

  inserirTudo();

  console.log("✅ Migração concluída:");
  console.log(`   usuarios:  ${usuarios.length} → ${db.prepare("SELECT COUNT(*) n FROM usuarios").get().n}`);
  console.log(`   clientes:  ${clientes.length} → ${db.prepare("SELECT COUNT(*) n FROM clientes").get().n}`);
  console.log(`   conversas: ${conversas.length} → ${db.prepare("SELECT COUNT(*) n FROM conversas").get().n}`);
  console.log(`   mensagens: ${mensagens.length} → ${db.prepare("SELECT COUNT(*) n FROM mensagens").get().n}`);
  console.log(`   etiquetas: ${etiquetas.length} → ${db.prepare("SELECT COUNT(*) n FROM etiquetas").get().n}`);
  console.log(`   templates: ${templates.length} → ${db.prepare("SELECT COUNT(*) n FROM templates").get().n}`);
}

migrar();
