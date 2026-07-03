const {
    cancelMarketMaking,
    getMarketMakingStatus,
    runMarketMaking
} = require('../controllers/market-making-controller');

function registerMarketMakingRoutes(router) {
    router.register('GET', '/api/market-making/:exchangeId/status', getMarketMakingStatus);
    router.register('POST', '/api/market-making/:exchangeId/run', runMarketMaking);
    router.register('POST', '/api/market-making/:exchangeId/cancel', cancelMarketMaking);
}

module.exports = { registerMarketMakingRoutes };