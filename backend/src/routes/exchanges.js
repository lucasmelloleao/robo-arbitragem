const { readJsonBody, sendJson } = require('../http-utils');
const {
    getAllExchanges,
    createExchange,
    syncExchangesFromEnv,
    updateExchange,
    deleteExchange,
    toggleExchangeStatus
} = require('../database');
const Exchange = require('../models/Exchange');

async function listExchanges({ response }) {
    try {
        const exchanges = await getAllExchanges();
        sendJson(response, 200, { exchanges });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function createExchangeHandler({ request, response }) {
    try {
        const body = await readJsonBody(request);

        const { name, acronym, apiKey, secretKey, password, active, notes } = body;

        if (!name || !acronym) {
            sendJson(response, 400, { 
                error: 'Campos obrigatórios: name, acronym' 
            });
            return;
        }

        if ((apiKey && !secretKey) || (!apiKey && secretKey)) {
            sendJson(response, 400, {
                error: 'API Key e Secret Key devem ser informadas juntas quando houver credenciais.'
            });
            return;
        }

        const existingExchange = await Exchange.findOne({ acronym });
        if (existingExchange) {
            sendJson(response, 409, { error: 'Sigla da corretora já existe' });
            return;
        }

        const exchange = await createExchange({
            name,
            acronym: acronym.toUpperCase(),
            apiKey: typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : undefined,
            secretKey: typeof secretKey === 'string' && secretKey.trim() ? secretKey.trim() : undefined,
            password: typeof password === 'string' && password.trim() ? password.trim() : undefined,
            active: active ?? true,
            notes: notes || ''
        });

        sendJson(response, 201, { exchange });
    } catch (error) {
        sendJson(response, 400, { error: error.message });
    }
}

async function updateExchangeHandler({ request, response, params }) {
    try {
        const { id } = params;
        const body = await readJsonBody(request);
        const updates = {};

        if (typeof body.name === 'string' && body.name.trim()) {
            updates.name = body.name.trim();
        }

        if (typeof body.acronym === 'string' && body.acronym.trim()) {
            updates.acronym = body.acronym.trim().toUpperCase();
        }

        if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
            updates.apiKey = body.apiKey.trim();
        }

        if (typeof body.secretKey === 'string' && body.secretKey.trim()) {
            updates.secretKey = body.secretKey.trim();
        }

        if (typeof body.password === 'string' && body.password.trim()) {
            updates.password = body.password.trim();
        }

        if (typeof body.notes === 'string') {
            updates.notes = body.notes.trim();
        }

        if (typeof body.active === 'boolean') {
            updates.active = body.active;
        }

        if (Object.keys(updates).length === 0) {
            sendJson(response, 400, { error: 'Nenhum campo válido foi informado para atualização.' });
            return;
        }

        if (updates.acronym) {
            const existingExchange = await Exchange.findOne({
                acronym: updates.acronym,
                _id: { $ne: id }
            }).lean();

            if (existingExchange) {
                sendJson(response, 409, { error: 'Sigla da corretora já existe' });
                return;
            }
        }

        const exchange = await updateExchange(id, updates);

        if (!exchange) {
            sendJson(response, 404, { error: 'Corretora não encontrada' });
            return;
        }

        sendJson(response, 200, { exchange });
    } catch (error) {
        sendJson(response, 400, { error: error.message });
    }
}

async function deleteExchangeHandler({ request, response, params }) {
    try {
        const { id } = params;
        const exchange = await deleteExchange(id);

        if (!exchange) {
            sendJson(response, 404, { error: 'Corretora não encontrada' });
            return;
        }

        sendJson(response, 200, { message: 'Corretora removida com sucesso' });
    } catch (error) {
        sendJson(response, 400, { error: error.message });
    }
}

async function toggleExchangeHandler({ request, response, params }) {
    try {
        const { id } = params;
        const exchange = await toggleExchangeStatus(id);

        if (!exchange) {
            sendJson(response, 404, { error: 'Corretora não encontrada' });
            return;
        }

        sendJson(response, 200, { exchange });
    } catch (error) {
        sendJson(response, 400, { error: error.message });
    }
}

async function getExchangeById({ request, response, params }) {
    try {
        const { id } = params;
        const exchanges = await getAllExchanges();
        const found = exchanges.find((exchange) => exchange._id === id);

        if (!found) {
            sendJson(response, 404, { error: 'Corretora não encontrada' });
            return;
        }

        sendJson(response, 200, { exchange: found });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function syncExchangesFromEnvHandler({ response }) {
    try {
        const summary = await syncExchangesFromEnv({ overwriteCredentials: false });
        sendJson(response, 200, { summary });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

function registerExchangeRoutes(router) {
    router.register('GET', '/api/exchanges', listExchanges);
    router.register('GET', '/api/exchanges/:id', getExchangeById);
    router.register('POST', '/api/exchanges/sync-env', syncExchangesFromEnvHandler);
    router.register('POST', '/api/exchanges', createExchangeHandler);
    router.register('PUT', '/api/exchanges/:id', updateExchangeHandler);
    router.register('DELETE', '/api/exchanges/:id', deleteExchangeHandler);
    router.register('PATCH', '/api/exchanges/:id/toggle', toggleExchangeHandler);
}

module.exports = { registerExchangeRoutes };
