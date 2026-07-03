const {
    getArbitrageLogs,
    getArbitrageStatus,
    runArbitrageScan
} = require('../controllers/arbitrage-controller');

function registerArbitrageRoutes(router) {
    router.register('GET', '/api/arbitrage/:exchangeId/status', getArbitrageStatus);
    router.register('POST', '/api/arbitrage/:exchangeId/scan', runArbitrageScan);
    router.register('GET', '/api/arbitrage/:exchangeId/logs', getArbitrageLogs);
}

module.exports = { registerArbitrageRoutes };