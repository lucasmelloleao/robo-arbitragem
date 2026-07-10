const { getAllExchanges } = require('./database');
const crossMarketService = require('./cross-market-service');

let serverArbitrageInstance = null;
let serverMMInstance = null;
let isExecutionActive = true; // default to true on startup

function setInstances(serverArbitrage, serverMM) {
    serverArbitrageInstance = serverArbitrage;
    serverMMInstance = serverMM;
}

async function stopAll() {
    isExecutionActive = false;
    console.log('[System Execution] Parando todas as estratégias globalmente...');
    
    // Stop Cross-Market
    crossMarketService.stopAllScans();

    // Stop Arbitrage
    if (serverArbitrageInstance && serverArbitrageInstance.stopAllBackgroundArbitrage) {
        serverArbitrageInstance.stopAllBackgroundArbitrage();
    }

    // Stop Market Making
    if (serverMMInstance && serverMMInstance.stopAllBackgroundMarketMaking) {
        serverMMInstance.stopAllBackgroundMarketMaking();
    }
}

async function startAll() {
    isExecutionActive = true;
    console.log('[System Execution] Execução global ativada. Loops individuais devem ser iniciados pelo botão Executar.');
}

module.exports = {
    setInstances,
    stopAll,
    startAll,
    isActive: () => isExecutionActive,
    getArbitrageInstance: () => serverArbitrageInstance
};
