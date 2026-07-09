const { createRouter } = require('../router');
const { registerArbitrageRoutes } = require('./arbitrage');
const { registerMarketMakingRoutes } = require('./market-making');
const { registerUserRoutes } = require('./users');
const { registerExchangeRoutes } = require('./exchanges');
const { registerSubscriptionRoutes } = require('./subscriptions');
const { registerCrossMarketRoutes } = require('./cross-market');
const { registerAuthRoutes } = require('./auth');
const { registerTransferRoutes } = require('./transfers');

function createApiRouter(context) {
    const router = createRouter();

    registerAuthRoutes(router);
    registerUserRoutes(router);
    registerExchangeRoutes(router);
    registerArbitrageRoutes(router);
    registerMarketMakingRoutes(router);
    registerSubscriptionRoutes(router);
    registerCrossMarketRoutes(router);
    registerTransferRoutes(router);

    return {
        handle: async (request, response, requestUrl) => {
            if (!requestUrl.pathname.startsWith('/api/')) {
                return false;
            }

            return await router.handle(request, response, requestUrl, context);
        }
    };
}

module.exports = { createApiRouter };
