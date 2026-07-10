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

function getAuthHeaders() {
    const token = localStorage.getItem('authToken');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
}

async function loadActiveExchangeStatuses() {
    try {
        const baseUrl = window.API_URL || '';
        const result = await fetch(`${baseUrl}/api/exchanges/statuses`, {
            headers: getAuthHeaders()
        });
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
        ? 'loop cont\u00ednuo ativo pelo .env'
        : 'loop at\u00e9 encontrar oportunidade favor\u00e1vel e encerrar';
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

function escapeHtmlReplacer(m) {
    if (m === '&') return String.fromCharCode(38) + 'amp;';
    if (m === '<') return String.fromCharCode(38) + 'lt;';
    if (m === '>') return String.fromCharCode(38) + 'gt;';
    if (m === '"') return String.fromCharCode(38) + 'quot;';
    if (m === "'") return String.fromCharCode(38) + '#39;';
    return m;
}

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, escapeHtmlReplacer);
}

export async function fetchJson(url, options = {}) {
    // Injeta automaticamente o token JWT se disponível
    const authHeaders = getAuthHeaders();
    options.headers = { ...authHeaders, ...(options.headers || {}) };

    const response = await fetch(url, options);
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
        // Se 401, redireciona para login
        if (response.status === 401) {
            localStorage.removeItem('authToken');
            window.location.href = '/login.html';
            return;
        }
        throw new Error(result.error || 'Falha ao processar requisi\u00e7\u00e3o.');
    }

    return result;
}

export function metricCard(label, value) {
    return '<article class="metric"><span class="label">' + label + '</span><span class="value">' + value + '</span></article>';
}

export function infoMetricCard(label, value) {
    return '<article class="metric"><span class="label">' + label + '</span><span class="value value-compact">' + value + '</span></article>';
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
        return 'Aguardando simula\u00e7\u00e3o...';
    }

    const toneClass = outcome.isPositive ? 'positive' : 'negative';
    const sign = outcome.isPositive ? '+' : '';
    return '<span class="' + toneClass + '">' + sign + formatNumber(outcome.estimatedPnL, 6) + ' ' + currency + '</span> (' + sign + formatNumber(outcome.estimatedPnLPercent, 4) + '%)';
}

export function buildApiUrl(pathname) {
    const normalized = pathname.replace(/^\//, '');
    let port = '8081'; // Porta padrão (arbitrage/admin)

    if (normalized.startsWith('cross-market')) {
        port = '8082';
    } else if (normalized.startsWith('market-making')) {
        port = '8083';
    }

    let hostname = 'localhost';
    if (typeof window !== 'undefined') {
        if (window.API_URL) {
            try {
                const urlObj = new URL(window.API_URL);
                hostname = urlObj.hostname;
            } catch (e) {
                hostname = window.location.hostname || 'localhost';
            }
        } else {
            hostname = window.location.hostname || 'localhost';
        }
    }

    const baseUrl = 'http://' + hostname + ':' + port;
    return baseUrl + '/api/' + normalized;
}

/**
 * Sistema de Toast Notifications
 */
export function showToast(message, type = 'info', duration = 4000) {
    var container = document.getElementById('toast-container');
    if (!container) {
        var newContainer = document.createElement('div');
        newContainer.id = 'toast-container';
        newContainer.className = 'toast-container';
        newContainer.setAttribute('aria-live', 'polite');
        newContainer.setAttribute('aria-atomic', 'true');
        document.body.appendChild(newContainer);
        container = newContainer;
    }

    var icons = {
        success: '\u2705',
        error: '\u274C',
        warning: '\u26A0\uFE0F',
        info: '\u2139\uFE0F'
    };

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = '<span class="toast-icon" aria-hidden="true">' + (icons[type] || icons.info) + '</span><span class="toast-message">' + message + '</span>';

    container.appendChild(toast);

    setTimeout(function() {
        toast.classList.add('toast-out');
        setTimeout(function() {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, duration);
}

/**
 * Cria um elemento skeleton para loading
 */
export function createSkeleton(type, count) {
    type = type || 'text';
    count = count || 1;
    var skeletons = [];
    for (var i = 0; i < count; i++) {
        if (type === 'text') {
            skeletons.push('<div class="skeleton skeleton-text' + (i % 2 === 0 ? ' skeleton-text-short' : '') + '"></div>');
        } else if (type === 'card') {
            skeletons.push('<div class="skeleton skeleton-card"></div>');
        } else if (type === 'metric') {
            skeletons.push('<div class="skeleton skeleton-metric"></div>');
        }
    }
    return skeletons.join('');
}

/**
 * Cria um spinner
 */
export function createSpinner(size) {
    size = size || 'default';
    return '<span class="spinner' + (size === 'large' ? ' spinner-lg' : '') + '" aria-hidden="true"></span>';
}