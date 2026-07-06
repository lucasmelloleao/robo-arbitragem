const { sendJson } = require('../http-utils');

async function subscribeArbitrageHandler({ params, context }) {
    const { exchangeId } = params || {};
    
    try {
        const result = await context.startBackgroundArbitrage(exchangeId);
        sendJson(context.response, 200, result);
    } catch (error) {
        console.error(`Erro ao iniciar escuta de arbitragem para ${exchangeId}:`, error.message);
        sendJson(context.response, 500, { error: error.message });
    }
}

async function unsubscribeArbitrageHandler({ params, context }) {
    const { exchangeId } = params || {};
    
    try {
        if (context.startBackgroundArbitrage) {
            const result = await context.startBackgroundArbitrage(exchangeId);
            sendJson(context.response, 200, result);
        } else {
            sendJson(context.response, 200, { exchangeId, subscribed: false });
        }
    } catch (error) {
        console.error(`Erro ao parar escuta de arbitragem para ${exchangeId}:`, error.message);
        sendJson(context.response, 500, { error: error.message });
    }
}

async function subscribeMarketMakingHandler({ params, context }) {
    const { exchangeId } = params || {};
    
    try {
        const result = await context.startBackgroundMarketMaking(exchangeId);
        sendJson(context.response, 200, result);
    } catch (error) {
        console.error(`Erro ao iniciar escuta de market making para ${exchangeId}:`, error.message);
        sendJson(context.response, 500, { error: error.message });
    }
}

async function unsubscribeMarketMakingHandler({ params, context }) {
    const { exchangeId } = params || {};
    
    try {
        if (context.startBackgroundMarketMaking) {
            const result = await context.startBackgroundMarketMaking(exchangeId);
            sendJson(context.response, 200, result);
        } else {
            sendJson(context.response, 200, { exchangeId, subscribed: false });
        }
    } catch (error) {
        console.error(`Erro ao parar escuta de market making para ${exchangeId}:`, error.message);
        sendJson(context.response, 500, { error: error.message });
    }
}

module.exports = {
    subscribeArbitrage: subscribeArbitrageHandler,
    unsubscribeArbitrage: unsubscribeArbitrageHandler,
    subscribeMarketMaking: subscribeMarketMakingHandler,
    unsubscribeMarketMaking: unsubscribeMarketMakingHandler
};