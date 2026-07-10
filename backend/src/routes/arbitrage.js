const {
    getArbitrageLogs,
    getArbitrageStatus,
    runArbitrageScan
} = require('../controllers/arbitrage-controller');
const { getArbitrageTrades, getArbitrageTradesCount, getArbitrageTradesStats } = require('../database');
const { verifyToken } = require('../middleware/auth-middleware');
const { sendJson } = require('../http-utils');

async function listTradesHandler({ request, response, requestUrl }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const queryParams = requestUrl.searchParams;
        const status = queryParams.get('status') || '';
        const limit = parseInt(queryParams.get('limit')) || 15;
        const page = parseInt(queryParams.get('page')) || 1;
        const skip = (page - 1) * limit;

        const filter = {};
        if (status) filter.status = status;

        const trades = await getArbitrageTrades(decoded.id, filter, { limit, skip });
        const total = await getArbitrageTradesCount(decoded.id, filter);

        sendJson(response, 200, { trades, total, page, limit });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function statsHandler({ request, response }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const stats = await getArbitrageTradesStats(decoded.id);
        sendJson(response, 200, stats);
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

function registerArbitrageRoutes(router) {
    router.register('GET', '/api/arbitrage/trades', listTradesHandler);
    router.register('GET', '/api/arbitrage/trades/stats', statsHandler);
    router.register('GET', '/api/arbitrage/:exchangeId/status', getArbitrageStatus);
    router.register('POST', '/api/arbitrage/:exchangeId/scan', runArbitrageScan);
    router.register('GET', '/api/arbitrage/:exchangeId/logs', getArbitrageLogs);
}

module.exports = { registerArbitrageRoutes };