const { getExchangeByAcronym } = require('./database');
const { getExchangeCredentialConfig } = require('./exchange-credentials');

function parseAssetList(value, fallback) {
    if (!value) return fallback;
    const items = String(value).split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
    return items.length > 0 ? items : fallback;
}

function parseNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseSymbolList(value, fallback) {
    const items = String(value || fallback || '').split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
    return items.length > 0 ? [...new Set(items)] : [fallback];
}

function toEnvKey(camelCase) {
    return camelCase.replace(/([A-Z])/g, '_$1').toUpperCase();
}

const ARBITRAGE_DEFAULTS = {
    base: {
        startAssets: ['USDT'],
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
        enableLiveTrading: false,
        triangleSearchMode: 'LIST',
        assetsMode: 'list'
    },
    exchanges: {
        kraken: { startAssets: ['USD'], bridgeAssets: ['BTC', 'ETH'], targetAssets: ['ETH'], investmentAmount: 100, tradingFee: 0.004, scanIntervalMs: 5000, maxTrianglesPerCycle: 6, orderBookDepth: 10, maxSpreadPercent: 0.25, minVolumeBuffer: 1.1, minProfitPercent: 0.3, maxSlippagePercent: 0.2 },
        binance: { startAssets: ['USDT'], bridgeAssets: ['BTC', 'ETH'], targetAssets: ['ETH'], investmentAmount: 100, tradingFee: 0.001, scanIntervalMs: 3000, maxTrianglesPerCycle: 8, orderBookDepth: 10, maxSpreadPercent: 0.2, minVolumeBuffer: 1.05, minProfitPercent: 0.1, maxSlippagePercent: 0.15 },
        bybit: { startAssets: ['USDT'], bridgeAssets: ['BTC', 'ETH'], targetAssets: ['ETH'], investmentAmount: 100, tradingFee: 0.001, scanIntervalMs: 3000, maxTrianglesPerCycle: 8, orderBookDepth: 10, maxSpreadPercent: 0.2, minVolumeBuffer: 1.05, minProfitPercent: 0.1, maxSlippagePercent: 0.15 },
        mexc: { startAssets: ['USDT', 'USDC'], bridgeAssets: ['BTC', 'ETH', 'SOL', 'XRP'], targetAssets: ['ETH', 'SOL', 'XRP', 'DOGE'], investmentAmount: 100, tradingFee: 0.001, scanIntervalMs: 3000, maxTrianglesPerCycle: 8, orderBookDepth: 10, maxSpreadPercent: 0.2, minVolumeBuffer: 1.05, minProfitPercent: 0.1, maxSlippagePercent: 0.15 },
        coinbase: { startAssets: ['USD', 'USDC', 'USDT'], bridgeAssets: ['BTC', 'ETH', 'SOL'], targetAssets: ['ETH', 'SOL'], investmentAmount: 100, tradingFee: 0.004, scanIntervalMs: 5000, maxTrianglesPerCycle: 6, orderBookDepth: 10, maxSpreadPercent: 0.25, minVolumeBuffer: 1.1, minProfitPercent: 0.2, maxSlippagePercent: 0.2 },
        gateio: { startAssets: ['USDT'], bridgeAssets: ['BTC', 'ETH'], targetAssets: ['ETH'], investmentAmount: 100, tradingFee: 0.001, scanIntervalMs: 3000, maxTrianglesPerCycle: 8, orderBookDepth: 10, maxSpreadPercent: 0.2, minVolumeBuffer: 1.05, minProfitPercent: 0.1, maxSlippagePercent: 0.15 },
        okx: { startAssets: ['USDT'], bridgeAssets: ['BTC', 'ETH'], targetAssets: ['ETH'], investmentAmount: 100, tradingFee: 0.001, scanIntervalMs: 3000, maxTrianglesPerCycle: 8, orderBookDepth: 10, maxSpreadPercent: 0.2, minVolumeBuffer: 1.05, minProfitPercent: 0.1, maxSlippagePercent: 0.15 },
        woo: { startAssets: ['USDT', 'USDC'], bridgeAssets: ['BTC', 'ETH', 'SOL'], targetAssets: ['ETH', 'SOL', 'XRP'], investmentAmount: 100, tradingFee: 0.001, scanIntervalMs: 3000, maxTrianglesPerCycle: 8, orderBookDepth: 10, maxSpreadPercent: 0.2, minVolumeBuffer: 1.05, minProfitPercent: 0.1, maxSlippagePercent: 0.15 }
    }
};

const MARKET_MAKING_DEFAULTS = {
    mode: 'simulation',
    keepListening: true,
    orderBookDepth: 10,
    quoteOffsetPercent: 0.03,
    minSpreadPercent: 0.05,
    quoteBudget: 10,
    maxSymbolAttempts: 10,
    updateIntervalMs: 5000
};

async function resolveArbitrageConfig(exchangeId) {
    const normalId = String(exchangeId || '').trim().toLowerCase();
    const exchangeConfig = getExchangeCredentialConfig(normalId);
    const exchangeDefaults = ARBITRAGE_DEFAULTS.exchanges[normalId] || {};
    const baseDefaults = ARBITRAGE_DEFAULTS.base;
    const mergedDefaults = { ...baseDefaults, ...exchangeDefaults };

    let dbConfig = null;
    let dbAssetsMode = null;
    try {
        const dbRecord = await getExchangeByAcronym(exchangeConfig.acronym);
        if (dbRecord) {
            dbConfig = dbRecord.arbitrageConfig || null;
            dbAssetsMode = dbRecord.assetsMode || null;
        }
    } catch {
        // DB unavailable, fall through to .env
    }

    function getSetting(dbField, parseFn, defaultValue) {
        if (dbConfig && dbConfig[dbField] !== undefined && dbConfig[dbField] !== null) {
            return parseFn(dbConfig[dbField], defaultValue);
        }
        const envKey = `${normalId.toUpperCase()}_ARBITRAGE_${toEnvKey(dbField)}`;
        if (process.env[envKey] !== undefined) {
            return parseFn(process.env[envKey], defaultValue);
        }
        const genericEnvKey = `ARBITRAGE_${toEnvKey(dbField)}`;
        if (process.env[genericEnvKey] !== undefined) {
            return parseFn(process.env[genericEnvKey], defaultValue);
        }
        return defaultValue;
    }

    return {
        startAssets: getSetting('startAssets', parseAssetList, mergedDefaults.startAssets),
        bridgeAssets: getSetting('bridgeAssets', parseAssetList, mergedDefaults.bridgeAssets),
        targetAssets: getSetting('targetAssets', parseAssetList, mergedDefaults.targetAssets),
        investmentAmount: getSetting('investmentAmount', parseNumber, mergedDefaults.investmentAmount),
        tradingFee: getSetting('tradingFee', parseNumber, mergedDefaults.tradingFee),
        scanIntervalMs: Math.max(1000, getSetting('scanIntervalMs', parseNumber, mergedDefaults.scanIntervalMs)),
        maxTrianglesPerCycle: Math.max(1, Math.floor(getSetting('maxTrianglesPerCycle', parseNumber, mergedDefaults.maxTrianglesPerCycle))),
        orderBookDepth: Math.max(1, Math.floor(getSetting('orderBookDepth', parseNumber, mergedDefaults.orderBookDepth))),
        maxSpreadPercent: Math.max(0, getSetting('maxSpreadPercent', parseNumber, mergedDefaults.maxSpreadPercent)),
        minVolumeBuffer: Math.max(1, getSetting('minVolumeBuffer', parseNumber, mergedDefaults.minVolumeBuffer)),
        minProfitPercent: getSetting('minProfitPercent', parseNumber, mergedDefaults.minProfitPercent),
        maxSlippagePercent: Math.max(0, getSetting('maxSlippagePercent', parseNumber, mergedDefaults.maxSlippagePercent)),
        enableLiveTrading: getSetting('enableLiveTrading', (v) => Boolean(v) === true, mergedDefaults.enableLiveTrading),
        triangleSearchMode: getSetting('triangleSearchMode', (v) => String(v || 'LIST').toUpperCase(), mergedDefaults.triangleSearchMode),
        assetsMode: getSetting('assetsMode', (v) => String(v || 'list').toLowerCase(), dbAssetsMode || mergedDefaults.assetsMode || 'list')
    };
}

async function resolveMarketMakingConfig(exchangeId) {
    const normalId = String(exchangeId || '').trim().toLowerCase();
    const exchangeConfig = getExchangeCredentialConfig(normalId);
    const defaults = MARKET_MAKING_DEFAULTS;

    let dbConfig = null;
    try {
        const dbRecord = await getExchangeByAcronym(exchangeConfig.acronym);
        if (dbRecord) {
            dbConfig = dbRecord.marketMakingConfig || null;
        }
    } catch {
        // DB unavailable, fall through to .env
    }

    function getSetting(dbField, parseFn, defaultValue) {
        if (dbConfig && dbConfig[dbField] !== undefined && dbConfig[dbField] !== null) {
            return parseFn(dbConfig[dbField], defaultValue);
        }
        const envKey = `${normalId.toUpperCase()}_MARKET_MAKING_${toEnvKey(dbField)}`;
        if (process.env[envKey] !== undefined) {
            return parseFn(process.env[envKey], defaultValue);
        }
        const genericEnvKey = `MARKET_MAKING_${toEnvKey(dbField)}`;
        if (process.env[genericEnvKey] !== undefined) {
            return parseFn(process.env[genericEnvKey], defaultValue);
        }
        return defaultValue;
    }

    return {
        mode: String(getSetting('mode', (v) => String(v).trim().toLowerCase(), defaults.mode)),
        keepListening: getSetting('keepListening', (v) => Boolean(v) === true, defaults.keepListening),
        symbols: parseSymbolList(getSetting('symbol', (v) => v, null), defaultSymbol(normalId)),
        symbol: null,
        orderBookDepth: Math.max(1, Math.floor(getSetting('orderBookDepth', parseNumber, defaults.orderBookDepth))),
        quoteOffsetPercent: Math.max(0, getSetting('quoteOffsetPercent', parseNumber, defaults.quoteOffsetPercent)),
        minSpreadPercent: Math.max(0, getSetting('minSpreadPercent', parseNumber, defaults.minSpreadPercent)),
        quoteBudget: Math.max(0, getSetting('quoteBudget', parseNumber, defaults.quoteBudget)),
        maxSymbolAttempts: Math.max(1, Math.floor(getSetting('maxSymbolAttempts', parseNumber, defaults.maxSymbolAttempts))),
        updateIntervalMs: Math.max(1000, getSetting('updateIntervalMs', parseNumber, defaults.updateIntervalMs))
    };
}

function defaultSymbol(exchangeId) {
    return ['kraken', 'coinbase'].includes(exchangeId) ? 'BTC/USD' : 'BTC/USDT';
}

async function resolveTimeout(exchangeId) {
    const normalId = String(exchangeId || '').trim().toLowerCase();
    const exchangeConfig = getExchangeCredentialConfig(normalId);

    let dbTimeout = null;
    try {
        const dbRecord = await getExchangeByAcronym(exchangeConfig.acronym);
        if (dbRecord && dbRecord.arbitrageConfig?.scanIntervalMs) {
            // Timeout is separate, keep reading from env
        }
    } catch {
        // ignore
    }

    return 30000;
}

module.exports = {
    resolveArbitrageConfig,
    resolveMarketMakingConfig,
    resolveTimeout
};