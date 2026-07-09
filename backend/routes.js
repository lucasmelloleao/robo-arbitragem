const { createRouter } = require('./router');
const { sendJson, readJsonBody } = require('./http-utils');
const { normalizeExchangeId } = require('./exchange-credentials');
const managementRoutes = require('./routes/management');
const authRoutes = require('./routes/auth');

function createApiRouter({ getService, getMarketMakingService, invalidateServiceCaches }) {
    const router = createRouter();
    const context = { getService, getMarketMakingService, invalidateServiceCaches };

    // Rotas de Autenticação
    authRoutes.register(router, context);

    // Rotas de Gerenciamento (Users, Exchanges, etc.)
    managementRoutes.register(router, context);

    // Rotas de Arbitragem
    router.register('GET', '/api/arbitrage/:exchangeId/status', async ({ response, params }) => {
        const service = await getService(params.exchangeId);
        const status = await service.getStatus();
        sendJson(response, 200, { payload: status });
    });

    router.register('GET', '/api/arbitrage/:exchangeId/scan', async ({ response, params }) => {
        const service = await getService(params.exchangeId);
        const scan = await service.scan();
        sendJson(response, 200, { scan });
    });

    // Rotas de Market Making
    router.register('GET', '/api/market-making/:exchangeId/status', async ({ response, params }) => {
        const service = await getMarketMakingService(params.exchangeId);
        const status = await service.getStatus();
        sendJson(response, 200, { payload: status });
    });

    router.register('GET', '/api/market-making/:exchangeId/run', async ({ response, params }) => {
        const service = await getMarketMakingService(params.exchangeId);
        const run = await service.run();
        const status = await service.getStatus();
        sendJson(response, 200, { run, status });
    });

    router.register('GET', '/api/market-making/:exchangeId/cancel', async ({ response, params }) => {
        const service = await getMarketMakingService(params.exchangeId);
        const cancellation = await service.cancelActiveExecution();
        const status = await service.getStatus();
        sendJson(response, 200, { cancellation, status });
    });

    // Rotas de Cross-Market
    const crossMarketService = require('./cross-market-service');
    router.register('GET', '/api/cross-market/status', async ({ response }) => {
        const status = crossMarketService.getStatus();
        sendJson(response, 200, { payload: status });
    });

    router.register('GET', '/api/cross-market/logs', async ({ response, requestUrl }) => {
        const limit = requestUrl.searchParams.get('limit');
        const strategyId = requestUrl.searchParams.get('strategyId');
        const logs = crossMarketService.getLogs(limit, strategyId);
        sendJson(response, 200, { logs });
    });

    router.register('POST', '/api/cross-market/restart', async ({ response }) => {
        await crossMarketService.restart();
        sendJson(response, 200, { message: 'Serviço de Cross-Market reiniciado.' });
    });

    return {
        handle: async (request, response, requestUrl) => {
            try {
                const handled = await router.handle(request, response, requestUrl, context);
                if (!handled && requestUrl.pathname.startsWith('/api/')) {
                    sendJson(response, 404, { error: 'Endpoint da API não encontrado.' });
                    return true;
                }
                return handled;
            } catch (error) {
                console.error(`[api-router] Erro ao processar ${request.method} ${requestUrl.pathname}:`, error);
                if (!response.headersSent) {
                    sendJson(response, 500, { error: error.message });
                }
                return true;
            }
        }
    };
}

module.exports = { createApiRouter };