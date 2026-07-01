const fs = require('fs/promises');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const { createArbitrageService } = require('./arbitrage-service');
const { createMarketMakingService } = require('./market-making-service');

function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(payload));
}

function getContentType(filePath) {
    const extension = path.extname(filePath).toLowerCase();

    if (extension === '.css') {
        return 'text/css; charset=utf-8';
    }

    if (extension === '.js') {
        return 'application/javascript; charset=utf-8';
    }

    return 'text/html; charset=utf-8';
}

function parseExchangePath(pathname) {
    const match = pathname.match(/^\/(binance|kraken|bybit|coinbase|gateio|okx)(?:\/|$)/i);

    if (!match) {
        return { exchangeId: null, relativePath: pathname };
    }

    const exchangeId = match[1].toLowerCase();
    const remainder = pathname.slice(match[0].length);
    const relativePath = remainder ? `/${remainder.replace(/^\/+/, '')}` : '/';
    return { exchangeId, relativePath };
}

function createAppServer() {
    const services = new Map();
    const marketMakingServices = new Map();
    const publicDir = path.join(__dirname, '..', 'public');
    const socketSubscriptions = new Map();
    const socketMarketMakingSubscriptions = new Map();

    function getService(exchangeId) {
        const resolvedExchangeId = exchangeId || (process.env.ARBITRAGE_EXCHANGE || 'binance').trim().toLowerCase();

        if (!services.has(resolvedExchangeId)) {
            services.set(resolvedExchangeId, createArbitrageService(resolvedExchangeId));
        }

        return services.get(resolvedExchangeId);
    }

    function getMarketMakingService(exchangeId) {
        const resolvedExchangeId = exchangeId || (process.env.MARKET_MAKING_EXCHANGE || process.env.ARBITRAGE_EXCHANGE || 'binance').trim().toLowerCase();

        if (!marketMakingServices.has(resolvedExchangeId)) {
            marketMakingServices.set(resolvedExchangeId, createMarketMakingService(resolvedExchangeId));
        }

        return marketMakingServices.get(resolvedExchangeId);
    }

    function sendSocketMessage(socket, payload) {
        if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify(payload));
        }
    }

    async function pushExchangeUpdate(socket, exchangeId) {
        const service = getService(exchangeId);
        await service.scan();
        const status = await service.getStatus();
        sendSocketMessage(socket, { type: 'exchange-update', exchangeId, payload: status });
    }

    async function pushMarketMakingUpdate(socket, exchangeId) {
        const service = getMarketMakingService(exchangeId);
        const run = await service.run();
        const status = await service.getStatus();
        sendSocketMessage(socket, { type: 'market-making-update', exchangeId: status.exchange, payload: status });
        return { run, status, config: service.getConfig() };
    }

    function getSocketExchangeSubscriptions(socket) {
        if (!socketSubscriptions.has(socket)) {
            socketSubscriptions.set(socket, new Map());
        }

        return socketSubscriptions.get(socket);
    }

    function clearSocketSubscriptions(socket) {
        const subscriptions = socketSubscriptions.get(socket);

        if (!subscriptions) {
            return;
        }

        for (const subscription of subscriptions.values()) {
            clearInterval(subscription.intervalId);
        }

        socketSubscriptions.delete(socket);
    }

    function clearSocketMarketMakingSubscriptions(socket) {
        const subscriptions = socketMarketMakingSubscriptions.get(socket);

        if (!subscriptions) {
            return;
        }

        for (const subscription of subscriptions.values()) {
            clearInterval(subscription.intervalId);
        }

        socketMarketMakingSubscriptions.delete(socket);
    }

    async function subscribeSocketToExchange(socket, exchangeId) {
        const subscriptions = getSocketExchangeSubscriptions(socket);

        if (subscriptions.has(exchangeId)) {
            return { exchangeId, subscribed: true, intervalMs: subscriptions.get(exchangeId).intervalMs };
        }

        const service = getService(exchangeId);
        const intervalMs = service.getConfig().scanIntervalMs;
        const subscription = {
            intervalMs,
            intervalId: null,
            running: false
        };

        const runSubscriptionCycle = async () => {
            if (subscription.running) {
                return;
            }

            subscription.running = true;

            try {
                await pushExchangeUpdate(socket, exchangeId);
            } catch (error) {
                sendSocketMessage(socket, {
                    type: 'exchange-error',
                    exchangeId,
                    error: error.message
                });
            } finally {
                subscription.running = false;
            }
        };

        subscription.intervalId = setInterval(() => {
            runSubscriptionCycle();
        }, intervalMs);

        subscriptions.set(exchangeId, subscription);
        await runSubscriptionCycle();

        return { exchangeId, subscribed: true, intervalMs };
    }

    async function subscribeSocketToMarketMaking(socket, exchangeId) {
        const resolvedExchangeId = exchangeId || (process.env.MARKET_MAKING_EXCHANGE || process.env.ARBITRAGE_EXCHANGE || 'binance').trim().toLowerCase();

        if (!socketMarketMakingSubscriptions.has(socket)) {
            socketMarketMakingSubscriptions.set(socket, new Map());
        }

        const subscriptions = socketMarketMakingSubscriptions.get(socket);

        if (subscriptions.has(resolvedExchangeId)) {
            const currentSubscription = subscriptions.get(resolvedExchangeId);
            return {
                exchangeId: resolvedExchangeId,
                subscribed: true,
                intervalMs: currentSubscription.intervalMs,
                symbol: currentSubscription.symbol,
                keepListening: currentSubscription.keepListening
            };
        }

        const service = getMarketMakingService(resolvedExchangeId);
        const config = service.getConfig();
        const subscription = {
            intervalMs: config.updateIntervalMs,
            symbol: config.symbol,
            keepListening: config.keepListening,
            intervalId: null,
            running: false
        };

        const runSubscriptionCycle = async () => {
            if (subscription.running) {
                return;
            }

            subscription.running = true;

            try {
                const { run } = await pushMarketMakingUpdate(socket, resolvedExchangeId);

                const stopAfterSuccessInLive = run?.mode === 'live' && ['placed', 'waiting-orders'].includes(run?.execution?.status);
                const stopAfterFavorableInSimulation = run?.mode !== 'live' && run?.status === 'favorable';

                if (!subscription.keepListening && (stopAfterSuccessInLive || stopAfterFavorableInSimulation)) {
                    clearInterval(subscription.intervalId);
                    subscriptions.delete(resolvedExchangeId);

                    if (subscriptions.size === 0) {
                        socketMarketMakingSubscriptions.delete(socket);
                    }

                    sendSocketMessage(socket, {
                        type: 'market-making-stopped',
                        exchangeId: resolvedExchangeId,
                        reason: stopAfterSuccessInLive ? 'live-orders-created' : 'favorable-opportunity-found'
                    });
                }
            } catch (error) {
                sendSocketMessage(socket, {
                    type: 'market-making-error',
                    exchangeId: resolvedExchangeId,
                    error: error.message
                });
            } finally {
                subscription.running = false;
            }
        };

        subscription.intervalId = setInterval(() => {
            runSubscriptionCycle();
        }, subscription.intervalMs);

        subscriptions.set(resolvedExchangeId, subscription);
        await runSubscriptionCycle();

        return {
            exchangeId: resolvedExchangeId,
            subscribed: true,
            intervalMs: subscription.intervalMs,
            symbol: subscription.symbol,
            keepListening: subscription.keepListening
        };
    }

    function unsubscribeSocketFromExchange(socket, exchangeId) {
        const subscriptions = socketSubscriptions.get(socket);

        if (!subscriptions || !subscriptions.has(exchangeId)) {
            return { exchangeId, subscribed: false };
        }

        clearInterval(subscriptions.get(exchangeId).intervalId);
        subscriptions.delete(exchangeId);

        if (subscriptions.size === 0) {
            socketSubscriptions.delete(socket);
        }

        return { exchangeId, subscribed: false };
    }

    function unsubscribeSocketFromMarketMaking(socket, exchangeId) {
        const resolvedExchangeId = exchangeId || (process.env.MARKET_MAKING_EXCHANGE || process.env.ARBITRAGE_EXCHANGE || 'binance').trim().toLowerCase();
        const subscriptions = socketMarketMakingSubscriptions.get(socket);

        if (!subscriptions || !subscriptions.has(resolvedExchangeId)) {
            return { exchangeId: resolvedExchangeId, subscribed: false };
        }

        clearInterval(subscriptions.get(resolvedExchangeId).intervalId);
        subscriptions.delete(resolvedExchangeId);

        if (subscriptions.size === 0) {
            socketMarketMakingSubscriptions.delete(socket);
        }

        return { exchangeId: resolvedExchangeId, subscribed: false };
    }

    async function handleSocketRequest(message) {
        const { action, exchangeId } = message || {};

        if (action === 'market-making-status') {
            return await getMarketMakingService(exchangeId).getStatus();
        }

        if (action === 'market-making-run') {
            const service = getMarketMakingService(exchangeId);
            const run = await service.run();
            const status = await service.getStatus();
            return { run, status };
        }

        if (action === 'market-making-cancel') {
            const service = getMarketMakingService(exchangeId);
            const cancellation = await service.cancelActiveExecution();
            const status = await service.getStatus();
            return { cancellation, status };
        }

        if (action === 'market-making-subscribe') {
            return { exchangeId, action };
        }

        if (action === 'market-making-unsubscribe') {
            return { exchangeId, action };
        }

        const service = getService(exchangeId);

        if (action === 'status') {
            return await service.getStatus();
        }

        if (action === 'logs') {
            return { logs: await service.readLogs(30) };
        }

        if (action === 'scan') {
            const scan = await service.scan();
            return { scan, logs: await service.readLogs(10) };
        }

        if (action === 'subscribe') {
            return { exchangeId, action };
        }

        if (action === 'unsubscribe') {
            return { exchangeId, action };
        }

        throw new Error('Ação WebSocket não suportada.');
    }

    async function serveStaticFile(response, pathname) {
        const safePath = pathname === '/' ? '/index.html' : pathname;
        const normalizedPath = path.normalize(safePath).replace(/^([.][.][\\/])+/, '');
        const filePath = path.join(publicDir, normalizedPath);

        if (!filePath.startsWith(publicDir)) {
            sendJson(response, 403, { error: 'Acesso negado.' });
            return;
        }

        const file = await fs.readFile(filePath);
        response.writeHead(200, { 'Content-Type': getContentType(filePath) });
        response.end(file);
    }

    const server = http.createServer(async (request, response) => {
        try {
            const url = new URL(request.url, `http://${request.headers.host}`);
            const { relativePath } = parseExchangePath(url.pathname);

            if (request.method === 'GET') {
                await serveStaticFile(response, relativePath);
                return;
            }

            sendJson(response, 405, { error: 'Método não suportado.' });
        } catch (error) {
            if (error.code === 'ENOENT') {
                sendJson(response, 404, { error: 'Arquivo não encontrado.' });
                return;
            }

            console.error('Erro ao processar requisição:', error.message);
            sendJson(response, 500, { error: error.message });
        }
    });

    const webSocketServer = new WebSocketServer({ server, path: '/ws' });

    webSocketServer.on('connection', (socket) => {
        console.log('[ws] cliente conectado em /ws');

        socket.on('message', async (rawMessage) => {
            let request;

            try {
                request = JSON.parse(rawMessage.toString('utf8'));
            } catch (error) {
                socket.send(JSON.stringify({ ok: false, error: 'Mensagem WebSocket inválida.' }));
                return;
            }

            console.log('[ws] mensagem recebida do cliente:', request);

            try {
                let payload;

                if (request.action === 'subscribe') {
                    payload = await subscribeSocketToExchange(socket, request.exchangeId);
                } else if (request.action === 'unsubscribe') {
                    payload = unsubscribeSocketFromExchange(socket, request.exchangeId);
                } else if (request.action === 'market-making-subscribe') {
                    payload = await subscribeSocketToMarketMaking(socket, request.exchangeId);
                } else if (request.action === 'market-making-unsubscribe') {
                    payload = unsubscribeSocketFromMarketMaking(socket, request.exchangeId);
                } else {
                    payload = await handleSocketRequest(request);
                }

                const response = { requestId: request.requestId, ok: true, payload };
                console.log('[ws] resposta enviada ao cliente:', {
                    requestId: request.requestId,
                    action: request.action,
                    exchangeId: request.exchangeId,
                    ok: true
                });
                socket.send(JSON.stringify(response));
            } catch (error) {
                console.log('[ws] resposta com erro enviada ao cliente:', {
                    requestId: request.requestId,
                    action: request.action,
                    exchangeId: request.exchangeId,
                    ok: false,
                    error: error.message
                });
                socket.send(JSON.stringify({ requestId: request.requestId, ok: false, error: error.message }));
            }
        });

        socket.on('close', () => {
            clearSocketSubscriptions(socket);
            clearSocketMarketMakingSubscriptions(socket);
            console.log('[ws] cliente desconectado de /ws');
        });
    });

    return server;
}

module.exports = { createAppServer };