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

function createAppServer(configOpts = {}) {
    const { strategy } = configOpts;
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

    async function getService(strategyId) {
        if (!strategyId) {
            throw new Error('strategyId é obrigatório para obter o serviço de arbitragem.');
        }

        const key = String(strategyId);

        if (!services.has(key)) {
            const servicePromise = (async () => {
                const { getArbitrageStrategyById } = require('./src/database');
                const strategy = await getArbitrageStrategyById(key);
                if (!strategy) {
                    throw new Error(`Estratégia de arbitragem ${key} não encontrada no banco.`);
                }
                return await createArbitrageService(strategy);
            })().catch((error) => {
                services.delete(key);
                throw error;
            });
            services.set(key, servicePromise);
        }

        return await services.get(key);
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

    function broadcastExchangeUpdate(strategyId, status) {
        const payload = { type: 'exchange-update', strategyId, payload: status };
        for (const [socket, subs] of socketSubscriptions.entries()) {
            if (socket.readyState === socket.OPEN && subs.has(strategyId)) {
                sendSocketMessage(socket, payload);
            }
        }
    }

    async function pushExchangeUpdate(socket, strategyId) {
        const service = await getService(strategyId);
        const status = await service.getStatus();
        status.isRunning = backgroundArbitrageSubscriptions.has(String(strategyId));

        if (socket) {
            sendSocketMessage(socket, { type: 'exchange-update', strategyId, payload: status });
        } else {
            broadcastExchangeUpdate(strategyId, status);
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
        const key = String(exchangeId);

        if (subscriptions.has(key)) {
            return { exchangeId: key, subscribed: true };
        }

        subscriptions.set(key, { active: true });

        try {
            await pushExchangeUpdate(socket, key);
        } catch (error) {
            sendSocketMessage(socket, {
                type: 'exchange-error',
                exchangeId: key,
                error: error.message
            });
        }

        return { exchangeId: key, subscribed: true };
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
        const key = String(exchangeId);

        if (!subscriptions || !subscriptions.has(key)) {
            return { exchangeId: key, subscribed: false };
        }

        subscriptions.delete(key);

        if (subscriptions.size === 0) {
            socketSubscriptions.delete(socket);
        }

        return { exchangeId: key, subscribed: false };
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
            // Filtrar rotas baseado na estratégia do servidor (separação de portas)
            if (strategy === 'cross-market' && !requestUrl.pathname.startsWith('/api/cross-market')) {
                sendJson(response, 403, { error: 'Este servidor lida apenas com requisições cross-market.' });
                return;
            }
            if (strategy === 'market-making' && !requestUrl.pathname.startsWith('/api/market-making') && !requestUrl.pathname.startsWith('/api/exchanges')) {
                sendJson(response, 403, { error: 'Este servidor lida apenas com requisições de market making.' });
                return;
            }
            if (strategy === 'arbitrage' && (requestUrl.pathname.startsWith('/api/cross-market') || requestUrl.pathname.startsWith('/api/market-making'))) {
                sendJson(response, 403, { error: 'Este servidor lida apenas com arbitragem clássica e rotas administrativas.' });
                return;
            }

            const { relativePath } = parseExchangePath(requestUrl.pathname);

            if (await apiRouter.handle(request, response, requestUrl)) {
                return;
            }

            if (request.method === 'GET') {
                try {
                    await serveStaticFile(response, relativePath);
                } catch (error) {
                    if (error.code === 'ENOENT' && !requestUrl.pathname.startsWith('/api/')) {
                        await serveStaticFile(response, '/index.html');
                    } else {
                        throw error;
                    }
                }
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

    async function startBackgroundArbitrage(strategyId) {
        if (!strategyId) {
            throw new Error('strategyId é obrigatório.');
        }

        const key = String(strategyId);

        if (backgroundArbitrageSubscriptions.has(key)) {
            const currentSubscription = backgroundArbitrageSubscriptions.get(key);
            return {
                strategyId: key,
                subscribed: true,
                intervalMs: currentSubscription.intervalMs,
                scanCount: currentSubscription.scanCount,
                maxScans: currentSubscription.maxScans
            };
        }

        const service = await getService(key);
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
                const service = await getService(key);
                await service.scan();
                await pushExchangeUpdate(null, key);
                subscription.scanCount += 1;

                if (subscription.maxScans > 0 && subscription.scanCount >= subscription.maxScans) {
                    clearInterval(subscription.intervalId);
                    backgroundArbitrageSubscriptions.delete(key);
                    console.log(`[arbitrage] loop em background encerrado para estratégia ${key} após ${subscription.scanCount} scan(s).`);
                }
            } catch (error) {
                if (isRateLimitError(error)) {
                    clearInterval(subscription.intervalId);
                    backgroundArbitrageSubscriptions.delete(key);
                    console.error(`[arbitrage] RATE LIMIT (429) na estratégia ${key}. Loop encerrado.`);
                    return;
                }

                console.error(`[arbitrage] falha no loop em background para estratégia ${key}: ${error.message}`);
            } finally {
                subscription.running = false;
            }
        };

        subscription.intervalId = setInterval(() => {
            runSubscriptionCycle();
        }, subscription.intervalMs);

        backgroundArbitrageSubscriptions.set(key, subscription);
        await runSubscriptionCycle();

        return {
            strategyId: key,
            subscribed: true,
            intervalMs: subscription.intervalMs,
            scanCount: subscription.scanCount,
            maxScans: subscription.maxScans
        };
    }

    function stopBackgroundArbitrage(strategyId) {
        const key = String(strategyId);
        const sub = backgroundArbitrageSubscriptions.get(key);
        if (sub) {
            clearInterval(sub.intervalId);
            backgroundArbitrageSubscriptions.delete(key);
            console.log(`[arbitrage] Loop de background parado para estratégia ${key}.`);
            return true;
        }
        return false;
    }

    function stopAllBackgroundArbitrage() {
        for (const [exchangeId, sub] of backgroundArbitrageSubscriptions.entries()) {
            clearInterval(sub.intervalId);
            console.log(`[arbitrage] Loop de background parado para ${exchangeId}.`);
        }
        backgroundArbitrageSubscriptions.clear();
    }

    function stopAllBackgroundMarketMaking() {
        for (const [exchangeId, sub] of backgroundMarketMakingSubscriptions.entries()) {
            clearInterval(sub.intervalId);
            console.log(`[market-making] Loop de background parado para ${exchangeId}.`);
        }
        backgroundMarketMakingSubscriptions.clear();
    }

    server.startBackgroundMarketMaking = startBackgroundMarketMaking;
    server.startBackgroundArbitrage = startBackgroundArbitrage;
    server.stopBackgroundArbitrage = stopBackgroundArbitrage;
    server.isArbitrageLoopRunning = (strategyId) => backgroundArbitrageSubscriptions.has(String(strategyId));
    server.stopAllBackgroundArbitrage = stopAllBackgroundArbitrage;
    server.stopAllBackgroundMarketMaking = stopAllBackgroundMarketMaking;

    return server;
}

module.exports = { createAppServer };