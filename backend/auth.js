const jwt = require('jsonwebtoken');
const { sendJson, readJsonBody } = require('../http-utils');
const User = require('../models/User');

function register(router, context) {
    router.register('POST', '/api/auth/login', async ({ request, response }) => {
        const { email, password } = await readJsonBody(request);

        if (!email || !password) {
            return sendJson(response, 400, { error: 'Email e senha são obrigatórios.' });
        }

        // Busca o usuário pelo email (case-insensitive)
        const user = await User.findOne({ mail: { $regex: new RegExp(`^${email}$`, 'i') } });

        if (!user) {
            return sendJson(response, 401, { error: 'Credenciais inválidas.' });
        }

        // Compara a senha fornecida com a senha hasheada no banco
        const isMatch = await user.comparePassword(password);

        if (!isMatch) {
            return sendJson(response, 401, { error: 'Credenciais inválidas.' });
        }

        // Gera o token JWT
        const jwtPayload = { id: user._id, username: user.username };
        const token = jwt.sign(jwtPayload, process.env.JWT_SECRET || 'default_secret', {
            expiresIn: '1d' // Token expira em 1 dia
        });

        sendJson(response, 200, {
            message: 'Login bem-sucedido!',
            token
        });
    });
}

module.exports = { register };