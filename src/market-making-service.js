const ccxt = require('ccxt');
const fs = require('fs/promises');
const path = require('path');

function parseNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeExchangeId(exchangeId) {
    return (exchangeId || process.env.MARKET_MAKING_EXCHANGE || process.env.ARBITRAGE_EXCHANGE || 'binance').trim().toLowerCase();
}

function getFirstDefinedEnv(names) {
    for (const name of names) {
        const value = process.env[name];

        if (value) {
            return value;
        }
    }

    return undefined;
}

function getExchangeCredentialDefinition(exchangeId) {
    const normalizedExchangeId = normalizeExchangeId(exchangeId);

    const definitions = {
        kraken: {
            apiKey: ['KRAKEN_API_KEY'],
            secret: ['KRAKEN_SECRET_KEY']
        },
        binance: {
            apiKey: ['BINANCE_API_KEY'],
            secret: ['BINANCE_SECRET_KEY']
        },
        bybit: {
            apiKey: ['BYBIT_API_KEY'],
            secret: ['BYBIT_SECRET_KEY']
        },
        gateio: {
            apiKey: ['GATE_API_KEY', 'GATEIO_API_KEY'],
            secret: ['GATE_SECRET_KEY', 'GATEIO_SECRET_KEY']
        },
        okx: {
            apiKey: ['OKX_API_KEY'],
            secret: ['OKX_SECRET_KEY', 'OKX_SECRET'],
            password: ['OKX_PASSPHRASE', 'OKX_PASSWORD']
        }
    };

    const definition = definitions[normalizedExchangeId];

    if (!definition) {
        throw new Error(`Exchange inválida para market making: ${normalizedExchangeId}.`);
    }

    return definition;
}

function getMissingCredentialGroups(exchangeId) {
    const definition = getExchangeCredentialDefinition(exchangeId);
    const missingGroups = [];

    for (const names of Object.values(definition)) {
        if (!getFirstDefinedEnv(names)) {
            missingGroups.push(names.join(' ou '));
        }
    }

    return missingGroups;
}

function resolveExchangeCredentials(exchangeId) {
    const definition = getExchangeCredentialDefinition(exchangeId);
    const credentials = {};

    for (const [field, names] of Object.entries(definition)) {
        const resolvedValue = getFirstDefinedEnv(names);

        if (resolvedValue) {
            credentials[field] = resolvedValue;
        }
    }

    return credentials;
}

function assertLiveTradingCredentials(exchangeId) {
    const missingGroups = getMissingCredentialGroups(exchangeId);

    if (missingGroups.length > 0) {
        throw new Error(`Credenciais ausentes para ${normalizeExchangeId(exchangeId)} em modo live: ${missingGroups.join(', ')}.`);
    }
}

function getExchangeSetting(exchangeId, key) {
    const exchangePrefix = exchangeId.trim().toUpperCase();
    return process.env[`${exchangePrefix}_${key}`] ?? process.env[key];
}

function getMarketMakingQuoteBudgetSetting(exchangeId) {
    return getExchangeSetting(exchangeId, 'MARKET_MAKING_QUOTE_BUDGET')
        ?? getExchangeSetting(exchangeId, 'MARKET_MAKING_ORDER_SIZE');
}

function getExchangeProxySettings(exchangeId) {
    const httpProxy = getExchangeSetting(exchangeId, 'HTTP_PROXY_URL') || getExchangeSetting(exchangeId, 'HTTP_PROXY');
    const httpsProxy = getExchangeSetting(exchangeId, 'HTTPS_PROXY_URL') || getExchangeSetting(exchangeId, 'HTTPS_PROXY');
    const wsProxy = getExchangeSetting(exchangeId, 'WS_PROXY_URL') || getExchangeSetting(exchangeId, 'WS_PROXY');
    const wssProxy = getExchangeSetting(exchangeId, 'WSS_PROXY_URL') || getExchangeSetting(exchangeId, 'WSS_PROXY');

    const restProxySettings = httpsProxy
        ? { httpsProxy }
        : httpProxy
            ? { httpProxy }
            : {};

    const websocketProxySettings = wssProxy
        ? { wssProxy }
        : wsProxy
            ? { wsProxy }
            : {};

    return Object.fromEntries(
        Object.entries({ ...restProxySettings, ...websocketProxySettings }).filter(([, value]) => Boolean(value))
    );
}

function createExchange(exchangeId) {
    const normalizedExchangeId = normalizeExchangeId(exchangeId);
    const credentials = resolveExchangeCredentials(normalizedExchangeId);
    const proxySettings = getExchangeProxySettings(normalizedExchangeId);

    if (normalizedExchangeId === 'kraken') {
        return new ccxt.kraken({ apiKey: credentials.apiKey, secret: credentials.secret, enableRateLimit: true, ...proxySettings });
    }

    if (normalizedExchangeId === 'binance') {
        return new ccxt.binance({ apiKey: credentials.apiKey, secret: credentials.secret, enableRateLimit: true, ...proxySettings, options: { defaultType: 'spot', fetchCurrencies: false } });
    }

    if (normalizedExchangeId === 'bybit') {
        return new ccxt.bybit({ apiKey: credentials.apiKey, secret: credentials.secret, enableRateLimit: true, ...proxySettings, options: { defaultType: 'spot' } });
    }

    if (normalizedExchangeId === 'gateio') {
        return new ccxt.gate({ apiKey: credentials.apiKey, secret: credentials.secret, enableRateLimit: true, ...proxySettings, options: { defaultType: 'spot' } });
    }

    if (normalizedExchangeId === 'okx') {
        return new ccxt.okx({ apiKey: credentials.apiKey, secret: credentials.secret, password: credentials.password, enableRateLimit: true, ...proxySettings, options: { defaultType: 'spot' } });
    }

    throw new Error(`Exchange inválida para market making: ${normalizedExchangeId}.`);
}

function getDefaultSymbol(exchangeId) {
    return exchangeId === 'kraken' ? 'BTC/USD' : 'BTC/USDT';
}

function isFinalOrderStatus(status) {
    return ['closed', 'canceled', 'cancelled', 'rejected', 'expired'].includes((status || '').toLowerCase());
}

function createMarketMakingService(exchangeId) {
    const configuredExchangeId = normalizeExchangeId(exchangeId);
    const exchange = createExchange(configuredExchangeId);
    const rootDir = path.join(__dirname, '..');
    const config = {
        mode: (getExchangeSetting(configuredExchangeId, 'MARKET_MAKING_MODE') || 'simulation').trim().toLowerCase(),
        keepListening: getExchangeSetting(configuredExchangeId, 'MARKET_MAKING_KEEP_LISTENING') !== 'false',
        symbol: getExchangeSetting(configuredExchangeId, 'MARKET_MAKING_SYMBOL') || getDefaultSymbol(configuredExchangeId),
        orderBookDepth: Math.max(1, Math.floor(parseNumber(getExchangeSetting(configuredExchangeId, 'MARKET_MAKING_ORDER_BOOK_DEPTH'), 10))),
        quoteOffsetPercent: Math.max(0, parseNumber(getExchangeSetting(configuredExchangeId, 'MARKET_MAKING_QUOTE_OFFSET_PERCENT'), 0.03)),
        minSpreadPercent: Math.max(0, parseNumber(getExchangeSetting(configuredExchangeId, 'MARKET_MAKING_MIN_SPREAD_PERCENT'), 0.05)),
        quoteBudget: Math.max(0, parseNumber(getMarketMakingQuoteBudgetSetting(configuredExchangeId), 10)),
        updateIntervalMs: Math.max(1000, parseNumber(getExchangeSetting(configuredExchangeId, 'MARKET_MAKING_UPDATE_INTERVAL_MS'), 5000)),
        opportunityLogFile: getExchangeSetting(configuredExchangeId, 'MARKET_MAKING_OPPORTUNITY_LOG_FILE') || path.join(rootDir, 'logs', `market-making-opportunities-${configuredExchangeId}.jsonl`)
    };

    config.orderSize = config.quoteBudget;

    if (config.mode === 'live') {
        assertLiveTradingCredentials(configuredExchangeId);

        if (config.quoteBudget <= 0) {
            throw new Error(`MARKET_MAKING_QUOTE_BUDGET inválido para ${configuredExchangeId} em modo live.`);
        }
    }

    let latestRun = null;
    const recentRuns = [];
    let activeExecution = null;

    async function appendOpportunityLog(entry) {
        const logDir = path.dirname(config.opportunityLogFile);
        await fs.mkdir(logDir, { recursive: true });
        await fs.appendFile(config.opportunityLogFile, `${JSON.stringify(entry)}\n`, 'utf8');
    }

    async function readOpportunityLog(limit = 20) {
        try {
            const contents = await fs.readFile(config.opportunityLogFile, 'utf8');
            return contents
                .split(/\r?\n/)
                .filter(Boolean)
                .slice(-limit)
                .map((line) => JSON.parse(line))
                .reverse();
        } catch (error) {
            if (error.code === 'ENOENT') {
                return [];
            }

            throw error;
        }
    }

    function summarizeOrder(order) {
        return {
            id: order?.id || null,
            clientOrderId: order?.clientOrderId || null,
            status: order?.status || 'open',
            side: order?.side || null,
            type: order?.type || 'limit',
            price: order?.price ?? null,
            amount: order?.amount ?? null,
            filled: order?.filled ?? null,
            remaining: order?.remaining ?? null,
            symbol: order?.symbol || config.symbol
        };
    }

    function summarizeExecution(execution) {
        if (!execution) {
            return null;
        }

        return {
            status: execution.status,
            postOnly: execution.postOnly,
            buyOrder: summarizeOrder(execution.buyOrder),
            sellOrder: summarizeOrder(execution.sellOrder),
            lastCheckedAt: execution.lastCheckedAt || null,
            message: execution.message || null
        };
    }

    function isExecutionPending(execution) {
        if (!execution) {
            return false;
        }

        return [execution.buyOrder, execution.sellOrder]
            .filter(Boolean)
            .some((order) => !isFinalOrderStatus(order.status));
    }

    async function refreshTrackedOrder(order) {
        if (!order?.id) {
            return order;
        }

        if (exchange.has?.fetchOrder) {
            const fetchedOrder = await exchange.fetchOrder(order.id, config.symbol);
            return summarizeOrder(fetchedOrder);
        }

        if (exchange.has?.fetchOpenOrders) {
            const openOrders = await exchange.fetchOpenOrders(config.symbol);
            const matchingOrder = openOrders.find((item) => item.id === order.id);

            if (matchingOrder) {
                return summarizeOrder(matchingOrder);
            }

            return {
                ...order,
                status: isFinalOrderStatus(order.status) ? order.status : 'closed'
            };
        }

        return order;
    }

    async function refreshActiveExecution() {
        if (!activeExecution) {
            return null;
        }

        const buyOrder = await refreshTrackedOrder(activeExecution.buyOrder);
        const sellOrder = await refreshTrackedOrder(activeExecution.sellOrder);

        activeExecution = {
            ...activeExecution,
            buyOrder,
            sellOrder,
            status: isExecutionPending({ buyOrder, sellOrder }) ? 'waiting-orders' : 'completed',
            lastCheckedAt: new Date().toISOString()
        };

        if (!isExecutionPending(activeExecution)) {
            activeExecution = null;
            return null;
        }

        return summarizeExecution(activeExecution);
    }

    async function cancelTrackedOrder(order) {
        if (!order?.id || isFinalOrderStatus(order.status)) {
            return order;
        }

        if (!exchange.has?.cancelOrder) {
            return {
                ...order,
                status: order.status || 'open'
            };
        }

        const canceledOrder = await exchange.cancelOrder(order.id, config.symbol);
        return summarizeOrder(canceledOrder);
    }

    async function cancelOrderSafely(order) {
        if (!order?.id || isFinalOrderStatus(order.status)) {
            return order;
        }

        try {
            return await cancelTrackedOrder(order);
        } catch (error) {
            return {
                ...order,
                status: order.status || 'open',
                cancelError: error.message
            };
        }
    }

    async function cancelActiveExecution() {
        const refreshedExecution = await refreshActiveExecution();

        if (!refreshedExecution) {
            return {
                canceled: false,
                message: 'Nenhuma ordem pendente de market making para cancelar.',
                execution: null
            };
        }

        const buyOrder = await cancelTrackedOrder(activeExecution.buyOrder);
        const sellOrder = await cancelTrackedOrder(activeExecution.sellOrder);

        const canceledExecution = {
            ...activeExecution,
            buyOrder,
            sellOrder,
            status: 'canceled',
            lastCheckedAt: new Date().toISOString(),
            message: 'Ordens de market making canceladas manualmente.'
        };

        activeExecution = null;

        return {
            canceled: true,
            message: canceledExecution.message,
            execution: summarizeExecution(canceledExecution)
        };
    }

    async function createLiveOrder(side, amount, price, params) {
        if (typeof exchange.createPostOnlyOrder === 'function') {
            return await exchange.createPostOnlyOrder(config.symbol, 'limit', side, amount, price, params);
        }

        return await exchange.createOrder(config.symbol, 'limit', side, amount, price, params);
    }

    function getBaseAmountFromQuoteBudget(referencePrice) {
        if (!referencePrice || referencePrice <= 0) {
            throw new Error(`Preco de referencia invalido para converter ${config.quoteBudget} na moeda de cotacao em quantidade base.`);
        }

        const rawAmount = config.quoteBudget / referencePrice;
        const amount = Number(exchange.amountToPrecision(config.symbol, rawAmount));

        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error(`Nao foi possivel converter ${config.quoteBudget} na moeda de cotacao em quantidade negociavel para ${config.symbol}.`);
        }

        return amount;
    }

    async function executeLiveOrders(targetBid, targetAsk) {
        const amount = getBaseAmountFromQuoteBudget(targetBid);
        const buyPrice = Number(exchange.priceToPrecision(config.symbol, targetBid));
        const sellPrice = Number(exchange.priceToPrecision(config.symbol, targetAsk));
        const params = typeof exchange.createPostOnlyOrder === 'function' || exchange.has?.createPostOnlyOrder
            ? { postOnly: true }
            : {};

        let buyOrder = null;
        let sellOrder = null;

        try {
            buyOrder = summarizeOrder(await createLiveOrder('buy', amount, buyPrice, params));

            activeExecution = {
                status: 'placing-second-leg',
                postOnly: Boolean(params.postOnly),
                buyOrder,
                sellOrder: null,
                lastCheckedAt: new Date().toISOString(),
                message: 'Primeira ponta enviada. Aguardando envio da segunda ponta.'
            };

            sellOrder = summarizeOrder(await createLiveOrder('sell', amount, sellPrice, params));

            return {
                status: 'placed',
                postOnly: Boolean(params.postOnly),
                buyOrder,
                sellOrder
            };
        } catch (error) {
            if (buyOrder && !sellOrder) {
                const canceledBuyOrder = await cancelOrderSafely(buyOrder);

                activeExecution = {
                    status: 'error',
                    postOnly: Boolean(params.postOnly),
                    buyOrder: canceledBuyOrder,
                    sellOrder: null,
                    lastCheckedAt: new Date().toISOString(),
                    message: `Falha ao enviar a segunda ponta. A primeira ordem foi enviada e a tentativa de cancelamento foi executada. Motivo: ${error.message}`
                };

                throw Object.assign(new Error(error.message), {
                    partialExecution: summarizeExecution(activeExecution)
                });
            }

            activeExecution = null;
            throw error;
        }
    }

    async function run() {
        await exchange.loadMarkets();

        if (!exchange.markets[config.symbol]) {
            throw new Error(`O par ${config.symbol} não está disponível em ${configuredExchangeId}.`);
        }

        const orderBook = await exchange.fetchOrderBook(config.symbol, config.orderBookDepth);
        const bestBid = orderBook?.bids?.[0];
        const bestAsk = orderBook?.asks?.[0];

        if (!Array.isArray(bestBid) || !Array.isArray(bestAsk)) {
            throw new Error(`Livro insuficiente para market making em ${config.symbol}.`);
        }

        const bidPrice = bestBid[0];
        const askPrice = bestAsk[0];
        const midPrice = (bidPrice + askPrice) / 2;
        const spreadPercent = midPrice > 0 ? ((askPrice - bidPrice) / midPrice) * 100 : 0;
        const targetBid = bidPrice * (1 - (config.quoteOffsetPercent / 100));
        const targetAsk = askPrice * (1 + (config.quoteOffsetPercent / 100));
        const status = spreadPercent >= config.minSpreadPercent ? 'favorable' : 'tight';
        const timestamp = new Date().toISOString();
        const market = exchange.market(config.symbol);
        const quoteBudget = Number(exchange.costToPrecision(config.symbol, config.quoteBudget));
        const estimatedBaseAmount = getBaseAmountFromQuoteBudget(targetBid);
        const pendingExecution = config.mode === 'live' ? await refreshActiveExecution() : null;

        const result = {
            timestamp,
            mode: config.mode,
            exchange: configuredExchangeId,
            symbol: config.symbol,
            baseCurrency: market?.base || config.symbol.split('/')[0],
            quoteCurrency: market?.quote || config.symbol.split('/')[1] || 'USDT',
            bestBid: bidPrice,
            bestAsk: askPrice,
            bestBidVolume: bestBid[1],
            bestAskVolume: bestAsk[1],
            midPrice,
            spreadPercent,
            targetBid,
            targetAsk,
            orderSize: config.quoteBudget,
            quoteBudget,
            estimatedBaseAmount,
            quoteOffsetPercent: config.quoteOffsetPercent,
            minSpreadPercent: config.minSpreadPercent,
            status: pendingExecution ? 'waiting-orders' : status,
            summary: status === 'favorable'
                ? 'Spread suficiente para publicar bid e ask.'
                : 'Spread apertado; aguarde melhor abertura antes de cotar.'
        };

        if (pendingExecution) {
            result.execution = pendingExecution;
            result.summary = 'Ordens anteriores ainda estao abertas ou pendentes. Nenhuma nova ordem sera enviada ate a conclusao da execucao atual.';
        }

        if (!pendingExecution && status === 'favorable' && config.mode === 'live') {
            try {
                result.execution = await executeLiveOrders(targetBid, targetAsk);
                activeExecution = {
                    ...result.execution,
                    buyOrder: summarizeOrder(result.execution.buyOrder),
                    sellOrder: summarizeOrder(result.execution.sellOrder),
                    status: 'waiting-orders',
                    lastCheckedAt: new Date().toISOString()
                };
                result.execution = summarizeExecution(activeExecution);
                result.summary = 'Spread suficiente e ordens live enviadas com sucesso.';
            } catch (error) {
                result.execution = error.partialExecution || {
                    status: 'error',
                    message: error.message
                };
                result.summary = 'Spread suficiente, mas houve falha ao enviar ordens live.';
                console.error('[market-making] falha ao enviar ordens live:', error.message);
            }
        }

        if (!pendingExecution && status === 'favorable' && config.mode !== 'live') {
            result.execution = {
                status: 'simulation',
                message: 'Modo simulation: nenhuma ordem real enviada.'
            };
        }

        if (status === 'favorable') {
            console.log('[market-making] oportunidade favoravel encontrada:', {
                timestamp,
                exchange: configuredExchangeId,
                mode: config.mode,
                symbol: config.symbol,
                spreadPercent,
                minSpreadPercent: config.minSpreadPercent,
                targetBid,
                targetAsk,
                quoteBudget: config.quoteBudget,
                executionStatus: result.execution?.status || 'not-applicable'
            });

            await appendOpportunityLog(result);
        }

        latestRun = result;
        recentRuns.unshift(result);

        if (recentRuns.length > 10) {
            recentRuns.length = 10;
        }

        return result;
    }

    async function getStatus() {
        const trackedExecution = await refreshActiveExecution();
        const favorableOpportunities = await readOpportunityLog();

        return {
            exchange: configuredExchangeId,
            latestRun,
            activeExecution: trackedExecution,
            recentRuns,
            favorableOpportunities,
            configuration: { ...config }
        };
    }

    return {
        run,
        cancelActiveExecution,
        getStatus,
        getConfig: () => ({ ...config })
    };
}

module.exports = { createMarketMakingService };