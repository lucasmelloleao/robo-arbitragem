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
            apiKey: { dbField: 'apiKey' },
            secret: { dbField: 'secretKey' }
        }
    },
    binance: {
        name: 'Binance',
        acronym: 'BINANCE',
        credentials: {
            apiKey: { dbField: 'apiKey' },
            secret: { dbField: 'secretKey' }
        }
    },
    bybit: {
        name: 'Bybit',
        acronym: 'BYBIT',
        credentials: {
            apiKey: { dbField: 'apiKey' },
            secret: { dbField: 'secretKey' }
        }
    },
    mexc: {
        name: 'MEXC',
        acronym: 'MEXC',
        credentials: {
            apiKey: { dbField: 'apiKey' },
            secret: { dbField: 'secretKey' }
        }
    },
    coinbase: {
        name: 'Coinbase',
        acronym: 'COINBASE',
        credentials: {
            apiKey: { dbField: 'apiKey' },
            secret: { dbField: 'secretKey' }
        }
    },
    gateio: {
        name: 'Gate.io',
        acronym: 'GATEIO',
        credentials: {
            apiKey: { dbField: 'apiKey' },
            secret: { dbField: 'secretKey' }
        }
    },
    okx: {
        name: 'OKX',
        acronym: 'OKX',
        credentials: {
            apiKey: { dbField: 'apiKey' },
            secret: { dbField: 'secretKey' },
            password: { dbField: 'password' }
        }
    },
    woo: {
        name: 'WOO',
        acronym: 'WOO',
        credentials: {
            apiKey: { dbField: 'apiKey' },
            secret: { dbField: 'secretKey' }
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

function getCredentialRequirementLabel(exchangeId, field) {
    const config = getExchangeCredentialConfig(exchangeId);
    const credential = config.credentials[field];
    return `cadastro da exchange ${config.acronym} no banco (${credential.dbField})`;
}

module.exports = {
    SUPPORTED_EXCHANGES,
    getCredentialRequirementLabel,
    getExchangeCredentialConfig,
    normalizeExchangeId
};