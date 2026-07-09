const jwt = require('jsonwebtoken');
const { sendJson } = require('../http-utils');

/**
 * Middleware para verificar o token JWT no header Authorization.
 * Uso: chame verifyToken(request, response) antes do handler da rota.
 * Retorna o payload decodificado ou envia 401/403 e retorna null.
 */
function verifyToken(request, response) {
    const authHeader = request.headers['authorization'] || request.headers['Authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    if (!token) {
        sendJson(response, 401, { error: 'Token de autenticação não fornecido.' });
        return null;
    }

    try {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            console.error('[auth-middleware] JWT_SECRET não definido no ambiente!');
            sendJson(response, 500, { error: 'Erro de configuração do servidor.' });
            return null;
        }

        const decoded = jwt.verify(token, secret);
        return decoded;
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            sendJson(response, 401, { error: 'Token expirado. Faça login novamente.' });
        } else {
            sendJson(response, 403, { error: 'Token inválido.' });
        }
        return null;
    }
}

module.exports = { verifyToken };
