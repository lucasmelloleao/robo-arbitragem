const {
    createUser,
    getAllUsers,
    getUserByEmail,
    getUserByUsername,
    updateUserStopTrader,
    deleteUser
} = require('../database');
const { readJsonBody, sendJson } = require('../http-utils');

async function listUsers({ response }) {
    const users = await getAllUsers();
    sendJson(response, 200, { users });
}

async function createUserHandler({ request, response }) {
    try {
        const userData = await readJsonBody(request);
        const required = ['username', 'name', 'mail', 'password'];
        const missing = required.filter((field) => !userData[field]);

        if (missing.length > 0) {
            sendJson(response, 400, { error: `Campos obrigatórios: ${missing.join(', ')}` });
            return;
        }

        const existingByUsername = await getUserByUsername(userData.username);
        if (existingByUsername) {
            sendJson(response, 409, { error: 'Username já existe' });
            return;
        }

        const existingByEmail = await getUserByEmail(userData.mail);
        if (existingByEmail) {
            sendJson(response, 409, { error: 'Email já existe' });
            return;
        }

        const user = await createUser(userData);
        const { password, ...userWithoutPassword } = user;
        sendJson(response, 201, { user: userWithoutPassword });
    } catch (error) {
        if (error.code === 11000) {
            sendJson(response, 409, { error: 'Username ou email já existe' });
            return;
        }

        sendJson(response, 400, { error: error.message });
    }
}

async function updateUserHandler({ request, response, params }) {
    try {
        const updates = await readJsonBody(request);
        const user = await updateUserStopTrader(params.username, updates.stopTrader);

        if (!user) {
            sendJson(response, 404, { error: 'Usuário não encontrado' });
            return;
        }

        const { password, ...userWithoutPassword } = user;
        sendJson(response, 200, { user: userWithoutPassword });
    } catch (error) {
        sendJson(response, 400, { error: error.message });
    }
}

async function deleteUserHandler({ request, response, params }) {
    try {
        const user = await deleteUser(params.username);

        if (!user) {
            sendJson(response, 404, { error: 'Usuário não encontrado' });
            return;
        }

        sendJson(response, 200, { message: 'Usuário removido com sucesso' });
    } catch (error) {
        sendJson(response, 400, { error: error.message });
    }
}

module.exports = {
    createUserHandler,
    listUsers,
    updateUserHandler,
    deleteUserHandler
};
