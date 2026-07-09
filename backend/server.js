const fs = require('fs/promises');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const { createArbitrageService } = require('./src/arbitrage-service');
const { createMarketMakingService } = require('./src/market-making-service');
const crossMarketService = require('./src/cross-market-service');
const { connect: connectDatabase } = require('./src/database');
const { sendJson, sendNoContent } = require('./src/http-utils');
const { normalizeExchangeId: normalizeSupportedExchangeId } = require('./src/exchange-credentials');
const { createApiRouter } = require('./src/routes');
const { createWebSocketHandlers } = require('./src/ws/handlers');
const { isMexcOversoldError, isRateLimitError } = require('./src/mexc-errors');

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
    const match = pathname.match(/^\/(binance|kraken|bybit|mexc|coinbase|gateio|okx|woo|woox)(?:\/|$)/i);

    if (!match) {
        return { exchangeId: null, relativePath: pathname };
    }

    const exchangeId = match[1].toLowerCase() === 'woox' ? 'woo' : match[1].toLowerCase();
    const remainder = pathname.slice(match[0].length);
    const relativePath = remainder ? `/${remainder.replace(/^\/+/, '')}` : '/';
    return { exchangeId, relativePath };
}

function createAppServer() {
    const services = new Map();
    const marketMakingServices = new Map();
    const publicDirs = [
        path.join(__dirname, '..', 'frontend', 'public'),
        path.join(__dirname, '..', 'public'),
        path.join(__dirname, 'public')
    ];
    const socketSubscriptions = new Map();
    const socketMarketMakingSubscriptions = new Map();
    const backgroundMarketMakingSubscriptions = new Map();
    const backgroundArbitrageSubscriptions = new Map();

    connectDatabase().catch((error) => {
        console.error('[server] Falha ao conectar ao MongoDB na inicialização:', error.message);
    });

    function invalidateServiceCaches(exchangeId) {
        if (!exchangeId) return;
        const resolvedExchangeId = normalizeSupportedExchangeId(exchangeId);
        if (services.has(resolvedExchangeId)) {
            services.delete(resolvedExchangeId);
            console.log(`[server] Cache do serviço de arbitragem invalidado para: ${resolvedExchangeId}`);
        }
        if (marketMakingServices.has(resolvedExchangeId)) {
            marketMakingServices.delete(resolvedExchangeId);
            console.log(`[server] Cache do serviço de market making invalidado para: ${resolvedExchangeId}`);
        }
    }

    async function getService(exchangeId) {
        const resolvedExchangeId = exchangeId || 'binance';

        if (!services.has(resolvedExchangeId)) {
            const servicePromise = createArbitrageService(resolvedExchangeId).catch((error) => {
                services.delete(resolvedExchangeId);
                throw error;
            });
            services.set(resolvedExchangeId, servicePromise);
        }

        return await services.get(resolvedExchangeId);
    }

    async function getMarketMakingService(exchangeId) {
        const resolvedExchangeId = exchangeId || 'binance';

        if (!marketMakingServices.has(resolvedExchangeId)) {
            const servicePromise = createMarketMakingService(resolvedExchangeId).catch((error) => {
                marketMakingServices.delete(resolvedExchangeId);
                throw error;
            });
            marketMakingServices.set(resolvedExchangeId, servicePromise);
        }

        return await marketMakingServices.get(resolvedExchangeId);
    }

    const apiRouter = createApiRouter({
        getMarketMakingService,
        getService,
        invalidateServiceCaches
    });

    function sendSocketMessage(socket, payload) {
        if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify(payload));
        }
    }

    async function pushExchangeUpdate(socket, exchangeId) {
        const service = await getService(exchangeId);
        await service.scan();
        const status = await service.getStatus();

        if (socket) {
            sendSocketMessage(socket, { type: 'exchange-update', exchangeId, payload: status });
        }

        return status;
    }

    async function pushMarketMakingUpdate(socket, exchangeId) {
        const service = await getMarketMakingService(exchangeId);
        const run = await service.run();
        const status = await service.getStatus();

        if (socket) {
            sendSocketMessage(socket, { type: 'market-making-update', exchangeId: status.exchange, payload: status });
        }

        return { run, status, config: service.getConfig() };
    }

    async function startBackgroundMarketMaking(exchangeId) {
        const resolvedExchangeId = exchangeId || 'binance';

        if (backgroundMarketMakingSubscriptions.has(resolvedExchangeId)) {
            const currentSubscription = backgroundMarketMakingSubscriptions.get(resolvedExchangeId);
            return {
                exchangeId: resolvedExchangeId,
                subscribed: true,
                intervalMs: currentSubscription.intervalMs,
                symbol: currentSubscription.symbol,
                keepListening: currentSubscription.keepListening
            };
        }

        const service = await getMarketMakingService(resolvedExchangeId);
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
                const { run } = await pushMarketMakingUpdate(null, resolvedExchangeId);

                const stopAfterSuccessInLive = run?.mode === 'live' && ['placed', 'waiting-orders'].includes(run?.execution?.status);
                const stopAfterFavorableInSimulation = run?.mode !== 'live' && run?.status === 'favorable';

                if (!subscription.keepListening && (stopAfterSuccessInLive || stopAfterFavorableInSimulation)) {
                    clearInterval(subscription.intervalId);
                    backgroundMarketMakingSubscriptions.delete(resolvedExchangeId);
                    console.log(`[market-making] loop em background encerrado para ${resolvedExchangeId}: ${stopAfterSuccessInLive ? 'live-orders-created' : 'favorable-opportunity-found'}`);
                }
            } catch (error) {
                // RATE LIMIT (429): para o loop IMEDIATAMENTE para não agravar o bloqueio
                if (isRateLimitError(error)) {
                    clearInterval(subscription.intervalId);
                    backgroundMarketMakingSubscriptions.delete(resolvedExchangeId);
                    console.error(`[market-making] RATE LIMIT (429) em ${resolvedExchangeId}. Loop em background ENCERRADO IMEDIATAMENTE para evitar bloqueio permanente. Mensagem: ${error.message}`);
                    return;
                }

                if (isMexcOversoldError(error)) {
                    console.warn(`[market-making] loop em background para ${resolvedExchangeId}: par bloqueado por Oversold MEXC (code 30005). O loop continua monitorando outros símbolos.`);
                } else {
                    console.error(`[market-making] falha no loop em background para ${resolvedExchangeId}: ${error.message}`);
                }
            } finally {
                subscription.running = false;
            }
        };

        subscription.intervalId = setInterval(() => {
            runSubscriptionCycle();
        }, subscription.intervalMs);

        backgroundMarketMakingSubscriptions.set(resolvedExchangeId, subscription);
        await runSubscriptionCycle();

        return {
            exchangeId: resolvedExchangeId,
            subscribed: true,
            intervalMs: subscription.intervalMs,
            symbol: subscription.symbol,
            keepListening: subscription.keepListening
        };
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

        const service = await getService(exchangeId);
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
        runSubscriptionCycle().catch(() => {});

        return { exchangeId, subscribed: true, intervalMs };
    }

    async function subscribeSocketToMarketMaking(socket, exchangeId) {
        const resolvedExchangeId = exchangeId || 'binance';

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

        const service = await getMarketMakingService(resolvedExchangeId);
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
        runSubscriptionCycle().catch(() => {});

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
        const resolvedExchangeId = exchangeId || 'binance';
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

    async function serveStaticFile(response, pathname) {
        const safePath = pathname === '/' ? '/index.html' : pathname;
        const normalizedPath = path.normalize(safePath).replace(/^([.][.][\\/])+/, '');

        for (const publicDir of publicDirs) {
            const filePath = path.join(publicDir, normalizedPath);

            if (!filePath.startsWith(publicDir)) {
                continue;
            }

            try {
                const file = await fs.readFile(filePath);
                response.writeHead(200, { 'Content-Type': getContentType(filePath) });
                response.end(file);
                return;
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    throw error;
                }
            }
        }

        throw Object.assign(new Error('Arquivo não encontrado.'), { code: 'ENOENT' });
    }

    const server = http.createServer(async (request, response) => {
        const requestUrl = new URL(request.url, `http://${request.headers.host}`);

        if (request.method === 'OPTIONS') {
            response.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Max-Age': '86400'
            });
            response.end();
            return;
        }

        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        try {
            const { relativePath } = parseExchangePath(requestUrl.pathname);

            if (await apiRouter.handle(request, response, requestUrl)) {
                return;
            }

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
    const webSocketHandlers = createWebSocketHandlers({
        getMarketMakingService,
        getService,
        subscribeSocketToExchange,
        subscribeSocketToMarketMaking,
        unsubscribeSocketFromExchange,
        unsubscribeSocketFromMarketMaking
    });

    webSocketServer.on('connection', (socket) => {
        console.log('[ws] cliente conectado em /ws');

        connectDatabase().catch((error) => {
            console.error('[ws] falha ao conectar ao MongoDB:', error.message);
        });

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
                const payload = await webSocketHandlers.handle(request, socket);

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

    async function startBackgroundArbitrage(exchangeId) {
        const resolvedExchangeId = exchangeId || 'binance';

        if (backgroundArbitrageSubscriptions.has(resolvedExchangeId)) {
            const currentSubscription = backgroundArbitrageSubscriptions.get(resolvedExchangeId);
            return {
                exchangeId: resolvedExchangeId,
                subscribed: true,
                intervalMs: currentSubscription.intervalMs,
                scanCount: currentSubscription.scanCount,
                maxScans: currentSubscription.maxScans
            };
        }

        const service = await getService(resolvedExchangeId);
        const config = service.getConfig();
        const subscription = {
            intervalMs: config.scanIntervalMs,
            maxScans: Number(process.env.ARBITRAGE_BACKGROUND_MAX_SCANS) || 0,
            scanCount: 0,
            intervalId: null,
            running: false
        };

        const runSubscriptionCycle = async () => {
            if (subscription.running) {
                return;
            }

            subscription.running = true;

            try {
                await pushExchangeUpdate(null, resolvedExchangeId);
                subscription.scanCount += 1;

                if (subscription.maxScans > 0 && subscription.scanCount >= subscription.maxScans) {
                    clearInterval(subscription.intervalId);
                    backgroundArbitrageSubscriptions.delete(resolvedExchangeId);
                    console.log(`[arbitrage] loop em background encerrado para ${resolvedExchangeId} apos ${subscription.scanCount} scan(s) (limite configurado).`);
                }
            } catch (error) {
                // RATE LIMIT (429): para o loop IMEDIATAMENTE para não agravar o bloqueio
                if (isRateLimitError(error)) {
                    clearInterval(subscription.intervalId);
                    backgroundArbitrageSubscriptions.delete(resolvedExchangeId);
                    console.error(`[arbitrage] RATE LIMIT (429) em ${resolvedExchangeId}. Loop em background ENCERRADO IMEDIATAMENTE para evitar bloqueio permanente. Mensagem: ${error.message}`);
                    return;
                }

                console.error(`[arbitrage] falha no loop em background para ${resolvedExchangeId}: ${error.message}`);
            } finally {
                subscription.running = false;
            }
        };

        subscription.intervalId = setInterval(() => {
            runSubscriptionCycle();
        }, subscription.intervalMs);

        backgroundArbitrageSubscriptions.set(resolvedExchangeId, subscription);
        await runSubscriptionCycle();

        return {
            exchangeId: resolvedExchangeId,
            subscribed: true,
            intervalMs: subscription.intervalMs,
            scanCount: subscription.scanCount,
            maxScans: subscription.maxScans
        };
    }

    server.startBackgroundMarketMaking = startBackgroundMarketMaking;
    server.startBackgroundArbitrage = startBackgroundArbitrage;

    return server;
}

module.exports = { createAppServer };