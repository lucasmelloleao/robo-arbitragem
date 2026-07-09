import { fetchJson, showToast } from './js/shared.js';

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const loginFeedback = document.getElementById('login-feedback');
    const loginButton = document.getElementById('login-button');

    if (!loginForm) return;

    // Se já houver um token, redireciona para a página principal
    if (localStorage.getItem('authToken')) {
        window.location.href = '/index.html';
        return;
    }

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (loginButton.disabled) return;

        const email = loginForm.elements.email.value;
        const password = loginForm.elements.password.value;

        loginFeedback.textContent = '';
        loginButton.disabled = true;
        loginButton.textContent = 'Verificando...';

        try {
            const result = await fetchJson(`${window.API_URL}/api/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            if (result.token) {
                localStorage.setItem('authToken', result.token);
                showToast('Login bem-sucedido! Redirecionando...', 'success');
                window.setTimeout(() => {
                    window.location.href = '/index.html';
                }, 1000);
            } else {
                throw new Error(result.error || 'Resposta inválida do servidor.');
            }
        } catch (error) {
            loginFeedback.textContent = error.message;
            showToast(error.message, 'error');
        } finally {
            loginButton.disabled = false;
            loginButton.textContent = 'Entrar';
        }
    });
});
