function normalizeExchangeId(exchangeId) {
    const normalizedExchangeId = String(exchangeId || 'binance').trim().toLowerCase();

    if (normalizedExchangeId === 'woox') {
        return 'woo';
    }

    return normalizedExchangeId;
}

const EXCHANGE_CREDENTIAL_CONFIG = {
    kraken: {
        name: 'Kraken',
        acronym: 'KRAKEN',
        credentials: {
            apiKey: { dbField: 'apiKey', envNames: ['KRAKEN_API_KEY'] },
            secret: { dbField: 'secretKey', envNames: ['KRAKEN_SECRET_KEY'] }
        }
    },
    binance: {
        name: 'Binance',
        acronym: 'BINANCE',
        credentials: {
            apiKey: { dbField: 'apiKey', envNames: ['BINANCE_API_KEY'] },
            secret: { dbField: 'secretKey', envNames: ['BINANCE_SECRET_KEY'] }
        }
    },
    bybit: {
        name: 'Bybit',
        acronym: 'BYBIT',
        credentials: {
            apiKey: { dbField: 'apiKey', envNames: ['BYBIT_API_KEY'] },
            secret: { dbField: 'secretKey', envNames: ['BYBIT_SECRET_KEY'] }
        }
    },
    mexc: {
        name: 'MEXC',
        acronym: 'MEXC',
        credentials: {
            apiKey: { dbField: 'apiKey', envNames: ['MEXC_API_KEY'] },
            secret: { dbField: 'secretKey', envNames: ['MEXC_SECRET_KEY'] }
        }
    },
    coinbase: {
        name: 'Coinbase',
        acronym: 'COINBASE',
        credentials: {
            apiKey: { dbField: 'apiKey', envNames: ['COINBASE_API_KEY'] },
            secret: { dbField: 'secretKey', envNames: ['COINBASE_SECRET_KEY'] }
        }
    },
    gateio: {
        name: 'Gate.io',
        acronym: 'GATEIO',
        credentials: {
            apiKey: { dbField: 'apiKey', envNames: ['GATE_API_KEY', 'GATEIO_API_KEY'] },
            secret: { dbField: 'secretKey', envNames: ['GATE_SECRET_KEY', 'GATEIO_SECRET_KEY'] }
        }
    },
    okx: {
        name: 'OKX',
        acronym: 'OKX',
        credentials: {
            apiKey: { dbField: 'apiKey', envNames: ['OKX_API_KEY'] },
            secret: { dbField: 'secretKey', envNames: ['OKX_SECRET_KEY', 'OKX_SECRET'] },
            password: { dbField: 'password', envNames: ['OKX_PASSPHRASE', 'OKX_PASSWORD'] }
        }
    },
    woo: {
        name: 'WOO',
        acronym: 'WOO',
        credentials: {
            apiKey: { dbField: 'apiKey', envNames: ['WOO_API_KEY', 'WOOX_API_KEY'] },
            secret: { dbField: 'secretKey', envNames: ['WOO_SECRET_KEY', 'WOOX_SECRET_KEY'] }
        }
    }
};

const SUPPORTED_EXCHANGES = Object.keys(EXCHANGE_CREDENTIAL_CONFIG);

function getExchangeCredentialConfig(exchangeId) {
    const normalizedExchangeId = normalizeExchangeId(exchangeId);
    const config = EXCHANGE_CREDENTIAL_CONFIG[normalizedExchangeId];

    if (!config) {
        throw new Error(`Exchange inválida: ${normalizedExchangeId}. Use "${SUPPORTED_EXCHANGES.join('", "')}".`);
    }

    return {
        exchangeId: normalizedExchangeId,
        ...config
    };
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

function getCredentialRequirementLabel(exchangeId, field) {
    const config = getExchangeCredentialConfig(exchangeId);
    const credential = config.credentials[field];
    return `cadastro da exchange ${config.acronym} no banco (${credential.dbField})`;
}

function buildInfoLine(label, value) {
    if (!value) {
        return null;
    }

    return `${label}: ${value}`;
}

function getEnvExchangeInformation(exchangeId) {
    const config = getExchangeCredentialConfig(exchangeId);
    const prefix = config.acronym;
    const lines = [];

    const timeoutInfo = buildInfoLine('Timeout API', process.env[`${prefix}_TIMEOUT_MS`]);
    if (timeoutInfo) {
        lines.push(timeoutInfo);
    }

    if (prefix === 'WOO') {
        const wooAppId = buildInfoLine('WOO App ID', process.env.WOO_APP_ID);
        if (wooAppId) {
            lines.push(wooAppId);
        }
    }

    const arbitrageParts = [
        buildInfoLine('Start', process.env[`${prefix}_ARBITRAGE_START_ASSETS`]),
        buildInfoLine('Bridge', process.env[`${prefix}_ARBITRAGE_BRIDGE_ASSETS`]),
        buildInfoLine('Target', process.env[`${prefix}_ARBITRAGE_TARGET_ASSETS`]),
        buildInfoLine('Investimento', process.env[`${prefix}_ARBITRAGE_INVESTMENT_AMOUNT`]),
        buildInfoLine('Intervalo', process.env[`${prefix}_ARBITRAGE_SCAN_INTERVAL_MS`]),
        buildInfoLine('Live', process.env[`${prefix}_ARBITRAGE_ENABLE_LIVE_TRADING`])
    ].filter(Boolean);

    if (arbitrageParts.length > 0) {
        lines.push(`Arbitrage | ${arbitrageParts.join(' | ')}`);
    }

    const marketMakingParts = [
        buildInfoLine('Modo', process.env[`${prefix}_MARKET_MAKING_MODE`]),
        buildInfoLine('Loop', process.env[`${prefix}_MARKET_MAKING_KEEP_LISTENING`]),
        buildInfoLine('Símbolos', process.env[`${prefix}_MARKET_MAKING_SYMBOL`]),
        buildInfoLine('Budget', process.env[`${prefix}_MARKET_MAKING_QUOTE_BUDGET`]),
        buildInfoLine('Spread mín.', process.env[`${prefix}_MARKET_MAKING_MIN_SPREAD_PERCENT`]),
        buildInfoLine('Intervalo', process.env[`${prefix}_MARKET_MAKING_UPDATE_INTERVAL_MS`])
    ].filter(Boolean);

    if (marketMakingParts.length > 0) {
        lines.push(`Market Making | ${marketMakingParts.join(' | ')}`);
    }

    if (lines.length === 0) {
        return 'Sem configuração específica da exchange no .env.';
    }

    return lines.join('\n');
}

function getEnvExchangeSeedRecord(exchangeId) {
    const config = getExchangeCredentialConfig(exchangeId);
    const record = {
        name: config.name,
        acronym: config.acronym,
        active: true,
        notes: 'Importado automaticamente do .env',
        envInfo: getEnvExchangeInformation(exchangeId)
    };

    for (const credential of Object.values(config.credentials)) {
        const resolvedValue = getFirstDefinedEnv(credential.envNames);

        if (resolvedValue) {
            record[credential.dbField] = resolvedValue;
        }
    }

    return record;
}

function listEnvExchangeSeedRecords() {
    return SUPPORTED_EXCHANGES.map((exchangeId) => getEnvExchangeSeedRecord(exchangeId));
}

module.exports = {
    SUPPORTED_EXCHANGES,
    getCredentialRequirementLabel,
    getExchangeCredentialConfig,
    getEnvExchangeSeedRecord,
    getEnvExchangeInformation,
    getFirstDefinedEnv,
    listEnvExchangeSeedRecords,
    normalizeExchangeId
};