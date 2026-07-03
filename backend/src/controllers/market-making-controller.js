const { sendJson } = require('../http-utils');

async function getMarketMakingStatus({ response, params, context }) {
    const service = await context.getMarketMakingService(params.exchangeId);
    const status = await service.getStatus();
    sendJson(response, 200, status);
}

async function runMarketMaking({ response, params, context }) {
    const service = await context.getMarketMakingService(params.exchangeId);
    const run = await service.run();
    const status = await service.getStatus();
    sendJson(response, 200, { run, status });
}

async function cancelMarketMaking({ response, params, context }) {
    const service = await context.getMarketMakingService(params.exchangeId);
    const cancellation = await service.cancelActiveExecution();
    const status = await service.getStatus();
    sendJson(response, 200, { cancellation, status });
}

module.exports = {
    cancelMarketMaking,
    getMarketMakingStatus,
    runMarketMaking
};