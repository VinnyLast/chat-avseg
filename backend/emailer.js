// =============================================================================
// AVSEG CHAT — envio de email (recuperação de senha)
// Configurado via .env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
// Se essas variáveis não estiverem definidas, o envio é ignorado com um aviso
// no log — não derruba o servidor nem quebra a rota que chamou.
// =============================================================================

const nodemailer = require("nodemailer");

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
const smtpConfigurado = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

let transportador = null;
if (smtpConfigurado) {
  transportador = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT, 10) || 587,
    secure: parseInt(SMTP_PORT, 10) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
} else {
  console.warn("⚠️  SMTP não configurado (.env) — emails de recuperação de senha não serão enviados de verdade.");
}

async function enviarEmailRecuperacaoSenha(destinatario, nomeUsuario, linkReset) {
  if (!transportador) {
    console.warn(`⚠️  Envio de email ignorado (SMTP não configurado). Link de recuperação para ${destinatario}: ${linkReset}`);
    return { enviado: false, motivo: "SMTP não configurado" };
  }

  try {
    await transportador.sendMail({
      from: SMTP_FROM || SMTP_USER,
      to: destinatario,
      subject: "AVSEG Chat — Redefinição de senha",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color:#111;">Redefinição de senha</h2>
          <p>Olá, ${nomeUsuario || ""}.</p>
          <p>Recebemos um pedido para redefinir a senha da sua conta no AVSEG Chat.</p>
          <p><a href="${linkReset}" style="display:inline-block;background:#f5c400;color:#050505;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700;">Redefinir minha senha</a></p>
          <p>Esse link expira em 1 hora. Se você não pediu essa redefinição, pode ignorar este email.</p>
        </div>
      `,
    });
    return { enviado: true };
  } catch (erro) {
    console.error("Erro ao enviar email de recuperação:", erro.message);
    return { enviado: false, motivo: erro.message };
  }
}

module.exports = { enviarEmailRecuperacaoSenha, smtpConfigurado };
