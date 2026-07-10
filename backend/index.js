require('dotenv').config({ override: true });

const { createAppServer } = require('./server');
const crossMarketService = require('./src/cross-market-service');

const PORT_ARBITRAGE = 8081;
const PORT_CROSS_MARKET = 8082;
const PORT_MM = 8083;

// Criando instâncias de servidores separadas para cada contexto/estratégia
const serverArbitrage = createAppServer({ strategy: 'arbitrage' });
const serverCrossMarket = createAppServer({ strategy: 'cross-market' });
const serverMM = createAppServer({ strategy: 'market-making' });

const systemExecutionService = require('./src/system-execution-service');
systemExecutionService.setInstances(serverArbitrage, serverMM);

// Porta 8081: Arbitragem e rotas administrativas
serverArbitrage.listen(PORT_ARBITRAGE, async () => {
    console.log(`[Arbitrage] Servidor rodando em http://localhost:${PORT_ARBITRAGE}`);
    console.log(`Modo atual: ${process.env.ARBITRAGE_ENABLE_LIVE_TRADING === 'true' ? 'live' : 'simulation'}`);

    try {
        const { getAllArbitrageStrategies } = require('./src/database');
        const strategies = await getAllArbitrageStrategies();
        const activeStrategies = (strategies || []).filter(s => s.active);
        
        activeStrategies.forEach((strategy) => {
            serverArbitrage.startBackgroundArbitrage(strategy._id)
                .then(({ intervalMs }) => {
                    console.log(`[arbitrage] Loop de background ativado automaticamente para estratégia ${strategy.name} (exch: ${strategy.exchange}) a cada ${intervalMs}ms.`);
                })
                .catch((err) => {
                    console.error(`[arbitrage] Erro ao iniciar loop automático para estratégia ${strategy.name}: ${err.message}`);
                });
        });
    } catch (err) {
        console.error('[arbitrage] Erro ao iniciar loops automáticos na inicialização:', err.message);
    }
});

// Porta 8082: Cross-Market
serverCrossMarket.listen(PORT_CROSS_MARKET, () => {
    console.log(`[Cross-Market] Servidor rodando em http://localhost:${PORT_CROSS_MARKET}`);
    
    // Inicializar o serviço Cross-Market apenas na porta correspondente
    crossMarketService.initialize().catch((error) => {
        console.error('[cross-market] falha ao inicializar servico:', error.message);
    });
});

// Porta 8083: Market Making
serverMM.listen(PORT_MM, async () => {
    console.log(`[Market Making] Servidor rodando em http://localhost:${PORT_MM}`);

    try {
        const { getAllExchanges } = require('./src/database');
        const exchanges = await getAllExchanges();
        const activeExchanges = (exchanges || []).filter(e => e.active);
        
        activeExchanges.forEach((ex) => {
            const ccxtId = ex.acronym.toLowerCase() === 'gateio' ? 'gate' : ex.acronym.toLowerCase();
            serverMM.startBackgroundMarketMaking(ccxtId)
                .then(({ intervalMs }) => {
                    console.log(`[market-making] Loop de background ativado automaticamente para ${ex.acronym} a cada ${intervalMs}ms.`);
                })
                .catch((err) => {
                    console.error(`[market-making] Erro ao iniciar loop automático para ${ex.acronym}: ${err.message}`);
                });
        });
    } catch (err) {
        console.error('[market-making] Erro ao iniciar loops automáticos na inicialização:', err.message);
    }
});
