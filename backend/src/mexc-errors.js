/**
 * Utilitários para tratamento de erros específicos da MEXC.
 * A MEXC pode retornar o erro "Oversold" (code 30005) quando um ativo está
 * em estado de supervendido e a exchange bloqueia temporariamente a negociação.
 */

const MEXC_OVERSOLD_CODES = [30005];
const MEXC_OVERSOLD_MESSAGES = ['oversold'];

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
    extractMexcOversoldInfo,
    MEXC_OVERSOLD_CODES,
    MEXC_OVERSOLD_MESSAGES
};