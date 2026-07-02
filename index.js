require('dotenv').config();

const { createAppServer } = require('./src/server');

const port = Number(process.env.PORT) || 3000;
const server = createAppServer();

server.listen(port, () => {
    console.log(`Frontend disponível em http://localhost:${port}`);
    console.log(`Modo atual: ${process.env.ARBITRAGE_ENABLE_LIVE_TRADING === 'true' ? 'live' : 'simulation'}`);

    server.startBackgroundMarketMaking('mexc')
        .then(({ intervalMs, symbol, keepListening }) => {
            console.log(`[market-making] MEXC iniciado automaticamente no backend para ${symbol} a cada ${intervalMs}ms (${keepListening ? 'loop contínuo' : 'parada automática'}).`);
        })
        .catch((error) => {
            console.error(`[market-making] falha ao iniciar automaticamente MEXC: ${error.message}`);
        });
});