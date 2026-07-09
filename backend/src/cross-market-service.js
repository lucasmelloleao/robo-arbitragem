/**
 * Cross-Market Strategy Service
 * 
 * Estratégia independente de Arbitrage e Market Making.
 * Monitora diferenças de preço de um mesmo par entre duas corretoras
 * e executa compra na mais barata / venda na mais cara.
 * 
 * Usa CCXT para buscar preços com formatação correta de pares por exchange.
 */

const ccxt = require('ccxt');
const { getExchangeCredentialsByAcronym } = require('./database');

// Cache de configurações para evitar consultas repetidas ao banco
let cachedStrategies = [];
let scanIntervals = new Map(); // strategyId -> intervalId

// Armazenamento de logs em memória para o frontend
const logsStore = [];
const MAX_LOGS = 500;

// Mapeamento de siglas para IDs CCXT
// Nota: Gate.io no CCXT é 'gate', não 'gateio'
const EXCHANGE_CCXT_MAP = {
    BINANCE: 'binance',
    KRAKEN: 'kraken',
    BYBIT: 'bybit',
    MEXC: 'mexc',
    COINBASE: 'coinbase',
    GATEIO: 'gate',
    OKX: 'okx',
    WOO: 'woo'
};

// Cache de instâncias CCXT
const publicCcxtInstances = {};
const privateCcxtInstances = new Map(); // Cache para instâncias autenticadas

async function getCcxtInstance(exchangeAcronym, forLiveTrading = false) {
    var ccxtId = EXCHANGE_CCXT_MAP[exchangeAcronym];
    if (!ccxtId) return null;

    if (!forLiveTrading) {
        if (!publicCcxtInstances[ccxtId]) {
            var PublicExchangeClass = ccxt[ccxtId];
            if (!PublicExchangeClass) return null;

            publicCcxtInstances[ccxtId] = new PublicExchangeClass({
                enableRateLimit: true,
                timeout: 10000
            });
        }
        return publicCcxtInstances[ccxtId];
    }

    // Para live trading, usa cache separado e busca credenciais
    if (!privateCcxtInstances.has(exchangeAcronym)) {
        const credentials = await getExchangeCredentialsByAcronym(exchangeAcronym);
        if (!credentials || !credentials.apiKey || !credentials.secretKey) {
            throw new Error(`Credenciais ausentes para ${exchangeAcronym} em modo live.`);
        }

        var ExchangeClass = ccxt[ccxtId];
        if (!ExchangeClass) return null;

        const instance = new ExchangeClass({
            apiKey: credentials.apiKey,
            secret: credentials.secretKey,
            password: credentials.password, // Para exchanges como OKX
            enableRateLimit: true,
            timeout: 20000, // Timeout maior para operações autenticadas
            options: {
                'createMarketBuyOrderRequiresPrice': false
            }
        });

        privateCcxtInstances.set(exchangeAcronym, instance);
        return instance;
    }

    return privateCcxtInstances.get(exchangeAcronym);
}

function formatTimestamp(date) {
    return (date || new Date()).toISOString();
}

function log(level, message, data, strategyId) {
    const prefix = '[cross-market]';
    const ts = formatTimestamp();
    const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

    if (data) {
        logFn(prefix, '[' + ts + ']', '[' + level.toUpperCase() + ']', message, JSON.stringify(data));
    } else {
        logFn(prefix, '[' + ts + ']', '[' + level.toUpperCase() + ']', message);
    }

    // Armazenar log para o frontend
    logsStore.push({
        timestamp: ts,
        level: level.toUpperCase(),
        message,
        data: data || null,
        strategyId: strategyId || null
    });

    // Manter apenas os últimos logs
    while (logsStore.length > MAX_LOGS) {
        logsStore.shift();
    }
}

/**
 * Atualiza o cache de estratégias ativas
 */
async function refreshStrategies() {
    try {
        const { getAllCrossMarketStrategies } = require('./database');
        const all = await getAllCrossMarketStrategies();
        cachedStrategies = (all || []).filter(function (s) { return s.active; });
        log('info', 'Cache atualizado: ' + cachedStrategies.length + ' estrategia(s) ativa(s)');
    } catch (error) {
        log('error', 'Falha ao atualizar cache', { error: error.message });
    }
}

/**
 * Busca o preço de um par usando CCXT
 * O CCXT formata o símbolo automaticamente no padrão correto de cada exchange
 * Ex: HYPE/USD → HYPE/USD (binance), HYPE-USD (okx), HYPE_USD (gateio)
 */
async function fetchTickerPrice(exchangeAcronym, asset1, asset2) {
    try {
        var exchange = await getCcxtInstance(exchangeAcronym);
        if (!exchange) {
            throw new Error('Exchange nao suportada pelo CCXT: ' + exchangeAcronym);
        }

        // Montar o par no formato CCXT: BASE/QUOTE
        // O CCXT automaticamente converte para o formato correto de cada exchange
        var symbol = asset2 + '/' + asset1;

        /*
        log('info', 'Buscando ticker', {
            exchange: exchangeAcronym,
            symbol: symbol,
            ccxtId: exchange.id
        });*/

        // Usar fetchTicker do CCXT que já retorna o preço atual (last)
        var ticker = await exchange.fetchTicker(symbol);

        if (!ticker || typeof ticker.last !== 'number' || ticker.last <= 0) {
            throw new Error('Preco invalido via CCXT para ' + symbol + ' em ' + exchangeAcronym);
        }

        /*  log('info', 'Ticker obtido', {
              exchange: exchangeAcronym,
              symbol: symbol,
              price: ticker.last,
              bid: ticker.bid,
              ask: ticker.ask
          });
          */

        // Retorna o preço médio entre bid e ask se disponível, senão last
        if (ticker.bid && ticker.ask) {
            return (ticker.bid + ticker.ask) / 2;
        }

        return ticker.last;
    } catch (error) {
        log('error', 'Falha ao buscar ticker via CCXT', {
            exchange: exchangeAcronym,
            pair: asset2 + '/' + asset1,
            error: error.message
        });
        return null;
    }
}

/**
 * Executa a operação de compra e venda em modo live.
 */
async function executeCrossMarketTrade(strategy, buyExchange, sellExchange, buyPrice, sellPrice) {
    const symbol = `${strategy.asset2}/${strategy.asset1}`;
    const quoteAmount = strategy.operationAmount; // Valor em moeda de cotação (ex: 10 USDT)

    try {
        // 1. Obter instâncias autenticadas e carregar mercados para obter regras de precisão
        const buyInstance = await getCcxtInstance(buyExchange, true);
        const sellInstance = await getCcxtInstance(sellExchange, true);
        await Promise.all([
            buyInstance.loadMarkets(),
            sellInstance.loadMarkets()
        ]);

        // Calcula a quantidade da moeda base (ex: HYPE) e formata com a precisão de cada exchange
        const rawBaseAmount = quoteAmount / buyPrice;
        let buyAmountFormatted = buyInstance.amountToPrecision(symbol, rawBaseAmount);
        let sellAmountFormatted = sellInstance.amountToPrecision(symbol, rawBaseAmount);

        // FALLBACK: Se o arredondamento zerou a quantidade mas o valor bruto original era maior que zero,
        // força o uso de uma precisão manual (ex: 4 casas decimais) para evitar ordem zerada.
        if (parseFloat(buyAmountFormatted) === 0 && rawBaseAmount > 0) {
            buyAmountFormatted = rawBaseAmount.toFixed(4);
        }
        if (parseFloat(sellAmountFormatted) === 0 && rawBaseAmount > 0) {
            sellAmountFormatted = rawBaseAmount.toFixed(4);
        }

        log('info', 'Iniciando execucao de trade LIVE', {
            strategy: strategy.name,
            symbol,
            quoteAmount: quoteAmount,
            buyAmount: buyAmountFormatted,
            sellAmount: sellAmountFormatted,
            buyAt: buyExchange,
            sellAt: sellExchange
        }, strategy._id);

        const buyAmountNum = parseFloat(buyAmountFormatted);
        const sellAmountNum = parseFloat(sellAmountFormatted);

        if (isNaN(buyAmountNum) || buyAmountNum <= 0 || isNaN(sellAmountNum) || sellAmountNum <= 0) {
            throw new Error(`Quantidade invalida apos formatar precisao: compra=${buyAmountFormatted}, venda=${sellAmountFormatted}. Aumente o valor de operacao da estrategia.`);
        }

        // Tentar obter limites mínimos dos mercados do CCXT se definidos
        const buyMarket = buyInstance.market(symbol);
        const sellMarket = sellInstance.market(symbol);

        if (buyMarket && buyMarket.limits && buyMarket.limits.amount && buyMarket.limits.amount.min) {
            if (buyAmountNum < buyMarket.limits.amount.min) {
                throw new Error(`Quantidade de compra ${buyAmountNum} abaixo do minimo permitido pela exchange ${buyExchange} (${buyMarket.limits.amount.min} ${strategy.asset2})`);
            }
        }
        if (sellMarket && sellMarket.limits && sellMarket.limits.amount && sellMarket.limits.amount.min) {
            if (sellAmountNum < sellMarket.limits.amount.min) {
                throw new Error(`Quantidade de venda ${sellAmountNum} abaixo do minimo permitido pela exchange ${sellExchange} (${sellMarket.limits.amount.min} ${strategy.asset2})`);
            }
        }

        // 2. Validar saldos
        const buyBalance = await buyInstance.fetchBalance();
        const quoteBalance = buyBalance.free[strategy.asset1];
        if (!quoteBalance || quoteBalance < quoteAmount) {
            throw new Error(`Saldo insuficiente em ${buyExchange}: necessario ~${quoteAmount.toFixed(4)} ${strategy.asset1}, disponivel ${quoteBalance || 0}`);
        }

        const sellBalance = await sellInstance.fetchBalance();
        const baseBalance = sellBalance.free[strategy.asset2];
        // Valida contra o lote formatado de venda, que é o que será enviado para a API
        if (!baseBalance || baseBalance < parseFloat(sellAmountFormatted)) {
            throw new Error(`Saldo insuficiente em ${sellExchange}: necessario ${sellAmountFormatted} ${strategy.asset2}, disponivel ${baseBalance || 0}`);
        }

        log('info', 'Saldos validados com sucesso', {
            buyExchange,
            sellExchange
        }, strategy._id);

        // 3. Executar ordens (market orders para agilidade)
        let buyOrder, sellOrder;
        try {
            log('info', 'Enviando ordens SIMULTANEAS', {
                buyExchange,
                sellExchange,
                symbol,
                buyAmount: buyAmountFormatted,
                sellAmount: sellAmountFormatted
            }, strategy._id);
            [buyOrder, sellOrder] = await Promise.all([
                buyInstance.createMarketBuyOrder(symbol, parseFloat(buyAmountFormatted), buyPrice),
                sellInstance.createMarketSellOrder(symbol, parseFloat(sellAmountFormatted))
            ]);




            log('info', 'Ordem de COMPRA executada', { exchange: buyExchange, orderId: buyOrder.id }, strategy._id);
            log('info', 'Ordem de VENDA executada', { exchange: sellExchange, orderId: sellOrder.id }, strategy._id);
        } catch (error) {
            var isBuyError = error.message && (error.message.includes('buy') || error.message.includes('COMPRA'));
            if (isBuyError && !sellOrder) {
                log('error', 'Falha ao executar ordem de COMPRA', { exchange: buyExchange, error: error.message }, strategy._id);
                throw new Error(`Falha na ordem de compra em ${buyExchange}: ${error.message}`);
            } else {
                log('error', 'FALHA CRITICA: Compra executada, mas VENDA falhou!', {
                    strategy: strategy.name,
                    buyOrder,
                    sellError: error.message
                }, strategy._id);
                return {
                    success: false,
                    message: `RISCO: Compra em ${buyExchange} OK, mas venda em ${sellExchange} FALHOU: ${error.message}`,
                    buyOrder,
                    sellOrder: null
                };
            }
        }

        return {
            success: true,
            message: 'Trade executado com sucesso em ambas as pontas.',
            buyOrder,
            sellOrder
        };

    } catch (error) {
        log('error', 'Erro durante a execucao do trade LIVE', {
            strategy: strategy.name,
            error: error.message
        }, strategy._id);
        return {
            success: false,
            message: error.message,
            buyOrder: null,
            sellOrder: null
        };
    }
}

/**
 * Executa uma varredura (scan) para uma estratégia
 */
async function executeScan(strategy) {
    var result = {
        strategyId: strategy._id,
        strategyName: strategy.name,
        exchange1: strategy.exchange1,
        exchange2: strategy.exchange2,
        asset1: strategy.asset1,
        asset2: strategy.asset2,
        operationAmount: strategy.operationAmount,
        timestamp: new Date().toISOString(),
        price1: null,
        price2: null,
        spreadPercent: null,
        estimatedProfit: null,
        estimatedProfitPercent: null,
        hasOpportunity: false,
        simulationAction: null,
        liveExecution: null,
        error: null
    };

    try {
        /*
         log('info', 'Executando scan', {
             strategy: strategy.name,
             pair: strategy.asset2 + '/' + strategy.asset1,
             exchanges: strategy.exchange1 + ' vs ' + strategy.exchange2
         }, strategy._id);
         */

        // Buscar preços simultaneamente
        var [price1, price2] = await Promise.all([
            fetchTickerPrice(strategy.exchange1, strategy.asset1, strategy.asset2),
            fetchTickerPrice(strategy.exchange2, strategy.asset1, strategy.asset2)
        ]);

        result.price1 = price1;
        result.price2 = price2;

        if (price1 === null || price2 === null) {
            result.error = 'Nao foi possivel obter precos de uma ou ambas as exchanges';
            log('warn', 'Scan incompleto', { error: result.error }, strategy._id);
            return result;
        }

        // Calcular spread
        var higherPrice = Math.max(price1, price2);
        var lowerPrice = Math.min(price1, price2);
        var spread = higherPrice - lowerPrice;
        var midPrice = (price1 + price2) / 2;
        var spreadPercent = (spread / midPrice) * 100;

        result.spreadPercent = spreadPercent;

        // Verificar se o spread atende o mínimo configurado
        var minSpread = strategy.minSpreadPercent || 0.1;
        var tradingFee = strategy.tradingFeePercent || 0.1;
        var totalCost = tradingFee;
        var netSpread = spreadPercent - totalCost;

        // O lucro estimado agora é calculado sobre o valor da operação (em moeda de cotação)
        const quoteAmount = strategy.operationAmount;
        const estimatedProfitInQuote = (quoteAmount * netSpread) / 100;
        result.estimatedProfitPercent = netSpread;
        result.estimatedProfit = estimatedProfitInQuote;

        if (netSpread > minSpread) {
            result.hasOpportunity = true;

            if (price1 < price2) {
                result.simulationAction = 'Comprar em ' + strategy.exchange1 + ' e vender em ' + strategy.exchange2;
            } else {
                result.simulationAction = 'Comprar em ' + strategy.exchange2 + ' e vender em ' + strategy.exchange1;
            }

            log('info', 'OPORTUNIDADE ENCONTRADA', {
                strategy: strategy.name,
                spread: spreadPercent.toFixed(4) + '%',
                profit: netSpread.toFixed(4) + '%',
                action: result.simulationAction,
                liveMode: strategy.enableLiveTrading
            }, strategy._id);

            // Se estiver em modo live, executa a operação
            if (strategy.enableLiveTrading) {
                const buyExchange = price1 < price2 ? strategy.exchange1 : strategy.exchange2;
                const sellExchange = price1 < price2 ? strategy.exchange2 : strategy.exchange1;
                const buyPrice = Math.min(price1, price2);
                const sellPrice = Math.max(price1, price2);

                const executionResult = await executeCrossMarketTrade(strategy, buyExchange, sellExchange, buyPrice, sellPrice);
                result.liveExecution = executionResult;
            }

        } else {
            log('info', 'Sem oportunidade', {
                strategy: strategy.name,
                spread: spreadPercent.toFixed(4) + '%',
                minRequired: (minSpread + totalCost).toFixed(4) + '%',
                netProfit: netSpread.toFixed(4) + '%'
            }, strategy._id);
        }
    } catch (error) {
        result.error = error.message;
        log('error', 'Erro no scan', { strategy: strategy.name, error: error.message }, strategy._id);
    }

    return result;
}

/**
 * Inicia o monitoramento contínuo de uma estratégia
 */
function startStrategyScan(strategy) {
    var strategyId = String(strategy._id);

    // Se já existe um loop ativo, não criar outro
    if (scanIntervals.has(strategyId)) {
        log('warn', 'Scan ja em execucao para estrategia', { strategy: strategy.name }, strategy._id);
        return;
    }

    var intervalMs = strategy.scanIntervalMs || 5000;

    log('info', 'Iniciando scan continuo', {
        strategy: strategy.name,
        interval: intervalMs + 'ms'
    }, strategy._id);

    // Marca presença imediatamente para evitar dupla inicialização simultânea
    scanIntervals.set(strategyId, true);

    // tick() executa o scan e, só após terminar completamente (await),
    // agenda a próxima chamada via setTimeout — garantindo execução 100% sequencial.
    async function tick() {
        // Se a estratégia foi pausada/removida, interrompe o ciclo silenciosamente
        if (!scanIntervals.has(strategyId)) return;

        try {
            const result = await executeScan(strategy);
            emitScanResult(result);
        } catch (err) {
            log('error', 'Erro interno no ciclo de scan', { error: err.message }, strategy._id);
        }

        // Só agenda o próximo ciclo se o scan ainda estiver ativo
        if (scanIntervals.has(strategyId)) {
            var timeoutId = setTimeout(tick, intervalMs);
            // Atualiza o Map com o id do timeout para permitir cancelamento
            scanIntervals.set(strategyId, timeoutId);
        }
    }

    // Inicia a primeira execução imediatamente (sem esperar intervalMs)
    tick();
}

/**
 * Para o monitoramento contínuo de uma estratégia
 */
function stopStrategyScan(strategyId) {
    var id = String(strategyId);

    if (scanIntervals.has(id)) {
        var activeTimeout = scanIntervals.get(id);
        // activeTimeout pode ser 'true' (placeholder do scan inicial ainda em execução)
        // ou um ID de timeout numérico. clearTimeout(true) é inofensivo, mas a guarda
        // deixa a intenção explícita.
        if (activeTimeout !== true) {
            clearTimeout(activeTimeout);
        }
        scanIntervals.delete(id);
        log('info', 'Scan interrompido para estrategia', { strategyId: id }, id);
    }
}

/**
 * Para todos os scans em execução
 */
function stopAllScans() {
    log('info', 'Parando todos os scans em execucao: ' + scanIntervals.size);

    scanIntervals.forEach(function (timeoutId) {
        if (timeoutId !== true) {
            clearTimeout(timeoutId);
        }
    });

    scanIntervals.clear();
}

/**
 * Callback para resultados de scan (pode ser sobrescrito externamente)
 */
var onScanResult = null;

function emitScanResult(result) {
    if (typeof onScanResult === 'function') {
        onScanResult(result);
    }
}

/**
 * Inicializa o serviço: carrega estratégias e inicia scans
 */
async function initialize() {
    log('info', 'Inicializando servico Cross-Market');
    await refreshStrategies();

    // Iniciar scan para cada estratégia ativa
    cachedStrategies.forEach(function (strategy) {
        startStrategyScan(strategy);
    });

    log('info', 'Servico Cross-Market inicializado com ' + cachedStrategies.length + ' estrategia(s)');
}

/**
 * Reinicia o serviço (após alterações nas estratégias)
 */
async function restart() {
    log('info', 'Reiniciando servico Cross-Market');
    stopAllScans();
    await refreshStrategies();

    cachedStrategies.forEach(function (strategy) {
        startStrategyScan(strategy);
    });

    log('info', 'Servico Cross-Market reiniciado com ' + cachedStrategies.length + ' estrategia(s)');
}

/**
 * Obtém o status atual do serviço
 */
function getStatus() {
    return {
        activeStrategies: cachedStrategies.length,
        runningScans: scanIntervals.size,
        opportunities: 0,
        strategies: cachedStrategies.map(function (s) {
            return {
                id: s._id,
                name: s.name,
                exchange1: s.exchange1,
                exchange2: s.exchange2,
                asset1: s.asset1,
                asset2: s.asset2,
                interval: s.scanIntervalMs || 5000
            };
        })
    };
}

/**
 * Recupera logs armazenados em memória
 */
function getLogs(limit = 200, strategyId) {
    const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), MAX_LOGS);
    let logs = logsStore;

    // Filtrar por strategyId se fornecido
    if (strategyId) {
        logs = logs.filter(log => log.strategyId === strategyId);
    }

    return logs.slice(-safeLimit).reverse();
}

/**
 * Obtém uma instância pública CCXT para consulta de saldos
 */
async function getPublicCcxtInstance(exchangeAcronym) {
    var ccxtId = EXCHANGE_CCXT_MAP[exchangeAcronym];
    if (!ccxtId) return null;

    var PublicExchangeClass = ccxt[ccxtId];
    if (!PublicExchangeClass) return null;

    return new PublicExchangeClass({
        enableRateLimit: true,
        timeout: 10000
    });
}

module.exports = {
    initialize,
    restart,
    refreshStrategies,
    executeScan,
    startStrategyScan,
    stopStrategyScan,
    stopAllScans,
    getStatus,
    getLogs,
    getPublicCcxtInstance,
    getCcxtInstance,
    onScanResult: {
        get: function () { return onScanResult; },
        set: function (fn) { onScanResult = fn; }
    }
};
