const { readJsonBody, sendJson } = require('../http-utils');
const {
    getAllExchanges,
    createExchange,
    updateExchange,
    deleteExchange,
    toggleExchangeStatus,
} = require('../database');
const Exchange = require('../models/Exchange');
const { getExchangeCredentialConfig, SUPPORTED_EXCHANGES } = require('../exchange-credentials');
const { resolveMarketMakingConfig } = require('../exchange-config');

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

        const { name, acronym, apiKey, secretKey, password, active, notes, arbitrageConfig, marketMakingConfig } = body;

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

        const exchangeData = {
            name,
            acronym: acronym.toUpperCase(),
            apiKey: typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : undefined,
            secretKey: typeof secretKey === 'string' && secretKey.trim() ? secretKey.trim() : undefined,
            password: typeof password === 'string' && password.trim() ? password.trim() : undefined,
            active: active ?? true,
            notes: notes || '',
        };

        if (arbitrageConfig && typeof arbitrageConfig === 'object') {
            exchangeData.arbitrageConfig = arbitrageConfig;
        }
        if (marketMakingConfig && typeof marketMakingConfig === 'object') {
            exchangeData.marketMakingConfig = marketMakingConfig;
        }

        const exchange = await createExchange(exchangeData);

        sendJson(response, 201, { exchange });
    } catch (error) {
        sendJson(response, 400, { error: error.message });
    }
}

async function updateExchangeHandler({ request, response, params, context }) {
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

        if (typeof body.envInfo === 'string') {
            updates.envInfo = body.envInfo.trim();
        }

        if (typeof body.active === 'boolean') {
            updates.active = body.active;
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
            const existingExchange = await Exchange.findOne({
                acronym: updates.acronym,
                _id: { $ne: id }
            }).lean();

            if (existingExchange) {
                sendJson(response, 409, { error: 'Sigla da corretora já existe' });
                return;
            }
        }

        if (context?.invalidateServiceCaches) {
            const oldExchange = await Exchange.findById(id).lean();
            if (oldExchange) {
                const oldExchangeId = SUPPORTED_EXCHANGES.find(
                    (eid) => getExchangeCredentialConfig(eid).acronym === oldExchange.acronym
                );
                if (oldExchangeId) {
                    context.invalidateServiceCaches(oldExchangeId);
                }
            }
        }

        const exchange = await updateExchange(id, updates);

        if (!exchange) {
            sendJson(response, 404, { error: 'Corretora não encontrada' });
            return;
        }

        sendJson(response, 200, { exchange });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function deleteExchangeHandler({ request, response, params, context }) {
    try {
        const { id } = params;
        const exchange = await deleteExchange(id);

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
    try {
        const { id } = params;
        const exchange = await toggleExchangeStatus(id);

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
        const supportedExchanges = ['binance', 'kraken', 'bybit', 'mexc', 'coinbase', 'gateio', 'okx', 'woo'];
        const summary = { updated: 0, skipped: 0, not_found: 0, errors: 0 };

        for (const exchangeId of supportedExchanges) {
            try {
                const envConfig = await resolveMarketMakingConfig(exchangeId).catch(() => null);
                if (!envConfig || !envConfig.symbols || envConfig.symbols.length === 0) {
                    continue;
                }

                const symbolsString = envConfig.symbols.join(',');
                const exchangeDefinition = getExchangeCredentialConfig(exchangeId);
                const acronym = exchangeDefinition.acronym;

                const existingExchange = await Exchange.findOne({ acronym });

                if (existingExchange) {
                    const currentSymbols = existingExchange.marketMakingConfig?.symbol || '';
                    if (currentSymbols !== symbolsString) {
                        const newConfig = { ...(existingExchange.toObject().marketMakingConfig || {}), symbol: symbolsString };
                        await updateExchange(existingExchange._id, { marketMakingConfig: newConfig });
                        summary.updated++;
                    } else {
                        summary.skipped++;
                    }
                } else {
                    summary.not_found++;
                }
            } catch (error) {
                console.error(`[sync-env] Error syncing MM symbols for ${exchangeId}: ${error.message}`);
                summary.errors++;
            }
        }
        
        const message = `Sincronização de símbolos de Market Making do .env concluída. ${summary.updated} atualizada(s), ${summary.skipped} sem alteração, ${summary.not_found} não encontrada(s) no DB.`;
        sendJson(response, 200, { summary, message });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

function registerExchangeRoutes(router) {
    router.register('GET', '/api/exchanges', listExchanges);
    router.register('GET', '/api/exchanges/:id', getExchangeById);
    router.register('POST', '/api/exchanges', createExchangeHandler);
    router.register('PUT', '/api/exchanges/:id', updateExchangeHandler);
    router.register('DELETE', '/api/exchanges/:id', deleteExchangeHandler);
    router.register('PATCH', '/api/exchanges/:id/toggle', toggleExchangeHandler);
    router.register('GET', '/api/exchanges/sync-env', syncExchangesFromEnvHandler);
    router.register('POST', '/api/exchanges/sync-env', syncExchangesFromEnvHandler);
}

module.exports = { registerExchangeRoutes };
