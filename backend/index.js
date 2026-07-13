require('dotenv').config({ override: true });

const { createAppServer } = require('./server');
const crossMarketService = require('./src/cross-market-service');

// Use PORT from environment (Cloud Run provides this)
const PORT = process.env.PORT || 8080;

// Determina qual estratégia iniciar baseado na variável de ambiente STRATEGY
const STRATEGY = process.env.STRATEGY || 'arbitrage';

// Criando instâncias de servidores separadas para cada contexto/estratégia
const serverArbitrage = createAppServer({ strategy: 'arbitrage' });
const serverCrossMarket = createAppServer({ strategy: 'cross-market' });
const serverMM = createAppServer({ strategy: 'market-making' });

const systemExecutionService = require('./src/system-execution-service');
systemExecutionService.setInstances(serverArbitrage, serverMM);

// Função genérica para iniciar um servidor com logging
function startServer(server, name) {
  server.listen(PORT, async () => {
    console.log(`[${name}] Servidor rodando em http://localhost:${PORT}`);
    
    // Lógica específica para cada estratégia
    if (name === 'Arbitrage') {
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
    } else if (name === 'Cross-Market') {
      // Inicializar o serviço Cross-Market apenas na porta correspondente
      crossMarketService.initialize().catch((error) => {
        console.error('[cross-market] falha ao inicializar servico:', error.message);
      });
    } else if (name === 'Market Making') {
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
    }
  });
}

// Inicia apenas a estratégia especificada na variável de ambiente STRATEGY
if (STRATEGY === 'arbitrage') {
  startServer(serverArbitrage, 'Arbitrage');
} else if (STRATEGY === 'cross-market') {
  startServer(serverCrossMarket, 'Cross-Market');
} else if (STRATEGY === 'market-making') {
  startServer(serverMM, 'Market Making');
} else {
  // Se não especificado, inicia todos (modo desenvolvimento local)
  startServer(serverArbitrage, 'Arbitrage');
  startServer(serverCrossMarket, 'Cross-Market');
  startServer(serverMM, 'Market Making');
}