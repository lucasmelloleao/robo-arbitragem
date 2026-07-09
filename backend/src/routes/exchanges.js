const { readJsonBody, sendJson } = require('../http-utils');
const {
    getAllExchanges,
    createExchange,
    updateExchange,
    deleteExchange,
    toggleExchangeStatus,
    getActiveExchangeStatuses,
} = require('../database');
const Exchange = require('../models/Exchange');
const { getExchangeCredentialConfig, SUPPORTED_EXCHANGES } = require('../exchange-credentials');
const { verifyToken } = require('../middleware/auth-middleware');

async function listExchanges({ request, response }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const exchanges = await getAllExchanges(decoded.id);
        sendJson(response, 200, { exchanges });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function createExchangeHandler({ request, response }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const body = await readJsonBody(request);
        const { name, acronym, apiKey, secretKey, password, active, notes, assetsMode, arbitrageConfig, marketMakingConfig } = body;

        if (!name || !acronym) {
            sendJson(response, 400, { error: 'Campos obrigatórios: name, acronym' });
            return;
        }

        if ((apiKey && !secretKey) || (!apiKey && secretKey)) {
            sendJson(response, 400, {
                error: 'API Key e Secret Key devem ser informadas juntas quando houver credenciais.'
            });
            return;
        }

        const existingExchange = await Exchange.findOne({ userId: decoded.id, acronym: acronym.toUpperCase() });
        if (existingExchange) {
            sendJson(response, 409, { error: 'Você já possui uma corretora com esta sigla.' });
            return;
        }

        const exchangeData = {
            name,
            acronym: acronym.toUpperCase(),
            apiKey: typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : undefined,
            secretKey: typeof secretKey === 'string' && secretKey.trim() ? secretKey.trim() : undefined,
            password: typeof password === 'string' && password.trim() ? password.trim() : undefined,
            active: active ?? true,
            notes: notes || '',
            assetsMode: assetsMode || 'list',
        };

        if (arbitrageConfig && typeof arbitrageConfig === 'object') {
            exchangeData.arbitrageConfig = arbitrageConfig;
        }
        if (marketMakingConfig && typeof marketMakingConfig === 'object') {
            exchangeData.marketMakingConfig = marketMakingConfig;
        }

        const exchange = await createExchange(decoded.id, exchangeData);
        sendJson(response, 201, { exchange });
    } catch (error) {
        sendJson(response, 400, { error: error.message });
    }
}

async function updateExchangeHandler({ request, response, params, context }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const { id } = params;
        const body = await readJsonBody(request);

        const currentExchange = await Exchange.findOne({ _id: id, userId: decoded.id }).lean();
        if (!currentExchange) {
            sendJson(response, 404, { error: 'Corretora não encontrada' });
            return;
        }

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
        if (typeof body.envInfo === 'string') {
            updates.envInfo = body.envInfo.trim();
        }
        if (typeof body.active === 'boolean') {
            updates.active = body.active;
        }
        if (body.assetsMode === undefined || body.assetsMode === null || body.assetsMode === '') {
            updates.assetsMode = 'list';
        } else if (['list', 'all'].includes(String(body.assetsMode).toLowerCase())) {
            updates.assetsMode = String(body.assetsMode).toLowerCase();
        }
        if (body.arbitrageConfig && typeof body.arbitrageConfig === 'object') {
            updates.arbitrageConfig = body.arbitrageConfig;
        }
        if (body.marketMakingConfig && typeof body.marketMakingConfig === 'object') {
            updates.marketMakingConfig = body.marketMakingConfig;
        }

        if (Object.keys(updates).length === 0) {
            sendJson(response, 400, { error: 'Nenhum campo válido foi informado para atualização.' });
            return;
        }

        if (updates.acronym) {
            const conflicting = await Exchange.findOne({
                userId: decoded.id,
                acronym: updates.acronym,
                _id: { $ne: id }
            }).lean();
            if (conflicting) {
                sendJson(response, 409, { error: 'Você já possui uma corretora com esta sigla.' });
                return;
            }
        }

        if (context?.invalidateServiceCaches) {
            const oldExchangeId = SUPPORTED_EXCHANGES.find(
                (eid) => getExchangeCredentialConfig(eid).acronym === currentExchange.acronym
            );
            if (oldExchangeId) {
                context.invalidateServiceCaches(oldExchangeId);
            }
        }

        const exchange = await updateExchange(id, decoded.id, updates);
        sendJson(response, 200, { exchange });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function deleteExchangeHandler({ request, response, params, context }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const { id } = params;
        const exchange = await deleteExchange(id, decoded.id);

        if (!exchange) {
            sendJson(response, 404, { error: 'Corretora não encontrada' });
            return;
        }

        if (context?.invalidateServiceCaches) {
            const exchangeId = SUPPORTED_EXCHANGES.find(
                (eid) => getExchangeCredentialConfig(eid).acronym === exchange.acronym
            );
            if (exchangeId) {
                context.invalidateServiceCaches(exchangeId);
            }
        }

        sendJson(response, 200, { message: 'Corretora removida com sucesso' });
    } catch (error) {
        sendJson(response, 400, { error: error.message });
    }
}

async function toggleExchangeHandler({ request, response, params, context }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const { id } = params;
        const exchange = await toggleExchangeStatus(id, decoded.id);

        if (!exchange) {
            sendJson(response, 404, { error: 'Corretora não encontrada' });
            return;
        }

        if (context?.invalidateServiceCaches) {
            const exchangeId = SUPPORTED_EXCHANGES.find(
                (eid) => getExchangeCredentialConfig(eid).acronym === exchange.acronym
            );
            if (exchangeId) {
                context.invalidateServiceCaches(exchangeId);
            }
        }

        sendJson(response, 200, { exchange });
    } catch (error) {
        sendJson(response, 400, { error: error.message });
    }
}

async function getExchangeById({ request, response, params }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const { id } = params;
        const exchanges = await getAllExchanges(decoded.id);
        const found = exchanges.find((exchange) => String(exchange._id) === id);

        if (!found) {
            sendJson(response, 404, { error: 'Corretora não encontrada' });
            return;
        }

        sendJson(response, 200, { exchange: found });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function getExchangeStatusesHandler({ request, response }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const statuses = await getActiveExchangeStatuses(decoded.id);
        sendJson(response, 200, { statuses });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

function registerExchangeRoutes(router) {
    router.register('GET', '/api/exchanges', listExchanges);
    router.register('GET', '/api/exchanges/statuses', getExchangeStatusesHandler);
    router.register('GET', '/api/exchanges/:id', getExchangeById);
    router.register('POST', '/api/exchanges', createExchangeHandler);
    router.register('PUT', '/api/exchanges/:id', updateExchangeHandler);
    router.register('DELETE', '/api/exchanges/:id', deleteExchangeHandler);
    router.register('PATCH', '/api/exchanges/:id/toggle', toggleExchangeHandler);
}

module.exports = { registerExchangeRoutes };
