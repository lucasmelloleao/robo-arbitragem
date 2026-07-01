require('dotenv').config();

const { createAppServer } = require('./src/server');

const port = Number(process.env.PORT) || 3000;
const server = createAppServer();

server.listen(port, () => {
    console.log(`Frontend disponível em http://localhost:${port}`);
    console.log(`Modo atual: ${process.env.ARBITRAGE_ENABLE_LIVE_TRADING === 'true' ? 'live' : 'simulation'}`);
});