const ccxt = require('ccxt');
const fs = require('fs/promises');
const path = require('path');
const { getExchangeByAcronym, getExchangeCredentialsByAcronym } = require('./database');
const {
    getCredentialRequirementLabel,
    getExchangeCredentialConfig,
    normalizeExchangeId: normalizeSupportedExchangeId
} = require('./exchange-credentials');
const { resolveMarketMakingConfig, resolveTimeout } = require('./exchange-config');

const MAX_REALISTIC_SPREAD = 2.0;
const HIGH_LIQUIDITY_ASSETS = ['SOL', 'BTC'];

function parseNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function isHighLiquiditySpreadAnomaly(symbol, spreadPercent) {
    if (!Number.isFinite(spreadPercent) || spreadPercent <= MAX_REALISTIC_SPREAD) {
        return false;
    }

    const normalizedSymbol = String(symbol || '').toUpperCase();
    return HIGH_LIQUIDITY_ASSETS.some((asset) => normalizedSymbol.includes(asset));
}

function normalizeExchangeId(exchangeId) {
    return normalizeSupportedExchangeId(exchangeId || 'binance');
}

async function getMissingCredentialGroups(exchangeId) {
    const definition = getExchangeCredentialConfig(exchangeId).credentials;
    const credentials = await resolveExchangeCredentials(exchangeId);
    const missingGroups = [];

    for (const field of Object.keys(definition)) {
        if (!credentials[field]) {
            missingGroups.push(getCredentialRequirementLabel(exchangeId, field));
        }
    }

    return missingGroups;
}

async function resolveExchangeCredentials(exchangeId) {
    const normalizedExchangeId = normalizeExchangeId(exchangeId);
    const exchangeConfig = getExchangeCredentialConfig(normalizedExchangeId);
    const exchangeRecord = await getExchangeCredentialsByAcronym(exchangeConfig.acronym);

    const credentials = {
        apiKey: exchangeRecord?.apiKey,
        secret: exchangeRecord?.secretKey
    };

    if (exchangeConfig.credentials.password) {
        credentials.password = exchangeRecord?.password;
    }

    return credentials;
}

async function assertLiveTradingCredentials(exchangeId) {
    const missingGroups = await getMissingCredentialGroups(exchangeId);

    if (missingGroups.length > 0) {
        throw new Error(`Credenciais ausentes para ${normalizeExchangeId(exchangeId)} em modo live: ${missingGroups.join(', ')}.`);
    }
}

async function getExchangeTimeoutSettings(exchangeId) {
    const timeout = await resolveTimeout(exchangeId);
    return { timeout };
}

function shouldUsePrivateApi(config) {
    return (config?.mode || 'simulation').trim().toLowerCase() === 'live';
}

async function createExchange(exchangeId, config) {
    const normalizedExchangeId = normalizeExchangeId(exchangeId);
    const credentials = shouldUsePrivateApi(config)
        ? await resolveExchangeCredentials(normalizedExchangeId)
        : {};
    const timeoutSettings = await getExchangeTimeoutSettings(normalizedExchangeId);

    if (normalizedExchangeId === 'kraken') {
        return new ccxt.kraken({ apiKey: credentials.apiKey, secret: credentials.secret, enableRateLimit: true, ...timeoutSettings });
    }

    if (normalizedExchangeId === 'binance') {
        return new ccxt.binance({ 
            apiKey: credentials.apiKey, 
            secret: credentials.secret, 
            enableRateLimit: true, 
            ...timeoutSettings, 
            options: { 
                defaultType: 'spot', 
                adjustForTimeDifference: true,
                'recvWindow': 60000,
                fetchCurrencies: false 
            } 
        });
    }

    if (normalizedExchangeId === 'bybit') {
        return new ccxt.bybit({ apiKey: credentials.apiKey, secret: credentials.secret, enableRateLimit: true, ...timeoutSettings, options: { defaultType: 'spot' } });
    }

    if (normalizedExchangeId === 'mexc') {
        return new ccxt.mexc({ 
            apiKey: credentials.apiKey, 
            secret: credentials.secret, 
            enableRateLimit: true, 
            ...timeoutSettings, 
            options: { 
                defaultType: 'spot', 
                adjustForTimeDifference: true,
                'recvWindow': 60000,
                fetchCurrencies: false 
            } 
        });
    }

    if (normalizedExchangeId === 'coinbase') {
        return new ccxt.coinbase({ apiKey: credentials.apiKey, secret: credentials.secret, enableRateLimit: true, ...timeoutSettings, options: { fetchCurrencies: false, v2CloudAPiKey: true } });
    }

    if (normalizedExchangeId === 'gateio') {
        return new ccxt.gate({ apiKey: credentials.apiKey, secret: credentials.secret, enableRateLimit: true, ...timeoutSettings, options: { defaultType: 'spot' } });
    }

    if (normalizedExchangeId === 'okx') {
        return new ccxt.okx({ apiKey: credentials.apiKey, secret: credentials.secret, password: credentials.password, enableRateLimit: true, ...timeoutSettings, options: { defaultType: 'spot' } });
    }

    if (normalizedExchangeId === 'woo') {
        return new ccxt.woo({ apiKey: credentials.apiKey, secret: credentials.secret, enableRateLimit: true, ...timeoutSettings, options: { defaultType: 'spot' } });
    }

    throw new Error(`Exchange inválida para market making: ${normalizedExchangeId}.`);
}

function isFinalOrderStatus(status) {
    return ['closed', 'canceled', 'cancelled', 'rejected', 'expired'].includes((status || '').toLowerCase());
}

async function createMarketMakingService(exchangeId) {
    const configuredExchangeId = normalizeExchangeId(exchangeId);
    const config = await resolveMarketMakingConfig(configuredExchangeId);
    const exchange = await createExchange(configuredExchangeId, config);
    const rootDir = path.join(__dirname, '..', '..');

    config.symbol = config.symbols[0];
    config.orderSize = config.quoteBudget;
    config.opportunityLogFile = path.join(rootDir, 'logs', `market-making-opportunities-${configuredExchangeId}.jsonl`);

    if (config.mode === 'live') {
        await assertLiveTradingCredentials(configuredExchangeId);

        if (config.quoteBudget <= 0) {
            throw new Error(`MARKET_MAKING_QUOTE_BUDGET inválido para ${configuredExchangeId} em modo live.`);
        }
    }

    let latestRun = null;
    const recentRuns = [];
    let activeExecution = null;
    let currentSymbolIndex = 0;
    let currentSymbolAttempts = 0;

    function getActiveSymbol() {
        return config.symbols[currentSymbolIndex] || config.symbol;
    }

    function syncActiveSymbol() {
        config.symbol = getActiveSymbol();
        return config.symbol;
    }

    function rotateActiveSymbol(reason) {
        if (config.symbols.length <= 1) {
            return null;
        }

        const previousSymbol = getActiveSymbol();
        currentSymbolIndex = (currentSymbolIndex + 1) % config.symbols.length;
        currentSymbolAttempts = 0;
        const nextSymbol = syncActiveSymbol();

        return {
            reason,
            previousSymbol,
            nextSymbol
        };
    }

    function registerAttemptOutcome(outcome) {
        if (outcome === 'success' || outcome === 'pending') {
            currentSymbolAttempts = 0;
            return null;
        }

        currentSymbolAttempts += 1;

        if (currentSymbolAttempts < config.maxSymbolAttempts) {
            return null;
        }

        return rotateActiveSymbol('max-attempts-reached');
    }

    function getAttemptOutcome({ mode, pendingExecution, execution }) {
        if (pendingExecution) {
            return 'pending';
        }

        if (mode === 'live' && ['placed', 'waiting-orders', 'completed'].includes(execution?.status)) {
            return 'success';
        }

        return 'failed';
    }

    function attachRotationSummary(result, rotation) {
        if (!rotation) {
            return result;
        }

        result.nextSymbol = rotation.nextSymbol;
        result.summary = `${result.summary} ${config.maxSymbolAttempts} tentativa(s) sem execucao em ${rotation.previousSymbol}. Proximo ciclo usara ${rotation.nextSymbol}.`;
        return result;
    }

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

    async function fetchFreeBalances() {
        const balance = await exchange.fetchBalance();
        const market = exchange.market(config.symbol);
        const baseCurrency = market?.base || config.symbol.split('/')[0];
        const quoteCurrency = market?.quote || config.symbol.split('/')[1] || 'USDT';
        const freeBase = parseNumber(balance?.free?.[baseCurrency], 0);
        const freeQuote = parseNumber(balance?.free?.[quoteCurrency], 0);

        return {
            baseCurrency,
            quoteCurrency,
            freeBase,
            freeQuote
        };
    }

    async function resolveLiveOrderAmount(targetBid, plannedAmount) {
        const balances = await fetchFreeBalances();
        const maxBuyAmount = balances.freeQuote > 0
            ? Number(exchange.amountToPrecision(config.symbol, balances.freeQuote / targetBid))
            : 0;
        const supportedAmount = Math.min(plannedAmount, balances.freeBase, maxBuyAmount);
        const adjustedAmount = Number(exchange.amountToPrecision(config.symbol, supportedAmount));

        if (!Number.isFinite(adjustedAmount) || adjustedAmount <= 0) {
            throw new Error(
                `Saldo livre insuficiente para market making em ${config.symbol}. `
                + `Disponivel: ${balances.freeBase} ${balances.baseCurrency} e ${balances.freeQuote} ${balances.quoteCurrency}. `
                + `Necessario aproximadamente: ${plannedAmount} ${balances.baseCurrency} e ${config.quoteBudget} ${balances.quoteCurrency}.`
            );
        }

        if (adjustedAmount < plannedAmount) {
            console.warn('[market-making] ajustando quantidade por saldo disponivel:', {
                exchange: configuredExchangeId,
                symbol: config.symbol,
                plannedAmount,
                adjustedAmount,
                freeBase: balances.freeBase,
                freeQuote: balances.freeQuote,
                baseCurrency: balances.baseCurrency,
                quoteCurrency: balances.quoteCurrency
            });
        }

        return {
            amount: adjustedAmount,
            balances
        };
    }

    async function executeLiveOrders(targetBid, targetAsk) {
        const plannedAmount = getBaseAmountFromQuoteBudget(targetBid);
        const buyPrice = Number(exchange.priceToPrecision(config.symbol, targetBid));
        const sellPrice = Number(exchange.priceToPrecision(config.symbol, targetAsk));
        const params = typeof exchange.createPostOnlyOrder === 'function' || exchange.has?.createPostOnlyOrder
            ? { postOnly: true }
            : {};
        const { amount, balances } = await resolveLiveOrderAmount(targetBid, plannedAmount);

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
                sellOrder,
                balances,
                plannedAmount,
                adjustedAmount: amount
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
                    message: `Falha ao enviar a segunda ponta. A primeira ordem foi enviada e a tentativa de cancelamento foi executada. Motivo: ${error.message}`,
                    balances,
                    plannedAmount,
                    adjustedAmount: amount
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
        const activeSymbol = syncActiveSymbol();

        try {
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
            const spreadAnomalyDetected = isHighLiquiditySpreadAnomaly(config.symbol, spreadPercent);
            let status = spreadPercent >= config.minSpreadPercent ? 'favorable' : 'tight';
            let summary = status === 'favorable'
                ? 'Spread suficiente para publicar bid e ask.'
                : 'Spread apertado; aguarde melhor abertura antes de cotar.';

            if (spreadAnomalyDetected) {
                status = 'tight_or_anomaly';
                summary = 'Anomalia detectada: spread irreal para moeda de alta liquidez.';
            }
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
                configuredSymbols: [...config.symbols],
                symbolAttempt: currentSymbolAttempts + 1,
                maxSymbolAttempts: config.maxSymbolAttempts,
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
                maxRealisticSpreadPercent: MAX_REALISTIC_SPREAD,
                status: pendingExecution ? 'waiting-orders' : status,
                summary: pendingExecution
                    ? 'Ordens anteriores ainda estao abertas ou pendentes. Nenhuma nova ordem sera enviada ate a conclusao da execucao atual.'
                    : summary
            };

            if (pendingExecution) {
                result.execution = pendingExecution;
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

            const rotation = registerAttemptOutcome(getAttemptOutcome({
                mode: config.mode,
                pendingExecution,
                execution: result.execution
            }));
            attachRotationSummary(result, rotation);

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
        } catch (error) {
            const timestamp = new Date().toISOString();
            const result = attachRotationSummary({
                timestamp,
                mode: config.mode,
                exchange: configuredExchangeId,
                symbol: activeSymbol,
                configuredSymbols: [...config.symbols],
                symbolAttempt: currentSymbolAttempts + 1,
                maxSymbolAttempts: config.maxSymbolAttempts,
                status: 'error',
                summary: `Falha ao analisar ${activeSymbol} para market making.`,
                execution: {
                    status: 'error',
                    message: error.message
                }
            }, registerAttemptOutcome('failed'));

            latestRun = result;
            recentRuns.unshift(result);

            if (recentRuns.length > 10) {
                recentRuns.length = 10;
            }

            console.error('[market-making] falha ao processar ciclo:', {
                exchange: configuredExchangeId,
                symbol: activeSymbol,
                message: error.message
            });

            return result;
        }
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