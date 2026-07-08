const { createRouter } = require('../router');
const { registerArbitrageRoutes } = require('./arbitrage');
const { registerMarketMakingRoutes } = require('./market-making');
const { registerUserRoutes } = require('./users');
const { registerExchangeRoutes } = require('./exchanges');
const { registerSubscriptionRoutes } = require('./subscriptions');
const { registerCrossMarketRoutes } = require('./cross-market');

function createApiRouter(context) {
    const router = createRouter();

    registerUserRoutes(router, context);
    registerExchangeRoutes(router, context);
    registerArbitrageRoutes(router, context);
    registerMarketMakingRoutes(router, context);
    registerSubscriptionRoutes(router, context);
    registerCrossMarketRoutes(router);

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
