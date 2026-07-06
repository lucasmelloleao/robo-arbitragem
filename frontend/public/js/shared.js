export const ALL_EXCHANGES = ['binance', 'kraken', 'bybit', 'mexc', 'coinbase', 'gateio', 'okx', 'woo'];
const EXCHANGES_WITH_PASSPHRASE = new Set(['okx']);

const EXCHANGE_ACRONYM_MAP = {
    binance: 'BINANCE',
    kraken: 'KRAKEN',
    bybit: 'BYBIT',
    mexc: 'MEXC',
    coinbase: 'COINBASE',
    gateio: 'GATEIO',
    okx: 'OKX',
    woo: 'WOO'
};

async function loadActiveExchangeStatuses() {
    try {
        const baseUrl = window.API_URL || '';
        const result = await fetch(`${baseUrl}/api/exchanges/statuses`);
        const data = await result.json();
        return data.statuses || {};
    } catch {
        return {};
    }
}

let cachedExchangeStatuses = null;
let exchangeStatusesPromise = null;

export function getVisibleExchanges() {
    const [, firstSegment] = window.location.pathname.split('/');

    if (firstSegment === 'woox') {
        return ['woo'];
    }

    if (ALL_EXCHANGES.includes(firstSegment)) {
        return [firstSegment];
    }

    if (cachedExchangeStatuses) {
        return ALL_EXCHANGES.filter((id) => cachedExchangeStatuses[EXCHANGE_ACRONYM_MAP[id]] !== false);
    }

    return ALL_EXCHANGES;
}

export async function loadExchangeStatuses() {
    if (exchangeStatusesPromise) {
        return exchangeStatusesPromise;
    }
    exchangeStatusesPromise = loadActiveExchangeStatuses().then((statuses) => {
        cachedExchangeStatuses = statuses;
        return statuses;
    });
    return exchangeStatusesPromise;
}

export function isExchangeActive(exchangeId) {
    if (!cachedExchangeStatuses) {
        return true;
    }
    return cachedExchangeStatuses[EXCHANGE_ACRONYM_MAP[exchangeId]] !== false;
}

export function getExchangeTitle(exchangeId) {
    const labels = {
        binance: 'Binance',
        kraken: 'Kraken',
        bybit: 'Bybit',
        mexc: 'MEXC',
        coinbase: 'Coinbase',
        gateio: 'Gate.io',
        okx: 'OKX',
        woo: 'WOOX'
    };

    return labels[exchangeId] || exchangeId;
}

export function exchangeUsesPassphrase(exchangeIdOrAcronym) {
    const normalized = String(exchangeIdOrAcronym || '').trim().toLowerCase();
    return EXCHANGES_WITH_PASSPHRASE.has(normalized);
}

export function getMarketMakingLoopDescription(keepListening) {
    return keepListening
        ? 'loop contínuo ativo pelo .env'
        : 'loop até encontrar oportunidade favorável e encerrar';
}

export function formatMarketMakingMode(mode) {
    return mode === 'live' ? 'live' : 'simulation';
}

export function formatOrderStatus(order) {
    if (!order) {
        return 'n/a';
    }

    return order.status || 'n/a';
}

export function formatDateTime(value) {
    if (!value) {
        return 'Aguardando dados...';
    }

    return new Date(value).toLocaleString();
}

export function formatNumber(value, digits = 4) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return '--';
    }

    return value.toFixed(digits);
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(result.error || 'Falha ao processar requisição.');
    }

    return result;
}

export function metricCard(label, value) {
    return `<article class="metric"><span class="label">${label}</span><span class="value">${value}</span></article>`;
}

export function infoMetricCard(label, value) {
    return `<article class="metric"><span class="label">${label}</span><span class="value value-compact">${value}</span></article>`;
}

export function getEstimatedMarketMakingOutcome(run) {
    if (!run) {
        return null;
    }

    const amount = Number(run.estimatedBaseAmount);
    const bid = Number(run.targetBid);
    const ask = Number(run.targetAsk);

    if (![amount, bid, ask].every(Number.isFinite) || amount <= 0 || bid <= 0 || ask <= 0) {
        return null;
    }

    const estimatedCost = amount * bid;
    const estimatedRevenue = amount * ask;
    const estimatedPnL = estimatedRevenue - estimatedCost;
    const estimatedPnLPercent = estimatedCost > 0 ? (estimatedPnL / estimatedCost) * 100 : 0;

    return {
        estimatedCost,
        estimatedRevenue,
        estimatedPnL,
        estimatedPnLPercent,
        isPositive: estimatedPnL >= 0
    };
}

export function formatEstimatedOutcome(outcome, currency = 'quote') {
    if (!outcome) {
        return 'Aguardando simulacao...';
    }

    const toneClass = outcome.isPositive ? 'positive' : 'negative';
    const sign = outcome.isPositive ? '+' : '';
    return `<span class="${toneClass}">${sign}${formatNumber(outcome.estimatedPnL, 6)} ${currency}</span> (${sign}${formatNumber(outcome.estimatedPnLPercent, 4)}%)`;
}

export function buildApiUrl(pathname) {
    const baseUrl = window.API_URL || '';
    const normalized = pathname.replace(/^\//, '');
    return baseUrl ? `${baseUrl}/api/${normalized}` : `/api/${normalized}`;
}
