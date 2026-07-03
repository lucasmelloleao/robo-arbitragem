const { sendJson } = require('../http-utils');

async function getArbitrageStatus({ response, params, context }) {
    const service = await context.getService(params.exchangeId);
    const status = await service.getStatus();
    sendJson(response, 200, status);
}

async function runArbitrageScan({ response, params, context }) {
    const service = await context.getService(params.exchangeId);
    const scan = await service.scan();
    const logs = await service.readLogs(10);
    sendJson(response, 200, { scan, logs });
}

async function getArbitrageLogs({ response, params, requestUrl, context }) {
    const service = await context.getService(params.exchangeId);
    const limit = Math.max(1, Number(requestUrl.searchParams.get('limit')) || 30);
    const logs = await service.readLogs(limit);
    sendJson(response, 200, { logs });
}

module.exports = {
    getArbitrageLogs,
    getArbitrageStatus,
    runArbitrageScan
};