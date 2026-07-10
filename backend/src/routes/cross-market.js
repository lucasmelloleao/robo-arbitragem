const ccxt = require('ccxt');
const { readJsonBody, sendJson } = require('../http-utils');
const {
    getAllCrossMarketStrategies,
    getCrossMarketStrategyById,
    createCrossMarketStrategy,
    updateCrossMarketStrategy,
    deleteCrossMarketStrategy,
    toggleCrossMarketStrategy,
    getCrossMarketTrades,
    getCrossMarketTradesCount,
    createSimpleTrade,
    getSimpleTrades,
    getSimpleTradesCount
} = require('../database');
const crossMarketService = require('../cross-market-service');
const { verifyToken } = require('../middleware/auth-middleware');

async function listStrategies({ request, response }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const strategies = await getAllCrossMarketStrategies(decoded.id);
        sendJson(response, 200, { strategies });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function getStrategyById({ request, response, params }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const { id } = params;
        const strategy = await getCrossMarketStrategyById(id, decoded.id);
        if (!strategy) {
            sendJson(response, 404, { error: 'Estratégia não encontrada' });
            return;
        }
        sendJson(response, 200, { strategy });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function createStrategy({ request, response }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const body = await readJsonBody(request);
        const { name, exchange1, exchange2, asset1, asset2, operationAmount } = body;

        if (!name || !exchange1 || !exchange2 || !asset1 || !asset2 || !operationAmount) {
            sendJson(response, 400, {
                error: 'Campos obrigatórios: name, exchange1, exchange2, asset1, asset2, operationAmount'
            });
            return;
        }

        // Mesma corretora permitida por solicitação do usuário

        const strategyData = {
            name: name.trim(),
            exchange1: exchange1.trim().toUpperCase(),
            exchange2: exchange2.trim().toUpperCase(),
            asset1: asset1.trim().toUpperCase(),
            asset2: asset2.trim().toUpperCase(),
            operationAmount: Number(operationAmount),
            minSpreadPercent: body.minSpreadPercent !== undefined ? Number(body.minSpreadPercent) : 0.1,
            maxSlippagePercent: body.maxSlippagePercent !== undefined ? Number(body.maxSlippagePercent) : 0.15,
            tradingFeePercent: body.tradingFeePercent !== undefined ? Number(body.tradingFeePercent) : 0.1,
            scanIntervalMs: body.scanIntervalMs !== undefined ? Number(body.scanIntervalMs) : 5000,
            enableLiveTrading: Boolean(body.enableLiveTrading),
            active: body.active !== undefined ? Boolean(body.active) : true,
            notes: body.notes || ''
        };

        const strategy = await createCrossMarketStrategy(decoded.id, strategyData);

        // Reiniciar serviço para incluir nova estratégia
        await crossMarketService.restart();

        sendJson(response, 201, { strategy });
    } catch (error) {
        if (error.code === 11000) {
            sendJson(response, 409, { error: 'Já existe uma estratégia com esta combinação de corretoras e moedas' });
            return;
        }
        sendJson(response, 400, { error: error.message });
    }
}

async function updateStrategy({ request, response, params }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const { id } = params;
        const body = await readJsonBody(request);

        const existing = await getCrossMarketStrategyById(id, decoded.id);
        if (!existing) {
            sendJson(response, 404, { error: 'Estratégia não encontrada' });
            return;
        }

        const updates = {};

        if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim();
        if (typeof body.exchange1 === 'string' && body.exchange1.trim()) updates.exchange1 = body.exchange1.trim().toUpperCase();
        if (typeof body.exchange2 === 'string' && body.exchange2.trim()) updates.exchange2 = body.exchange2.trim().toUpperCase();
        if (typeof body.asset1 === 'string' && body.asset1.trim()) updates.asset1 = body.asset1.trim().toUpperCase();
        if (typeof body.asset2 === 'string' && body.asset2.trim()) updates.asset2 = body.asset2.trim().toUpperCase();
        if (body.operationAmount !== undefined) updates.operationAmount = Number(body.operationAmount);
        if (body.minSpreadPercent !== undefined) updates.minSpreadPercent = Number(body.minSpreadPercent);
        if (body.maxSlippagePercent !== undefined) updates.maxSlippagePercent = Number(body.maxSlippagePercent);
        if (body.tradingFeePercent !== undefined) updates.tradingFeePercent = Number(body.tradingFeePercent);
        if (body.scanIntervalMs !== undefined) updates.scanIntervalMs = Number(body.scanIntervalMs);
        if (typeof body.enableLiveTrading === 'boolean') updates.enableLiveTrading = body.enableLiveTrading;
        if (typeof body.active === 'boolean') updates.active = body.active;
        if (typeof body.notes === 'string') updates.notes = body.notes.trim();

        if (Object.keys(updates).length === 0) {
            sendJson(response, 400, { error: 'Nenhum campo válido para atualização' });
            return;
        }

        // Mesma corretora permitida por solicitação do usuário

        const strategy = await updateCrossMarketStrategy(id, decoded.id, updates);

        await crossMarketService.restart();

        sendJson(response, 200, { strategy });
    } catch (error) {
        sendJson(response, 400, { error: error.message });
    }
}

async function deleteStrategy({ request, response, params }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const { id } = params;
        const strategy = await deleteCrossMarketStrategy(id, decoded.id);
        if (!strategy) {
            sendJson(response, 404, { error: 'Estratégia não encontrada' });
            return;
        }
        await crossMarketService.restart();
        sendJson(response, 200, { message: 'Estratégia removida com sucesso' });
    } catch (error) {
        sendJson(response, 400, { error: error.message });
    }
}

async function toggleStrategy({ request, response, params }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const { id } = params;
        const strategy = await toggleCrossMarketStrategy(id, decoded.id);
        if (!strategy) {
            sendJson(response, 404, { error: 'Estratégia não encontrada' });
            return;
        }
        await crossMarketService.restart();
        sendJson(response, 200, { strategy });
    } catch (error) {
        sendJson(response, 400, { error: error.message });
    }
}

async function executeScanHandler({ request, response, params }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const { id } = params;
        const strategy = await getCrossMarketStrategyById(id, decoded.id);
        if (!strategy) {
            sendJson(response, 404, { error: 'Estratégia não encontrada' });
            return;
        }
        const result = await crossMarketService.executeScan(strategy);
        sendJson(response, 200, { scan: result });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function getServiceStatus({ response }) {
    try {
        const status = crossMarketService.getStatus();
        sendJson(response, 200, { status });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function getLogs({ response, query }) {
    try {
        const limit = query && query.limit ? Number(query.limit) : 200;
        const strategyId = query && query.strategyId ? query.strategyId : null;
        const logs = crossMarketService.getLogs(limit, strategyId);
        sendJson(response, 200, { logs });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function getBalances({ request, response, params }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const { exchangeId } = params;
        const strategies = await getAllCrossMarketStrategies(decoded.id);
        const activeStrategies = (strategies || []).filter((s) => s.active);
        
        // Buscar saldos de todas as exchanges usadas nas estratégias
        const exchangesInStrategies = new Set();
        activeStrategies.forEach((s) => {
            exchangesInStrategies.add(s.exchange1);
            exchangesInStrategies.add(s.exchange2);
        });
        
        // Se exchangeId for fornecido, filtrar apenas essa exchange
        const targetExchanges = exchangeId 
            ? [exchangeId.toUpperCase()]
            : Array.from(exchangesInStrategies);
        
        const balances = [];
        
        for (const exchangeAcronym of targetExchanges) {
            try {
                let exchangeInstance = await crossMarketService.getPublicCcxtInstance(exchangeAcronym);
                
                if (!exchangeInstance) {
                    balances.push({
                        exchange: exchangeAcronym,
                        error: 'Exchange não suportada'
                    });
                    continue;
                }
                
                let balanceData;
                let tickers = {};
                try {
                    // Obtém a instância autenticada para garantir acesso aos saldos privados
                    const authenticatedInstance = await crossMarketService.getCcxtInstance(exchangeAcronym, true);
                    if (!authenticatedInstance) {
                        throw new Error('Instância autenticada não disponível para ' + exchangeAcronym);
                    }
                    
                    // Busca saldo do cache de forma instantânea
                    balanceData = await crossMarketService.getCachedBalance(exchangeAcronym);

                    // Obter preços usando a instância autenticada para as moedas que têm saldo
                    try {
                        const activeCoins = Object.keys(balanceData.free || {}).filter((coin) => {
                            const total = (balanceData.free[coin] || 0) + (balanceData.used[coin] || 0);
                            return total > 0.000001 && coin !== 'USDT';
                        });

                        if (activeCoins.length > 0) {
                            if (Object.keys(authenticatedInstance.markets || {}).length === 0) {
                                await authenticatedInstance.loadMarkets().catch(() => {});
                            }

                            // Busca preços em paralelo apenas das moedas com saldo
                            const tickerPromises = activeCoins.map(async (coin) => {
                                const symbol = `${coin}/USDT`;
                                if (authenticatedInstance.markets && authenticatedInstance.markets[symbol]) {
                                    try {
                                        const tick = await authenticatedInstance.fetchTicker(symbol);
                                        return { coin, price: tick.last || tick.close };
                                    } catch (e) {
                                        return null;
                                    }
                                }
                                return null;
                            });

                            const results = await Promise.all(tickerPromises);
                            results.forEach((r) => {
                                if (r) tickers[r.coin] = r.price;
                            });
                        }
                    } catch (tickerError) {
                        console.warn(`[balances] Erro ao obter tickers para ${exchangeAcronym}:`, tickerError.message);
                    }
                } catch (publicError) {
                    // Fallback para caso de erro geral ou falha na instância autenticada
                    const authenticatedInstance = await crossMarketService.getCcxtInstance(exchangeAcronym, true);
                    if (!authenticatedInstance) {
                        throw new Error('Instância autenticada não disponível para ' + exchangeAcronym);
                    }
                    balanceData = await authenticatedInstance.fetchBalance();
                    
                    // Obter preços usando a instância autenticada para as moedas que têm saldo
                    try {
                        const activeCoins = Object.keys(balanceData.free || {}).filter((coin) => {
                            const total = (balanceData.free[coin] || 0) + (balanceData.used[coin] || 0);
                            return total > 0.000001 && coin !== 'USDT';
                        });

                        if (activeCoins.length > 0) {
                            // Tentar carregar os mercados primeiro se necessário
                            if (Object.keys(authenticatedInstance.markets || {}).length === 0) {
                                await authenticatedInstance.loadMarkets().catch(() => {});
                            }

                            // Busca preços em paralelo apenas das moedas com saldo
                            const tickerPromises = activeCoins.map(async (coin) => {
                                const symbol = `${coin}/USDT`;
                                // Verifica se o mercado existe antes de buscar
                                if (authenticatedInstance.markets && authenticatedInstance.markets[symbol]) {
                                    try {
                                        const tick = await authenticatedInstance.fetchTicker(symbol);
                                        return { coin, price: tick.last || tick.close };
                                    } catch (e) {
                                        return null;
                                    }
                                }
                                return null;
                            });

                            const results = await Promise.all(tickerPromises);
                            results.forEach((r) => {
                                if (r) tickers[r.coin] = r.price;
                            });
                        }
                    } catch (tickerError) {
                        console.warn(`[balances] Erro ao obter tickers para ${exchangeAcronym}:`, tickerError.message);
                    }
                }

                // Se passou na API pública sem erro, buscar preços das moedas com saldo
                if (Object.keys(tickers).length === 0 && balanceData) {
                    try {
                        const activeCoins = Object.keys(balanceData.free || {}).filter((coin) => {
                            const total = (balanceData.free[coin] || 0) + (balanceData.used[coin] || 0);
                            return total > 0.000001 && coin !== 'USDT';
                        });

                        if (activeCoins.length > 0) {
                            if (Object.keys(exchangeInstance.markets || {}).length === 0) {
                                await exchangeInstance.loadMarkets().catch(() => {});
                            }

                            const tickerPromises = activeCoins.map(async (coin) => {
                                const symbol = `${coin}/USDT`;
                                if (exchangeInstance.markets && exchangeInstance.markets[symbol]) {
                                    try {
                                        const tick = await exchangeInstance.fetchTicker(symbol);
                                        return { coin, price: tick.last || tick.close };
                                    } catch (e) {
                                        return null;
                                    }
                                }
                                return null;
                            });

                            const results = await Promise.all(tickerPromises);
                            results.forEach((r) => {
                                if (r) tickers[r.coin] = r.price;
                            });
                        }
                    } catch (publicTickerErr) {
                        console.warn(`[balances] Erro ao obter tickers publicos para ${exchangeAcronym}:`, publicTickerErr.message);
                    }
                }
                
                const assets = Object.keys(balanceData.free || {}).filter((coin) => {
                    const total = (balanceData.free[coin] || 0) + (balanceData.used[coin] || 0);
                    return total > 0.000001;
                }).map((coin) => {
                    const total = (balanceData.free[coin] || 0) + (balanceData.used[coin] || 0);
                    
                    // Calcular valor em USDT
                    let valueUsdt = null;
                    if (coin === 'USDT') {
                        valueUsdt = total;
                    } else if (tickers[coin]) {
                        valueUsdt = total * tickers[coin];
                    }
                    
                    return {
                        currency: coin,
                        total: total,
                        free: balanceData.free[coin] || 0,
                        used: balanceData.used[coin] || 0,
                        valueUsdt: valueUsdt,
                        price: coin === 'USDT' ? 1.0 : (tickers[coin] || null)
                    };
                });
                
                balances.push({
                    exchange: exchangeAcronym,
                    assets: assets
                });
            } catch (error) {
                balances.push({
                    exchange: exchangeAcronym,
                    error: error.message
                });
            }
        }
        
        sendJson(response, 200, { balances });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function executeAllStrategies({ request, response }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const strategies = await getAllCrossMarketStrategies(decoded.id);
        const activeStrategies = (strategies || []).filter((s) => s.active);
        const results = [];
        for (const strategy of activeStrategies) {
            const result = await crossMarketService.executeScan(strategy);
            results.push(result);
        }
        sendJson(response, 200, {
            message: `Execução concluída em ${results.length} estratégia(s).`,
            results
        });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function executeStrategyById({ request, response, params }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const { id } = params;
        const strategy = await getCrossMarketStrategyById(id, decoded.id);
        if (!strategy) {
            sendJson(response, 404, { error: 'Estratégia não encontrada' });
            return;
        }
        const result = await crossMarketService.executeScan(strategy);
        sendJson(response, 200, { scan: result });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function startAutoExecution({ request, response, params }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const { id } = params;
        const strategy = await getCrossMarketStrategyById(id, decoded.id);
        if (!strategy) {
            sendJson(response, 404, { error: 'Estratégia não encontrada' });
            return;
        }
        if (!crossMarketService.startStrategyScan) {
            sendJson(response, 500, { error: 'Serviço não suporta escuta contínua' });
            return;
        }
        await updateCrossMarketStrategy(id, decoded.id, { active: true });
        crossMarketService.startStrategyScan(strategy);
        sendJson(response, 200, {
            message: `Escuta contínua ativada para estratégia ${strategy.name}. Intervalo: ${strategy.scanIntervalMs || 5000}ms`
        });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function stopAutoExecution({ request, response, params }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const { id } = params;
        const strategy = await getCrossMarketStrategyById(id, decoded.id);
        if (!strategy) {
            sendJson(response, 404, { error: 'Estratégia não encontrada' });
            return;
        }
        if (!crossMarketService.stopStrategyScan) {
            sendJson(response, 500, { error: 'Serviço não suporta parada de escuta' });
            return;
        }
        await updateCrossMarketStrategy(id, decoded.id, { active: false });
        crossMarketService.stopStrategyScan(id);
        sendJson(response, 200, {
            message: `Escuta contínua interrompida para estratégia ${strategy.name}`
        });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function getTradesList({ request, response }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
        const limit = parseInt(url.searchParams.get('limit')) || 50;
        const skip = parseInt(url.searchParams.get('skip')) || 0;
        const status = url.searchParams.get('status');
        const strategyId = url.searchParams.get('strategyId');

        const filter = {};
        if (status) filter.status = status;
        if (strategyId) filter.strategyId = strategyId;

        const [trades, total] = await Promise.all([
            getCrossMarketTrades(decoded.id, filter, { limit, skip }),
            getCrossMarketTradesCount(decoded.id, filter)
        ]);

        sendJson(response, 200, { trades, total, limit, skip });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function getTradesStats({ request, response }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const trades = await getCrossMarketTrades(decoded.id, {}, { limit: 1000 });
        
        let totalProfit = 0;
        let successCount = 0;
        let partialFailureCount = 0;
        let failedCount = 0;
        const profitByCoin = {};
        const profitByExchange = {};
        const countByStrategy = {};

        trades.forEach(t => {
            if (t.status === 'SUCCESS') {
                successCount++;
                totalProfit += t.estimatedProfit || 0;

                const coin = t.quoteAsset || 'USDT';
                profitByCoin[coin] = (profitByCoin[coin] || 0) + (t.estimatedProfit || 0);

                const buyEx = t.buyExchange;
                const sellEx = t.sellExchange;
                profitByExchange[buyEx] = (profitByExchange[buyEx] || 0) - (t.estimatedProfit / 2);
                profitByExchange[sellEx] = (profitByExchange[sellEx] || 0) + (t.estimatedProfit / 2);
            } else if (t.status === 'PARTIAL_FAILURE') {
                partialFailureCount++;
            } else {
                failedCount++;
            }

            countByStrategy[t.strategyName] = (countByStrategy[t.strategyName] || 0) + 1;
        });

        sendJson(response, 200, {
            totalTrades: trades.length,
            successCount,
            partialFailureCount,
            failedCount,
            totalProfit,
                        profitByCoin,
            profitByExchange,
            countByStrategy
        });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function executeSimpleTrade({ request, response, params }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;

    const { exchangeId } = params;
    const exchangeAcronym = exchangeId.toUpperCase();

    let originalSymbol, side, amount;
    try {
        const body = await readJsonBody(request);
        originalSymbol = body.symbol;
        side = body.side;
        amount = body.amount;
    } catch (e) {
        sendJson(response, 400, { error: 'Corpo da requisição inválido' });
        return;
    }

    if (!originalSymbol || !side || !amount) {
        sendJson(response, 400, { error: 'Campos obrigatórios: symbol, side, amount' });
        return;
    }

    const [asset1, asset2] = originalSymbol.split('/');
    if (asset1 === asset2) {
        sendJson(response, 400, { error: 'Não é possível fazer trade de uma moeda por ela mesma.' });
        return;
    }

    let symbol = originalSymbol;
    let sideResolved = side.toLowerCase();
    let finalAmount = Number(amount);
    let orderPrice = 0;
    let orderId = null;
    let orderFee = null;
    let rawOrder = null;

    try {
        const instance = await crossMarketService.getCcxtInstance(exchangeAcronym, true);
        if (!instance) {
            throw new Error(`Corretora ${exchangeAcronym} não configurada ou inativa`);
        }

        if (Object.keys(instance.markets || {}).length === 0) {
            await instance.loadMarkets().catch(() => {});
        }

        const reversedSymbol = `${asset2}/${asset1}`;
        let market = instance.markets[symbol];
        let isReversed = false;

        if (!market && instance.markets[reversedSymbol]) {
            symbol = reversedSymbol;
            market = instance.markets[symbol];
            isReversed = true;
            sideResolved = sideResolved === 'buy' ? 'sell' : 'buy';
            console.log(`[Simple Trade Symbol Resolution] Símbolo original ${originalSymbol} não encontrado. Usando reverso ${symbol} e invertendo para ${sideResolved}`);
        }

        if (!market) {
            throw new Error(`Símbolo ${originalSymbol} ou seu reverso não está disponível na corretora ${exchangeAcronym}`);
        }

        let currentMarketPrice = undefined;
        try {
            const ticker = await instance.fetchTicker(symbol);
            currentMarketPrice = ticker.close || ticker.last || undefined;
            orderPrice = currentMarketPrice || 0;
        } catch (err) {
            console.log(`[Simple Trade Price Fetch Warning] Não foi possível obter o preço do par ${symbol}: ${err.message}`);
        }

        if (isReversed) {
            if (currentMarketPrice && currentMarketPrice > 0) {
                finalAmount = finalAmount / currentMarketPrice;
                console.log(`[Simple Trade Amount Adjustment] Quantidade ajustada para reverso de ${amount} para ${finalAmount} no par ${symbol}`);
            } else {
                throw new Error(`Não foi possível realizar o trade com par reverso ${symbol} pois o preço atual do par é inválido.`);
            }
        }

        const minAmount = (market.limits && market.limits.amount && market.limits.amount.min) || 0;
        const precisionAmount = (market.precision && market.precision.amount) || 0.00000001;

        const limitFloor = Math.max(minAmount, precisionAmount);
        if (finalAmount < limitFloor) {
            finalAmount = limitFloor;
        }

        if (instance.amountToPrecision) {
            try {
                finalAmount = Number(instance.amountToPrecision(symbol, finalAmount));
            } catch (e) {
                const decimals = typeof precisionAmount === 'number' && precisionAmount < 1 
                    ? Math.round(Math.abs(Math.log10(precisionAmount))) 
                    : 4;
                finalAmount = Number(finalAmount.toFixed(decimals));
            }
        }

        console.log(`[Simple Trade] Executando ordem a mercado na ${exchangeAcronym}: ${sideResolved} ${finalAmount} ${symbol} com preço base ${currentMarketPrice}`);
        const order = await instance.createOrder(symbol, 'market', sideResolved, finalAmount, currentMarketPrice);

        rawOrder = order;
        orderId = order.id || order.clientOrderId;
        orderPrice = order.price || order.average || orderPrice || 0;

        let feeCost = 0;
        let feeCurrency = symbol.split('/')[1];

        if (order.fee && typeof order.fee.cost === 'number') {
            feeCost = order.fee.cost;
            if (order.fee.currency) {
                feeCurrency = order.fee.currency;
            }
        } else if (Array.isArray(order.fees) && order.fees.length > 0) {
            feeCost = order.fees.reduce((acc, f) => acc + (f.cost || 0), 0);
            feeCurrency = order.fees[0].currency || feeCurrency;
        } else if (orderId && instance.has && instance.has['fetchOrder']) {
            try {
                await new Promise(resolve => setTimeout(resolve, 500));
                const fetchedOrder = await instance.fetchOrder(orderId, symbol);
                if (fetchedOrder) {
                    if (fetchedOrder.fee && typeof fetchedOrder.fee.cost === 'number') {
                        feeCost = fetchedOrder.fee.cost;
                        if (fetchedOrder.fee.currency) {
                            feeCurrency = fetchedOrder.fee.currency;
                        }
                    } else if (Array.isArray(fetchedOrder.fees) && fetchedOrder.fees.length > 0) {
                        feeCost = fetchedOrder.fees.reduce((acc, f) => acc + (f.cost || 0), 0);
                        feeCurrency = fetchedOrder.fees[0].currency || feeCurrency;
                    }
                }
            } catch (err) {
                console.log(`[Simple Trade Fee Lookup Warning] Não foi possível buscar detalhes da ordem para taxa: ${err.message}`);
            }
        }

        orderFee = {
            cost: feeCost,
            currency: feeCurrency
        };

        if (!orderPrice) {
            try {
                const ticker = await instance.fetchTicker(symbol);
                orderPrice = ticker.close || ticker.last || 0;
            } catch (err) {}
        }

        await createSimpleTrade({
            userId: decoded.id,
            exchange: exchangeAcronym,
            symbol,
            side: side.toUpperCase(),
            amount: finalAmount,
            price: orderPrice,
            orderId,
            fee: orderFee,
            status: 'SUCCESS',
            rawOrder
        });

        if (crossMarketService.updateBalanceCache) {
            crossMarketService.updateBalanceCache(exchangeAcronym).catch(() => {});
        }

        sendJson(response, 200, {
            message: `Ordem de ${side.toUpperCase()} de ${finalAmount} ${symbol.split('/')[0]} executada com sucesso!`,
            order
        });
    } catch (error) {
        console.error('[Simple Trade Error]', error);

        await createSimpleTrade({
            userId: decoded.id,
            exchange: exchangeAcronym,
            symbol,
            side: side.toUpperCase(),
            amount: finalAmount,
            price: 0,
            status: 'FAILED',
            errorMessage: error.message
        }).catch(() => {});

        sendJson(response, 500, { error: error.message });
    }
}

async function getSimpleTradesList({ request, response }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const urlObj = new URL(request.url, `http://${request.headers.host}`);
        const limit = parseInt(urlObj.searchParams.get('limit')) || 50;
        const skip = parseInt(urlObj.searchParams.get('skip')) || 0;

        const [trades, total] = await Promise.all([
            getSimpleTrades(decoded.id, {}, { limit, skip }),
            getSimpleTradesCount(decoded.id)
        ]);

        sendJson(response, 200, { trades, total, limit, skip });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

function registerCrossMarketRoutes(router) {
    // Rotas estáticas GET primeiro para evitar colisão com parâmetros dinâmicos (:id)
    router.register('GET', '/api/cross-market', listStrategies);
    router.register('GET', '/api/cross-market/status', getServiceStatus);
    router.register('GET', '/api/cross-market/trades', getTradesList);
    router.register('GET', '/api/cross-market/trades/stats', getTradesStats);
    router.register('GET', '/api/cross-market/simple-trades', getSimpleTradesList);
    router.register('GET', '/api/cross-market/execute-all', executeAllStrategies);
    router.register('GET', '/api/cross-market/logs', getLogs);

    // Rotas dinâmicas GET
    router.register('GET', '/api/cross-market/:id', getStrategyById);
    router.register('GET', '/api/cross-market/:id/scan', executeScanHandler);
    router.register('GET', '/api/cross-market/:id/execute', executeStrategyById);
    router.register('GET', '/api/cross-market/:id/subscribe', startAutoExecution);
    router.register('GET', '/api/cross-market/:id/unsubscribe', stopAutoExecution);
    router.register('GET', '/api/cross-market/:exchangeId/balances', getBalances);

    // Outros métodos
    router.register('POST', '/api/cross-market', createStrategy);
    router.register('POST', '/api/cross-market/:exchangeId/trade', executeSimpleTrade);
    router.register('PUT', '/api/cross-market/:id', updateStrategy);
    router.register('DELETE', '/api/cross-market/:id', deleteStrategy);
    router.register('PATCH', '/api/cross-market/:id/toggle', toggleStrategy);
}

module.exports = { registerCrossMarketRoutes };