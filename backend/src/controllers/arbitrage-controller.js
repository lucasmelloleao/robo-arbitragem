const { sendJson } = require('../http-utils');
const { getArbitrageStatus, runArbitrageScan } = require('../arbitrage-service');

async function getArbitrageStatusHandler(request, response, context) {
    const { exchangeId } = request.params || {};
    
    try {
        const service = await context.getService(exchangeId);
        const status = await service.getStatus();
        sendJson(response, 200, status);
    } catch (error) {
        console.error(`Erro ao obter status de arbitragem para ${exchangeId}:`, error.message);
        sendJson(response, 500, { error: error.message });
    }
}

async function runArbitrageScanHandler(request, response, context) {
    const { exchangeId } = request.params || {};
    
    try {
        const service = await context.getService(exchangeId);
        const result = await service.scan();
        const status = await service.getStatus();
        
        sendJson(response, 200, {
            scan: result,
            status
        });
    } catch (error) {
        console.error(`Erro ao executar scan de arbitragem para ${exchangeId}:`, error.message);
        sendJson(response, 500, { error: error.message });
    }
}

async function getArbitrageLogsHandler(request, response, context) {
    const { exchangeId } = request.params || {};
    
    try {
        const service = await context.getService(exchangeId);
        const status = await service.getStatus();
        
        sendJson(response, 200, {
            logs: status.logs || [],
            recentScans: status.recentScans || []
        });
    } catch (error) {
        console.error(`Erro ao obter logs de arbitragem para ${exchangeId}:`, error.message);
        sendJson(response, 500, { error: error.message });
    }
}

module.exports = {
    getArbitrageStatus: getArbitrageStatusHandler,
    runArbitrageScan: runArbitrageScanHandler,
    getArbitrageLogs: getArbitrageLogsHandler
};