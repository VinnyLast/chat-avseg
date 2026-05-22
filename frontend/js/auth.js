const API_URL = window.location.origin;

const loginForm = document.getElementById("loginForm");
const erroDiv = document.getElementById("erro");
const btnLogin = document.getElementById("btnLogin");

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
      window.location.href = "dashboard.html";
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

    window.location.href = "dashboard.html";
  } catch (erro) {
    console.error("Erro no login:", erro);
    mostrarErro("Erro de conexão com o servidor.");
  } finally {
    btnLogin.disabled = false;
    btnLogin.textContent = "Entrar";
  }
});

verificarLoginExistente();