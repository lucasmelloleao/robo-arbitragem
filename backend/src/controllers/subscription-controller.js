const { sendJson } = require('../http-utils');

async function subscribeArbitrageHandler(request, response, context) {
    const { exchangeId } = request.params || {};
    
    try {
        const result = await context.startBackgroundArbitrage(exchangeId);
        sendJson(response, 200, result);
    } catch (error) {
        console.error(`Erro ao iniciar escuta de arbitragem para ${exchangeId}:`, error.message);
        sendJson(response, 500, { error: error.message });
    }
}

async function unsubscribeArbitrageHandler(request, response, context) {
    const { exchangeId } = request.params || {};
    
    try {
        if (context.startBackgroundArbitrage) {
            const result = await context.startBackgroundArbitrage(exchangeId);
            sendJson(response, 200, result);
        } else {
            sendJson(response, 200, { exchangeId, subscribed: false });
        }
    } catch (error) {
        console.error(`Erro ao parar escuta de arbitragem para ${exchangeId}:`, error.message);
        sendJson(response, 500, { error: error.message });
    }
}

async function subscribeMarketMakingHandler(request, response, context) {
    const { exchangeId } = request.params || {};
    
    try {
        const result = await context.startBackgroundMarketMaking(exchangeId);
        sendJson(response, 200, result);
    } catch (error) {
        console.error(`Erro ao iniciar escuta de market making para ${exchangeId}:`, error.message);
        sendJson(response, 500, { error: error.message });
    }
}

async function unsubscribeMarketMakingHandler(request, response, context) {
    const { exchangeId } = request.params || {};
    
    try {
        if (context.startBackgroundMarketMaking) {
            const result = await context.startBackgroundMarketMaking(exchangeId);
            sendJson(response, 200, result);
        } else {
            sendJson(response, 200, { exchangeId, subscribed: false });
        }
    } catch (error) {
        console.error(`Erro ao parar escuta de market making para ${exchangeId}:`, error.message);
        sendJson(response, 500, { error: error.message });
    }
}

module.exports = {
    subscribeArbitrage: subscribeArbitrageHandler,
    unsubscribeArbitrage: unsubscribeArbitrageHandler,
    subscribeMarketMaking: subscribeMarketMakingHandler,
    unsubscribeMarketMaking: unsubscribeMarketMakingHandler
};