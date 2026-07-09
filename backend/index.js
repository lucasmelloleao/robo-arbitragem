require('dotenv').config();

const { createAppServer } = require('./server');
const crossMarketService = require('./src/cross-market-service');

const port = 8081;
const server = createAppServer();

server.listen(port, () => {
    console.log(`Frontend disponível em http://localhost:${port}`);
    console.log(`Modo atual: ${process.env.ARBITRAGE_ENABLE_LIVE_TRADING === 'true' ? 'live' : 'simulation'}`);



    // Inicializar Cross-Market Service (independente de arbitrage e MM)
    crossMarketService.initialize().catch((error) => {
        console.error('[cross-market] falha ao inicializar servico:', error.message);
    });



    /*
    
        //const exchanges = ['binance', 'kraken', 'bybit', 'mexc', 'coinbase', 'gateio', 'okx', 'woo'];
        const exchanges = [ 'mexc'];
    
        exchanges.forEach((exchangeId) => {
            server.startBackgroundArbitrage(exchangeId)
                .then(({ intervalMs, scanCount, maxScans }) => {
                    const limitInfo = maxScans > 0 ? ` (limite de ${maxScans} scan(s))` : '';
                    console.log(`[arbitrage] ${exchangeId.toUpperCase()} iniciado automaticamente no backend a cada ${intervalMs}ms${limitInfo}.`);
                })
                .catch((error) => {
                    console.error(`[arbitrage] falha ao iniciar automaticamente ${exchangeId.toUpperCase()}: ${error.message}`);
                });
        });
        */
});
