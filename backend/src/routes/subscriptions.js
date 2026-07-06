const {
    subscribeArbitrage,
    unsubscribeArbitrage,
    subscribeMarketMaking,
    unsubscribeMarketMaking
} = require('../controllers/subscription-controller');

function registerSubscriptionRoutes(router) {
    router.register('POST', '/api/arbitrage/:exchangeId/subscribe', subscribeArbitrage);
    router.register('POST', '/api/arbitrage/:exchangeId/unsubscribe', unsubscribeArbitrage);
    router.register('POST', '/api/market-making/:exchangeId/subscribe', subscribeMarketMaking);
    router.register('POST', '/api/market-making/:exchangeId/unsubscribe', unsubscribeMarketMaking);
}

module.exports = { registerSubscriptionRoutes };