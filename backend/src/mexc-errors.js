/**
 * Utilitários para tratamento de erros específicos de exchanges.
 * 
 * Oversold (code 30005) - MEXC: quando um ativo está em estado de
 * supervendido e a exchange bloqueia temporariamente a negociação.
 * 
 * Rate Limit (code 429): quando a exchange detecta requisições excessivas.
 * Neste caso o loop em background deve parar IMEDIATAMENTE para
 * não agravar o bloqueio.
 */

const MEXC_OVERSOLD_CODES = [30005];
const MEXC_OVERSOLD_MESSAGES = ['oversold'];
const RATE_LIMIT_CODES = [429];
const RATE_LIMIT_MESSAGES = ['too many requests', 'rate limit', 'rate_limit'];

/**
 * Verifica se um erro é do tipo "Oversold" da MEXC.
 * Esse erro ocorre quando a exchange coloca um par em estado de
 * "supervendido", bloqueando temporariamente a criação de ordens
 * ou consultas para aquele par.
 *
 * @param {Error} error - O erro a ser verificado
 * @returns {boolean} true se for um erro Oversold da MEXC
 */
function isMexcOversoldError(error) {
    if (!error) {
        return false;
    }

    // Verifica pelo código no objeto de erro (ccxt normalmente coloca em error.code ou error.name)
    const errorCode = error.code || error.statusCode || (error.constructor && error.constructor.name);

    if (typeof errorCode === 'number' && MEXC_OVERSOLD_CODES.includes(errorCode)) {
        return true;
    }

    // Verifica na mensagem de erro
    const message = String(error.message || '').toLowerCase();
    if (MEXC_OVERSOLD_MESSAGES.some((keyword) => message.includes(keyword))) {
        return true;
    }

    // Verifica no body da resposta (ccxt pode incluir a resposta bruta)
    if (error.response) {
        const responseBody = typeof error.response === 'string'
            ? error.response
            : JSON.stringify(error.response);
        if (MEXC_OVERSOLD_MESSAGES.some((keyword) => responseBody.toLowerCase().includes(keyword))) {
            return true;
        }
    }

    return false;
}

/**
 * Verifica se um erro é do tipo Rate Limit (429).
 * Esse erro ocorre quando a exchange recebe requisições em excesso.
 * Quando detectado, o loop em background deve parar IMEDIATAMENTE
 * para não agravar o bloqueio.
 *
 * @param {Error} error - O erro a ser verificado
 * @returns {boolean} true se for um erro Rate Limit
 */
function isRateLimitError(error) {
    if (!error) {
        return false;
    }

    // Verifica pelo código HTTP 429 (ccxt normalmente expõe como error.code ou error.statusCode)
    const errorCode = error.code || error.statusCode || (error.httpStatusCode) || (error.response && error.response.statusCode);

    if (typeof errorCode === 'number' && RATE_LIMIT_CODES.includes(errorCode)) {
        return true;
    }

    // Verifica na mensagem de erro
    const message = String(error.message || '').toLowerCase();
    if (RATE_LIMIT_MESSAGES.some((keyword) => message.includes(keyword))) {
        return true;
    }

    // Verifica no body da resposta (ccxt pode incluir a resposta bruta)
    if (error.response) {
        const responseBody = typeof error.response === 'string'
            ? error.response
            : JSON.stringify(error.response);
        if (RATE_LIMIT_MESSAGES.some((keyword) => responseBody.toLowerCase().includes(keyword))) {
            return true;
        }
    }

    return false;
}

/**
 * Extrai informações detalhadas sobre o erro Oversold.
 *
 * @param {Error} error - O erro a ser analisado
 * @returns {{ isOversold: boolean, symbol: string|null, exchange: string }}
 */
function extractMexcOversoldInfo(error) {
    const isOversold = isMexcOversoldError(error);

    let symbol = null;
    if (error && error.symbol) {
        symbol = error.symbol;
    }

    // Tenta extrair o símbolo da mensagem de erro
    if (!symbol && error && error.message) {
        const symbolMatch = error.message.match(/["']?([A-Z0-9]{2,}\/[A-Z0-9]{2,})["']?/i);
        if (symbolMatch) {
            symbol = symbolMatch[1];
        }
    }

    return {
        isOversold,
        symbol,
        exchange: 'mexc'
    };
}

module.exports = {
    isMexcOversoldError,
    isRateLimitError,
    extractMexcOversoldInfo,
    MEXC_OVERSOLD_CODES,
    MEXC_OVERSOLD_MESSAGES,
    RATE_LIMIT_CODES,
    RATE_LIMIT_MESSAGES
};
