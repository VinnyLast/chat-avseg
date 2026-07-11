const API_URL = window.location.origin;

const loginForm = document.getElementById("loginForm");
const erroDiv = document.getElementById("erro");
const btnLogin = document.getElementById("btnLogin");

// =============================================================================
// MOSTRAR / OCULTAR SENHA
// =============================================================================
const ICONE_OLHO_ABERTO = '<svg class="icone-olho" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
const ICONE_OLHO_FECHADO = '<svg class="icone-olho" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.4 18.4 0 0 1 5.06-5.94M9.9 4.24A10.6 10.6 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

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

// =============================================================================
// ESQUECI MINHA SENHA
// =============================================================================
const formEsqueciSenha = document.getElementById("formEsqueciSenha");
const linkEsqueciSenha = document.getElementById("linkEsqueciSenha");
const btnVoltarLogin = document.getElementById("btnVoltarLogin");
const erroRecuperacao = document.getElementById("erroRecuperacao");
const sucessoRecuperacao = document.getElementById("sucessoRecuperacao");

function abrirEsqueciSenha(e) {
  e?.preventDefault();
  loginForm.style.display = "none";
  formEsqueciSenha.style.display = "flex";
  erroRecuperacao.style.display = "none";
  sucessoRecuperacao.style.display = "none";
}

function voltarParaLogin() {
  formEsqueciSenha.style.display = "none";
  loginForm.style.display = "flex";
  formEsqueciSenha.reset();
}

linkEsqueciSenha?.addEventListener("click", abrirEsqueciSenha);
btnVoltarLogin?.addEventListener("click", voltarParaLogin);

formEsqueciSenha?.addEventListener("submit", async (e) => {
  e.preventDefault();
  erroRecuperacao.style.display = "none";
  sucessoRecuperacao.style.display = "none";

  const email = document.getElementById("emailRecuperacao").value.trim();
  const btnEnviar = document.getElementById("btnEnviarRecuperacao");
  btnEnviar.disabled = true;
  btnEnviar.textContent = "Enviando...";

  try {
    const resposta = await fetch(`${API_URL}/api/auth/esqueci-senha`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) {
      erroRecuperacao.textContent = dados.erro || "Erro ao solicitar recuperação.";
      erroRecuperacao.style.display = "block";
      return;
    }
    sucessoRecuperacao.textContent = dados.mensagem || "Se o email existir, enviamos um link de recuperação.";
    sucessoRecuperacao.style.display = "block";
    formEsqueciSenha.reset();
  } catch (_) {
    erroRecuperacao.textContent = "Erro de conexão com o servidor.";
    erroRecuperacao.style.display = "block";
  } finally {
    btnEnviar.disabled = false;
    btnEnviar.textContent = "Enviar link de recuperação";
  }
});

function mostrarErro(mensagem) {
  erroDiv.textContent = mensagem;
  erroDiv.style.display = "block";
}

function esconderErro() {
  erroDiv.textContent = "";
  erroDiv.style.display = "none";
}

async function verificarLoginExistente() {
  const token = localStorage.getItem("avseg_token");

  if (!token) return;

  try {
    const resposta = await fetch(`${API_URL}/api/auth/verificar`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (resposta.ok) {
      window.location.href = "/dashboard";
    } else {
      localStorage.removeItem("avseg_token");
      localStorage.removeItem("avseg_usuario");
    }
  } catch (erro) {
    console.error("Erro ao verificar login:", erro);
  }
}

loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  esconderErro();

  const email = document.getElementById("email").value.trim();
  const senha = document.getElementById("senha").value;

  if (!email || !senha) {
    mostrarErro("Informe email e senha.");
    return;
  }

  btnLogin.disabled = true;
  btnLogin.textContent = "Entrando...";

  try {
    const resposta = await fetch(`${API_URL}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, senha }),
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      mostrarErro(dados.erro || "Erro ao fazer login.");
      return;
    }

    localStorage.setItem("avseg_token", dados.token);
    localStorage.setItem("avseg_usuario", JSON.stringify(dados.usuario));

    window.location.href = "/dashboard";
  } catch (erro) {
    console.error("Erro no login:", erro);
    mostrarErro("Erro de conexão com o servidor.");
  } finally {
    btnLogin.disabled = false;
    btnLogin.textContent = "Entrar";
  }
});

verificarLoginExistente();