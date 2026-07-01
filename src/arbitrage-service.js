const ccxt = require('ccxt');
const fs = require('fs/promises');
const path = require('path');

function parseAssetList(envValue, fallback) {
    if (!envValue) {
        return fallback;
    }

    const items = envValue
        .split(',')
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean);

    return items.length > 0 ? items : fallback;
}

function parseNumber(envValue, fallback) {
    const parsed = Number(envValue);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeExchangeId(exchangeId) {
    return (exchangeId || process.env.ARBITRAGE_EXCHANGE || 'binance').trim().toLowerCase();
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
        throw new Error(`Exchange inválida: ${normalizedExchangeId}. Use "binance", "kraken", "bybit", "gateio" ou "okx".`);
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

        if (!resolvedValue) {
            continue;
        }

        credentials[field] = resolvedValue;
    }

    return credentials;
}

function assertLiveTradingCredentials(exchangeId) {
    const missingGroups = getMissingCredentialGroups(exchangeId);

    if (missingGroups.length > 0) {
        throw new Error(`Credenciais ausentes para ${normalizeExchangeId(exchangeId)} em modo live: ${missingGroups.join(', ')}.`);
    }
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
        return new ccxt.kraken({
            apiKey: credentials.apiKey,
            secret: credentials.secret,
            enableRateLimit: true,
            ...proxySettings
        });
    }

    if (normalizedExchangeId === 'binance') {
        return new ccxt.binance({
            apiKey: credentials.apiKey,
            secret: credentials.secret,
            enableRateLimit: true,
            ...proxySettings,
            options: {
                defaultType: 'spot'
            }
        });
    }

    if (normalizedExchangeId === 'bybit') {
        return new ccxt.bybit({
            apiKey: credentials.apiKey,
            secret: credentials.secret,
            enableRateLimit: true,
            ...proxySettings,
            options: {
                defaultType: 'spot'
            }
        });
    }

    if (normalizedExchangeId === 'gateio') {
        return new ccxt.gate({
            apiKey: credentials.apiKey,
            secret: credentials.secret,
            enableRateLimit: true,
            ...proxySettings,
            options: {
                defaultType: 'spot'
            }
        });
    }

    if (normalizedExchangeId === 'okx') {
        return new ccxt.okx({
            apiKey: credentials.apiKey,
            secret: credentials.secret,
            password: credentials.password,
            enableRateLimit: true,
            ...proxySettings,
            options: {
                defaultType: 'spot'
            }
        });
    }

    throw new Error(`Exchange inválida: ${normalizedExchangeId}. Use "binance", "kraken", "bybit", "gateio" ou "okx".`);
}

function getExchangeSetting(exchangeId, key) {
    const exchangePrefix = exchangeId.trim().toUpperCase();
    return process.env[`${exchangePrefix}_${key}`] ?? process.env[key];
}

function createArbitrageService(exchangeId) {
    const rootDir = path.join(__dirname, '..');
    const configuredExchangeId = normalizeExchangeId(exchangeId);
    const exchange = createExchange(exchangeId);

    const BASE_DEFAULTS = {
        startAssets: ['USDT' ],
        bridgeAssets: ['BTC', 'ETH'],
        targetAssets: ['ETH'],
        investmentAmount: 10000,
        tradingFee: 0.001,
        scanIntervalMs: 3000,
        maxTrianglesPerCycle: 8,
        orderBookDepth: 5,
        maxSpreadPercent: 0.4,
        minVolumeBuffer: 1.05,
        minProfitPercent: 0.1,
        maxSlippagePercent: 0.3,
        opportunityLogFile: path.join(rootDir, 'logs', 'arbitrage-opportunities.jsonl')
    };

    const EXCHANGE_DEFAULTS = {
        kraken: {
            startAssets: ['USD'],
            bridgeAssets: ['BTC', 'ETH'],
            targetAssets: ['ETH'],
            investmentAmount: 100,
            tradingFee: 0.004,
            scanIntervalMs: 5000,
            maxTrianglesPerCycle: 6,
            orderBookDepth: 10,
            maxSpreadPercent: 0.25,
            minVolumeBuffer: 1.1,
            minProfitPercent: 0.3,
            maxSlippagePercent: 0.2,
            opportunityLogFile: path.join(rootDir, 'logs', 'arbitrage-opportunities.jsonl')
        },
        binance: {
            startAssets: ['USDT'],
            bridgeAssets: ['BTC', 'ETH'],
            targetAssets: ['ETH'],
            investmentAmount: 100,
            tradingFee: 0.001,
            scanIntervalMs: 3000,
            maxTrianglesPerCycle: 8,
            orderBookDepth: 10,
            maxSpreadPercent: 0.2,
            minVolumeBuffer: 1.05,
            minProfitPercent: 0.1,
            maxSlippagePercent: 0.15,
            opportunityLogFile: path.join(rootDir, 'logs', 'arbitrage-opportunities.jsonl')
        },
        bybit: {
            startAssets: ['USDT'],
            bridgeAssets: ['BTC', 'ETH'],
            targetAssets: ['ETH'],
            investmentAmount: 100,
            tradingFee: 0.001,
            scanIntervalMs: 3000,
            maxTrianglesPerCycle: 8,
            orderBookDepth: 10,
            maxSpreadPercent: 0.2,
            minVolumeBuffer: 1.05,
            minProfitPercent: 0.1,
            maxSlippagePercent: 0.15,
            opportunityLogFile: path.join(rootDir, 'logs', 'arbitrage-opportunities-bybit.jsonl')
        },
        gateio: {
            startAssets: ['USDT'],
            bridgeAssets: ['BTC', 'ETH'],
            targetAssets: ['ETH'],
            investmentAmount: 100,
            tradingFee: 0.001,
            scanIntervalMs: 3000,
            maxTrianglesPerCycle: 8,
            orderBookDepth: 10,
            maxSpreadPercent: 0.2,
            minVolumeBuffer: 1.05,
            minProfitPercent: 0.1,
            maxSlippagePercent: 0.15,
            opportunityLogFile: path.join(rootDir, 'logs', 'arbitrage-opportunities-gateio.jsonl')
        },
        okx: {
            startAssets: ['USDT'],
            bridgeAssets: ['BTC', 'ETH'],
            targetAssets: ['ETH'],
            investmentAmount: 100,
            tradingFee: 0.001,
            scanIntervalMs: 3000,
            maxTrianglesPerCycle: 8,
            orderBookDepth: 10,
            maxSpreadPercent: 0.2,
            minVolumeBuffer: 1.05,
            minProfitPercent: 0.1,
            maxSlippagePercent: 0.15,
            opportunityLogFile: path.join(rootDir, 'logs', 'arbitrage-opportunities-okx.jsonl')
        }
    };

    const defaults = {
        ...BASE_DEFAULTS,
        ...(EXCHANGE_DEFAULTS[configuredExchangeId] || {})
    };

    const envConfig = {
        startAssets: getExchangeSetting(configuredExchangeId, 'ARBITRAGE_START_ASSETS'),
        bridgeAssets: getExchangeSetting(configuredExchangeId, 'ARBITRAGE_BRIDGE_ASSETS'),
        targetAssets: getExchangeSetting(configuredExchangeId, 'ARBITRAGE_TARGET_ASSETS'),
        investmentAmount: getExchangeSetting(configuredExchangeId, 'ARBITRAGE_INVESTMENT_AMOUNT'),
        tradingFee: getExchangeSetting(configuredExchangeId, 'ARBITRAGE_TRADING_FEE'),
        scanIntervalMs: getExchangeSetting(configuredExchangeId, 'ARBITRAGE_SCAN_INTERVAL_MS'),
        maxTrianglesPerCycle: getExchangeSetting(configuredExchangeId, 'ARBITRAGE_MAX_TRIANGLES_PER_CYCLE'),
        orderBookDepth: getExchangeSetting(configuredExchangeId, 'ARBITRAGE_ORDER_BOOK_DEPTH'),
        maxSpreadPercent: getExchangeSetting(configuredExchangeId, 'ARBITRAGE_MAX_SPREAD_PERCENT'),
        minVolumeBuffer: getExchangeSetting(configuredExchangeId, 'ARBITRAGE_MIN_VOLUME_BUFFER'),
        minProfitPercent: getExchangeSetting(configuredExchangeId, 'ARBITRAGE_MIN_PROFIT_PERCENT'),
        maxSlippagePercent: getExchangeSetting(configuredExchangeId, 'ARBITRAGE_MAX_SLIPPAGE_PERCENT'),
        enableLiveTrading: getExchangeSetting(configuredExchangeId, 'ARBITRAGE_ENABLE_LIVE_TRADING'),
        opportunityLogFile: getExchangeSetting(configuredExchangeId, 'ARBITRAGE_OPPORTUNITY_LOG_FILE')
    };

    const config = {
        startAssets: parseAssetList(envConfig.startAssets, defaults.startAssets),
        bridgeAssets: parseAssetList(envConfig.bridgeAssets, defaults.bridgeAssets),
        targetAssets: parseAssetList(envConfig.targetAssets, defaults.targetAssets),
        investmentAmount: parseNumber(envConfig.investmentAmount, defaults.investmentAmount),
        tradingFee: parseNumber(envConfig.tradingFee, defaults.tradingFee),
        scanIntervalMs: Math.max(1000, parseNumber(envConfig.scanIntervalMs, defaults.scanIntervalMs)),
        maxTrianglesPerCycle: Math.max(1, Math.floor(parseNumber(envConfig.maxTrianglesPerCycle, defaults.maxTrianglesPerCycle))),
        orderBookDepth: Math.max(1, Math.floor(parseNumber(envConfig.orderBookDepth, defaults.orderBookDepth))),
        maxSpreadPercent: Math.max(0, parseNumber(envConfig.maxSpreadPercent, defaults.maxSpreadPercent)),
        minVolumeBuffer: Math.max(1, parseNumber(envConfig.minVolumeBuffer, defaults.minVolumeBuffer)),
        minProfitPercent: parseNumber(envConfig.minProfitPercent, defaults.minProfitPercent),
        maxSlippagePercent: Math.max(0, parseNumber(envConfig.maxSlippagePercent, defaults.maxSlippagePercent)),
        enableLiveTrading: envConfig.enableLiveTrading === 'true',
        opportunityLogFile: envConfig.opportunityLogFile || defaults.opportunityLogFile
    };

    if (config.enableLiveTrading) {
        assertLiveTradingCredentials(configuredExchangeId);
    }

    let monitoredTriangles = [];
    let isChecking = false;
    let triangleCursor = 0;
    let isInitialized = false;
    let initializationPromise = null;
    let latestScanResult = null;
    const recentScans = [];

    function getMarket(symbol) {
        return exchange.market(symbol);
    }

    function getMinAmount(symbol) {
        const market = getMarket(symbol);
        return market?.limits?.amount?.min ?? 0;
    }

    function getCostFromTopOfBook(orderBook, side, amount) {
        const levels = orderBook?.[side];

        if (!Array.isArray(levels) || levels.length === 0) {
            return null;
        }

        let remaining = amount;
        let totalCost = 0;

        for (const [price, levelAmount] of levels) {
            if (remaining <= 0) {
                break;
            }

            const filledAmount = Math.min(remaining, levelAmount);
            totalCost += filledAmount * price;
            remaining -= filledAmount;
        }

        return remaining > 0 ? null : totalCost;
    }

    function getAverageExecutionPrice(orderBook, side, amount) {
        const totalCost = getCostFromTopOfBook(orderBook, side, amount);

        if (totalCost === null || amount <= 0) {
            return null;
        }

        return totalCost / amount;
    }

    function getSlippagePercent(referencePrice, executedPrice) {
        if (!referencePrice || !executedPrice) {
            return null;
        }

        return Math.abs(((executedPrice - referencePrice) / referencePrice) * 100);
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

    async function validateBalances(triangle) {
        const balance = await exchange.fetchBalance();
        const freeAmount = balance?.free?.[triangle.startAsset] ?? 0;

        if (freeAmount < config.investmentAmount) {
            throw new Error(`Saldo insuficiente em ${triangle.startAsset}. Livre: ${freeAmount}, necessário: ${config.investmentAmount}`);
        }

        return balance;
    }

    function validateTradeSizes(triangle, amountBridge, amountTarget) {
        const minAmountPair1 = getMinAmount(triangle.pair1);
        const minAmountPair2 = getMinAmount(triangle.pair2);
        const minAmountPair3 = getMinAmount(triangle.pair3);

        if (amountBridge < minAmountPair1) {
            throw new Error(`Volume calculado abaixo do mínimo de ${triangle.pair1}: ${amountBridge} < ${minAmountPair1}`);
        }

        if (amountTarget < minAmountPair2) {
            throw new Error(`Volume calculado abaixo do mínimo de ${triangle.pair2}: ${amountTarget} < ${minAmountPair2}`);
        }

        if (amountTarget < minAmountPair3) {
            throw new Error(`Volume calculado abaixo do mínimo de ${triangle.pair3}: ${amountTarget} < ${minAmountPair3}`);
        }
    }

    function validateExecutionPlan(result) {
        if (result.percentage < config.minProfitPercent) {
            throw new Error(`Lucro estimado abaixo do mínimo configurado: ${result.percentage.toFixed(4)}% < ${config.minProfitPercent.toFixed(4)}%`);
        }

        const maxObservedSlippage = Math.max(...result.slippages);

        if (maxObservedSlippage > config.maxSlippagePercent) {
            throw new Error(`Slippage estimado acima do máximo permitido: ${maxObservedSlippage.toFixed(4)}% > ${config.maxSlippagePercent.toFixed(4)}%`);
        }

        validateTradeSizes(result.triangle, result.amountBridge, result.amountTarget);
    }

    async function assertOrderFilled(order, symbol) {
        const status = order?.status;

        if (status && status !== 'closed') {
            throw new Error(`Ordem de ${symbol} não foi totalmente executada. Status: ${status}`);
        }

        if (typeof order?.filled === 'number' && typeof order?.amount === 'number' && order.filled + 1e-12 < order.amount) {
            throw new Error(`Execução parcial em ${symbol}. Filled: ${order.filled}, amount: ${order.amount}`);
        }
    }

    function buildTriangle(startAsset, bridgeAsset, targetAsset) {
        return {
            startAsset,
            bridgeAsset,
            targetAsset,
            pair1: `${bridgeAsset}/${startAsset}`,
            pair2: `${targetAsset}/${bridgeAsset}`,
            pair3: `${targetAsset}/${startAsset}`,
            label: `${startAsset} -> ${bridgeAsset} -> ${targetAsset} -> ${startAsset}`
        };
    }

    function getTopLevel(orderBook, side) {
        const levels = orderBook?.[side];

        if (!Array.isArray(levels) || levels.length === 0 || !Array.isArray(levels[0])) {
            return null;
        }

        return {
            price: levels[0][0],
            amount: levels[0][1]
        };
    }

    function getSpreadPercent(orderBook) {
        const bestAsk = getTopLevel(orderBook, 'asks');
        const bestBid = getTopLevel(orderBook, 'bids');

        if (!bestAsk || !bestBid || bestAsk.price <= 0) {
            return null;
        }

        return ((bestAsk.price - bestBid.price) / bestAsk.price) * 100;
    }

    function getTrianglesForCycle() {
        if (monitoredTriangles.length <= config.maxTrianglesPerCycle) {
            return monitoredTriangles;
        }

        const selectedTriangles = [];

        for (let index = 0; index < config.maxTrianglesPerCycle; index += 1) {
            selectedTriangles.push(monitoredTriangles[(triangleCursor + index) % monitoredTriangles.length]);
        }

        triangleCursor = (triangleCursor + selectedTriangles.length) % monitoredTriangles.length;
        return selectedTriangles;
    }

    async function loadTriangles() {
        const markets = await exchange.loadMarkets();
        const availablePairs = new Set(Object.keys(markets));

        monitoredTriangles = [];

        for (const startAsset of config.startAssets) {
            for (const bridgeAsset of config.bridgeAssets) {
                if (bridgeAsset === startAsset) {
                    continue;
                }

                for (const targetAsset of config.targetAssets) {
                    if (targetAsset === startAsset || targetAsset === bridgeAsset) {
                        continue;
                    }

                    const triangle = buildTriangle(startAsset, bridgeAsset, targetAsset);

                    if (availablePairs.has(triangle.pair1) && availablePairs.has(triangle.pair2) && availablePairs.has(triangle.pair3)) {
                        monitoredTriangles.push(triangle);
                    }
                }
            }
        }

        if (monitoredTriangles.length === 0) {
            throw new Error('Nenhum triângulo válido encontrado para os ativos configurados nesta exchange.');
        }
    }

    async function ensureInitialized() {
        if (isInitialized) {
            return;
        }

        if (!initializationPromise) {
            initializationPromise = loadTriangles()
                .then(() => {
                    isInitialized = true;
                })
                .finally(() => {
                    initializationPromise = null;
                });
        }

        await initializationPromise;
    }

    function rememberScan(scanResult) {
        latestScanResult = scanResult;
        recentScans.unshift(scanResult);

        if (recentScans.length > 10) {
            recentScans.length = 10;
        }
    }

    async function executeTrade(result) {
        const { triangle, amountBridge, amountTarget } = result;

        validateExecutionPlan(result);
        await validateBalances(triangle);

        const order1 = await exchange.createMarketBuyOrder(triangle.pair1, amountBridge);
        await assertOrderFilled(order1, triangle.pair1);

        const order2 = await exchange.createMarketBuyOrder(triangle.pair2, amountTarget);
        await assertOrderFilled(order2, triangle.pair2);

        const order3 = await exchange.createMarketSellOrder(triangle.pair3, amountTarget);
        await assertOrderFilled(order3, triangle.pair3);
    }

    function createEvaluation(triangle) {
        return {
            route: triangle.label,
            pairs: [triangle.pair1, triangle.pair2, triangle.pair3],
            status: 'pending',
            reason: null,
            steps: []
        };
    }

    function addEvaluationStep(evaluation, title, details, status = 'info') {
        evaluation.steps.push({ title, details, status });
    }

    function finalizeEvaluation(evaluation, status, reason) {
        evaluation.status = status;
        evaluation.reason = reason;
    }

    async function scan() {
        await ensureInitialized();

        if (isChecking) {
            throw new Error('Já existe uma varredura em andamento. Aguarde a conclusão do ciclo atual.');
        }

        isChecking = true;

        try {
            const selectedTriangles = getTrianglesForCycle();
            const uniquePairs = [...new Set(selectedTriangles.flatMap((triangle) => [triangle.pair1, triangle.pair2, triangle.pair3]))];
            const orderBookEntries = await Promise.all(
                uniquePairs.map(async (pair) => [pair, await exchange.fetchOrderBook(pair, config.orderBookDepth)])
            );
            const orderBooks = new Map(orderBookEntries);
            const results = [];
            const evaluations = [];
            let skippedBySpread = 0;
            let skippedByVolume = 0;
            const loggedAt = new Date().toISOString();

            for (const triangle of selectedTriangles) {
                const evaluation = createEvaluation(triangle);
                evaluations.push(evaluation);
                const orderBook1 = orderBooks.get(triangle.pair1);
                const orderBook2 = orderBooks.get(triangle.pair2);
                const orderBook3 = orderBooks.get(triangle.pair3);

                const askLevel1 = getTopLevel(orderBook1, 'asks');
                const askLevel2 = getTopLevel(orderBook2, 'asks');
                const bidLevel3 = getTopLevel(orderBook3, 'bids');

                if (!askLevel1 || !askLevel2 || !bidLevel3) {
                    finalizeEvaluation(evaluation, 'skipped', 'Livro incompleto para uma das pernas.');
                    addEvaluationStep(evaluation, 'Livros consultados', 'Nao foi possivel obter ask/ask/bid das tres pernas.', 'error');
                    continue;
                }

                addEvaluationStep(
                    evaluation,
                    'Livros consultados',
                    `${triangle.pair1} ask ${askLevel1.price} (${askLevel1.amount}), ${triangle.pair2} ask ${askLevel2.price} (${askLevel2.amount}), ${triangle.pair3} bid ${bidLevel3.price} (${bidLevel3.amount})`
                );

                const spread1 = getSpreadPercent(orderBook1);
                const spread2 = getSpreadPercent(orderBook2);
                const spread3 = getSpreadPercent(orderBook3);

                addEvaluationStep(
                    evaluation,
                    'Filtro de spread',
                    `${triangle.pair1}: ${spread1 === null ? '--' : spread1.toFixed(4)}%, ${triangle.pair2}: ${spread2 === null ? '--' : spread2.toFixed(4)}%, ${triangle.pair3}: ${spread3 === null ? '--' : spread3.toFixed(4)}% | limite ${config.maxSpreadPercent.toFixed(4)}%`
                );

                if (
                    spread1 === null || spread2 === null || spread3 === null ||
                    spread1 > config.maxSpreadPercent ||
                    spread2 > config.maxSpreadPercent ||
                    spread3 > config.maxSpreadPercent
                ) {
                    skippedBySpread += 1;
                    finalizeEvaluation(evaluation, 'skipped', 'Triangulo descartado por spread.');
                    addEvaluationStep(evaluation, 'Resultado do spread', 'Pelo menos uma perna excedeu o limite configurado.', 'error');
                    continue;
                }

                const askPrice1 = askLevel1.price;
                const askPrice2 = askLevel2.price;
                const bidPrice3 = bidLevel3.price;
                const grossBridgeAmount = config.investmentAmount / askPrice1;

                addEvaluationStep(
                    evaluation,
                    'Calculo da primeira perna',
                    `Investimento ${config.investmentAmount} ${triangle.startAsset} gera ${grossBridgeAmount.toFixed(8)} ${triangle.bridgeAsset} antes da taxa.`
                );

                if (askLevel1.amount < grossBridgeAmount * config.minVolumeBuffer) {
                    skippedByVolume += 1;
                    finalizeEvaluation(evaluation, 'skipped', `Liquidez insuficiente em ${triangle.pair1}.`);
                    addEvaluationStep(evaluation, 'Filtro de liquidez', `Volume no topo ${askLevel1.amount} abaixo do minimo exigido ${(grossBridgeAmount * config.minVolumeBuffer).toFixed(8)}.`, 'error');
                    continue;
                }

                let amountBridge = grossBridgeAmount;
                amountBridge *= (1 - config.tradingFee);

                addEvaluationStep(
                    evaluation,
                    'Taxa da primeira perna',
                    `Apos taxa de ${(config.tradingFee * 100).toFixed(4)}%, restam ${amountBridge.toFixed(8)} ${triangle.bridgeAsset}.`
                );

                const grossTargetAmount = amountBridge / askPrice2;

                addEvaluationStep(
                    evaluation,
                    'Calculo da segunda perna',
                    `${amountBridge.toFixed(8)} ${triangle.bridgeAsset} geram ${grossTargetAmount.toFixed(8)} ${triangle.targetAsset} antes da taxa.`
                );

                if (askLevel2.amount < grossTargetAmount * config.minVolumeBuffer) {
                    skippedByVolume += 1;
                    finalizeEvaluation(evaluation, 'skipped', `Liquidez insuficiente em ${triangle.pair2}.`);
                    addEvaluationStep(evaluation, 'Filtro de liquidez', `Volume no topo ${askLevel2.amount} abaixo do minimo exigido ${(grossTargetAmount * config.minVolumeBuffer).toFixed(8)}.`, 'error');
                    continue;
                }

                let amountTarget = grossTargetAmount;
                amountTarget *= (1 - config.tradingFee);

                addEvaluationStep(
                    evaluation,
                    'Taxa da segunda perna',
                    `Apos taxa, restam ${amountTarget.toFixed(8)} ${triangle.targetAsset}.`
                );

                if (bidLevel3.amount < amountTarget * config.minVolumeBuffer) {
                    skippedByVolume += 1;
                    finalizeEvaluation(evaluation, 'skipped', `Liquidez insuficiente em ${triangle.pair3}.`);
                    addEvaluationStep(evaluation, 'Filtro de liquidez', `Volume no topo ${bidLevel3.amount} abaixo do minimo exigido ${(amountTarget * config.minVolumeBuffer).toFixed(8)}.`, 'error');
                    continue;
                }

                const executionPrice1 = getAverageExecutionPrice(orderBook1, 'asks', grossBridgeAmount);
                const executionPrice2 = getAverageExecutionPrice(orderBook2, 'asks', grossTargetAmount);
                const executionPrice3 = getAverageExecutionPrice(orderBook3, 'bids', amountTarget);

                if (!executionPrice1 || !executionPrice2 || !executionPrice3) {
                    skippedByVolume += 1;
                    finalizeEvaluation(evaluation, 'skipped', 'Profundidade insuficiente no livro para estimar execucao media.');
                    addEvaluationStep(evaluation, 'Estimativa de execucao', 'Nao houve profundidade suficiente para preencher as tres pernas.', 'error');
                    continue;
                }

                addEvaluationStep(
                    evaluation,
                    'Preco medio estimado',
                    `${triangle.pair1}: ${executionPrice1.toFixed(8)}, ${triangle.pair2}: ${executionPrice2.toFixed(8)}, ${triangle.pair3}: ${executionPrice3.toFixed(8)}`
                );

                const slippage1 = getSlippagePercent(askPrice1, executionPrice1);
                const slippage2 = getSlippagePercent(askPrice2, executionPrice2);
                const slippage3 = getSlippagePercent(bidPrice3, executionPrice3);

                addEvaluationStep(
                    evaluation,
                    'Filtro de slippage',
                    `${triangle.pair1}: ${slippage1 === null ? '--' : slippage1.toFixed(4)}%, ${triangle.pair2}: ${slippage2 === null ? '--' : slippage2.toFixed(4)}%, ${triangle.pair3}: ${slippage3 === null ? '--' : slippage3.toFixed(4)}% | limite ${config.maxSlippagePercent.toFixed(4)}%`
                );

                if (
                    slippage1 === null || slippage2 === null || slippage3 === null ||
                    slippage1 > config.maxSlippagePercent ||
                    slippage2 > config.maxSlippagePercent ||
                    slippage3 > config.maxSlippagePercent
                ) {
                    skippedByVolume += 1;
                    finalizeEvaluation(evaluation, 'skipped', 'Triangulo descartado por slippage.');
                    addEvaluationStep(evaluation, 'Resultado do slippage', 'Pelo menos uma perna excedeu o limite configurado.', 'error');
                    continue;
                }

                let finalAmount = amountTarget * executionPrice3;
                finalAmount *= (1 - config.tradingFee);

                const profitLoss = finalAmount - config.investmentAmount;
                const percentage = (profitLoss / config.investmentAmount) * 100;

                addEvaluationStep(
                    evaluation,
                    'Resultado estimado',
                    `Final ${finalAmount.toFixed(8)} ${triangle.startAsset} | lucro ${profitLoss.toFixed(8)} | variacao ${percentage.toFixed(4)}%`
                );

                if (percentage >= config.minProfitPercent) {
                    finalizeEvaluation(evaluation, 'opportunity', 'Triangulo aprovado como oportunidade.');
                    addEvaluationStep(evaluation, 'Decisao final', `Acima do minimo de lucro configurado ${config.minProfitPercent.toFixed(4)}%.`, 'success');
                } else {
                    finalizeEvaluation(evaluation, 'evaluated', 'Triangulo calculado, mas abaixo do lucro minimo.');
                    addEvaluationStep(evaluation, 'Decisao final', `Abaixo do minimo de lucro configurado ${config.minProfitPercent.toFixed(4)}%.`, 'warning');
                }

                results.push({
                    triangle,
                    askPrice1,
                    askPrice2,
                    bidPrice3,
                    finalAmount,
                    profitLoss,
                    percentage,
                    spreads: [spread1, spread2, spread3],
                    slippages: [slippage1, slippage2, slippage3],
                    amountBridge,
                    amountTarget,
                    loggedAt
                });
            }

            results.sort((left, right) => right.percentage - left.percentage);
            const opportunities = results.filter((result) => result.percentage >= config.minProfitPercent);

            if (opportunities.length > 0) {
                await appendOpportunityLog({
                    timestamp: loggedAt,
                    exchange: configuredExchangeId,
                    evaluatedTriangles: selectedTriangles.length,
                    opportunities: opportunities.slice(0, 5).map((result) => ({
                        route: result.triangle.label,
                        startAsset: result.triangle.startAsset,
                        percentage: Number(result.percentage.toFixed(6)),
                        profitLoss: Number(result.profitLoss.toFixed(8)),
                        finalAmount: Number(result.finalAmount.toFixed(8)),
                        spreads: result.spreads.map((spread) => Number(spread.toFixed(6))),
                        slippages: result.slippages.map((slippage) => Number(slippage.toFixed(6))),
                        pairs: [result.triangle.pair1, result.triangle.pair2, result.triangle.pair3]
                    }))
                });
            }

            const topResults = results.slice(0, 5).map((result) => ({
                route: result.triangle.label,
                pair1: result.triangle.pair1,
                pair2: result.triangle.pair2,
                pair3: result.triangle.pair3,
                startAsset: result.triangle.startAsset,
                askPrice1: result.askPrice1,
                askPrice2: result.askPrice2,
                bidPrice3: result.bidPrice3,
                spreads: result.spreads,
                slippages: result.slippages,
                finalAmount: result.finalAmount,
                profitLoss: result.profitLoss,
                percentage: result.percentage
            }));

            const scanResult = {
                timestamp: loggedAt,
                mode: config.enableLiveTrading ? 'live' : 'simulation',
                exchange: configuredExchangeId,
                selectedTriangles: selectedTriangles.length,
                uniquePairs: uniquePairs.length,
                skippedBySpread,
                skippedByVolume,
                opportunitiesCount: opportunities.length,
                bestOpportunity: topResults[0] || null,
                topResults,
                evaluations,
                configuration: {
                    investmentAmount: config.investmentAmount,
                    tradingFee: config.tradingFee,
                    maxSpreadPercent: config.maxSpreadPercent,
                    minVolumeBuffer: config.minVolumeBuffer,
                    minProfitPercent: config.minProfitPercent,
                    maxSlippagePercent: config.maxSlippagePercent,
                    scanIntervalMs: config.scanIntervalMs,
                    maxTrianglesPerCycle: config.maxTrianglesPerCycle,
                    orderBookDepth: config.orderBookDepth
                }
            };

            rememberScan(scanResult);

            if (opportunities.length > 0 && config.enableLiveTrading) {
                await executeTrade(results[0]);
            }

            return scanResult;
        } finally {
            isChecking = false;
        }
    }

    async function getStatus() {
        return {
            mode: config.enableLiveTrading ? 'live' : 'simulation',
            exchange: configuredExchangeId,
            initialized: isInitialized,
            monitoredTriangles: monitoredTriangles.length,
            latestScan: latestScanResult,
            recentScans,
            logs: await readOpportunityLog(10)
        };
    }

    return {
        scan,
        getStatus,
        readLogs: (limit) => readOpportunityLog(limit),
        getConfig: () => ({ ...config })
    };
}

module.exports = { createArbitrageService };