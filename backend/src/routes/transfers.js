const { readJsonBody, sendJson } = require('../http-utils');
const { verifyToken } = require('../middleware/auth-middleware');
const crossMarketService = require('../cross-market-service');
const Exchange = require('../models/Exchange');
const {
    createTransferCatalogEntry,
    getTransferCatalogEntries,
    deleteTransferCatalogEntry,
    getTransferCatalogEntryById,
    createTransferHistoryEntry,
    getTransferHistory
} = require('../database');

function estimateTimeByNetwork(networkName) {
    const net = String(networkName || '').toUpperCase().trim();
    if (net.includes('TRC20') || net.includes('TRON') || net === 'TRX') return '~2-5 min';
    if (net.includes('BSC') || net.includes('BEP20') || net.includes('BINANCE SMART CHAIN')) return '~2-3 min';
    if (net.includes('ERC20') || net.includes('ETH') || net.includes('ETHEREUM')) return '~5-15 min';
    if (net.includes('SOL') || net.includes('SOLANA')) return '~1-2 min';
    if (net.includes('MATIC') || net.includes('POLYGON')) return '~2-5 min';
    if (net.includes('OPTIMISM') || net === 'OP') return '~2-5 min';
    if (net.includes('ARBITRUM') || net === 'ARB' || net === 'ARBITRUM ONE') return '~2-5 min';
    if (net.includes('AVAX') || net.includes('AVALANCHE') || net === 'AVAXC') return '~2-3 min';
    if (net.includes('HYPEEVM') || net === 'HYPEREVM') return '~1 min';
    if (net === 'HYPE') return '~2 min';
    if (net.includes('BASE')) return '~2-3 min';
    if (net.includes('SUI')) return '~1-2 min';
    if (net.includes('APT') || net.includes('APTOS')) return '~1-2 min';
    if (net.includes('TON')) return '~5-10 min';
    if (net === 'BTC' || net.includes('BITCOIN')) return '~10-60 min';
    if (net === 'XRP' || net.includes('RIPPLE')) return '~1-3 min';
    if (net === 'LTC' || net.includes('LITECOIN')) return '~10-20 min';
    return '';
}

async function lookupTransferInfo({ request, response }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
        const exchangeId = url.searchParams.get('exchangeId');
        const currency = url.searchParams.get('currency');

        if (!exchangeId || !currency) {
            return sendJson(response, 400, { error: 'exchangeId e currency são obrigatórios' });
        }

        const exchangeAcronym = exchangeId.toUpperCase();
        const coin = currency.toUpperCase();

        // Tentar buscar instância autenticada e pública
        let instance = await crossMarketService.getCcxtInstance(exchangeAcronym, true).catch(() => null);
        if (!instance) {
            instance = await crossMarketService.getCcxtInstance(exchangeAcronym, false).catch(() => null);
        }

        if (!instance) {
            return sendJson(response, 404, { error: `Exchange ${exchangeAcronym} não suportada ou não configurada.` });
        }

        // Carregar mercados e moedas (algumas exchanges precisam de fetchCurrencies para carregar redes e taxas)
        if (instance.has['fetchCurrencies']) {
            await instance.fetchCurrencies().catch(() => {});
        }
        await instance.loadMarkets().catch(() => {});

        let networksList = [];

        if (instance.currencies && instance.currencies[coin]) {
            const coinData = instance.currencies[coin];
            
            if (coinData.networks && typeof coinData.networks === 'object') {
                Object.entries(coinData.networks).forEach(([netKey, netData]) => {
                    const withdrawMin = (netData.withdraw && typeof netData.withdraw.min === 'number')
                        ? netData.withdraw.min
                        : (netData.limits?.withdraw?.min || coinData.limits?.withdraw?.min || 0);

                    // Tenta extrair o tempo estimado de saque/depósito
                    let transferTime = '';
                    if (netData.info && typeof netData.info === 'object') {
                        transferTime = netData.info.withdraw_delay || netData.info.delay || netData.info.withdraw_delay_time || '';
                    }
                    if (!transferTime && coinData.info && typeof coinData.info === 'object') {
                        transferTime = coinData.info.withdraw_delay || coinData.info.delay || '';
                    }
                    if (!transferTime) {
                        transferTime = estimateTimeByNetwork(netData.network || netKey);
                    }

                    networksList.push({
                        network: netData.network || netKey,
                        fee: typeof netData.fee === 'number' ? netData.fee : (coinData.fee || 0),
                        minAmount: withdrawMin,
                        transferTime: String(transferTime).trim(),
                        deposit: netData.deposit !== undefined ? netData.deposit : true,
                        withdraw: netData.withdraw !== undefined ? netData.withdraw : true
                    });
                });
            } else {
                let transferTime = '';
                if (coinData.info && typeof coinData.info === 'object') {
                    transferTime = coinData.info.withdraw_delay || coinData.info.delay || '';
                }
                if (!transferTime) {
                    transferTime = estimateTimeByNetwork(coin);
                }
                // Caso não tenha sub-redes separadas
                networksList.push({
                    network: 'Default/Mainnet',
                    fee: typeof coinData.fee === 'number' ? coinData.fee : 0,
                    minAmount: coinData.limits?.withdraw?.min || 0,
                    transferTime: String(transferTime).trim(),
                    deposit: coinData.deposit !== undefined ? coinData.deposit : true,
                    withdraw: coinData.withdraw !== undefined ? coinData.withdraw : true
                });
            }
        }

        // Fallback 1: Buscar taxas detalhadas por rede via fetchDepositWithdrawFees se a lista de redes estiver vazia ou com taxas zeradas
        if ((networksList.length === 0 || networksList.every(n => n.fee === 0)) && typeof instance.fetchDepositWithdrawFees === 'function') {
            try {
                const fees = await instance.fetchDepositWithdrawFees([coin]);
                if (fees && fees[coin]) {
                    const feeData = fees[coin];
                    const tempNetworks = [];
                    
                    if (feeData.networks && typeof feeData.networks === 'object') {
                        Object.entries(feeData.networks).forEach(([netKey, netVal]) => {
                            const withdrawFee = typeof netVal === 'number' ? netVal : (netVal.withdraw !== undefined ? netVal.withdraw : 0);
                            const depositFee = typeof netVal === 'number' ? 0 : (netVal.deposit !== undefined ? netVal.deposit : 0);
                            
                            let transferTime = '';
                            if (netVal && typeof netVal === 'object') {
                                if (netVal.info && typeof netVal.info === 'object') {
                                    transferTime = netVal.info.withdraw_delay || netVal.info.delay || '';
                                }
                            }
                            if (!transferTime) {
                                transferTime = estimateTimeByNetwork(netKey);
                            }

                            tempNetworks.push({
                                network: netKey,
                                fee: withdrawFee,
                                minAmount: typeof netVal.min === 'number' ? netVal.min : 0,
                                transferTime: String(transferTime).trim(),
                                deposit: depositFee !== false,
                                withdraw: withdrawFee !== false
                            });
                        });
                    } else if (feeData.withdraw !== undefined) {
                        tempNetworks.push({
                            network: 'Default/Mainnet',
                            fee: feeData.withdraw || 0,
                            minAmount: feeData.min || 0,
                            transferTime: estimateTimeByNetwork(coin),
                            deposit: true,
                            withdraw: true
                        });
                    }

                    if (tempNetworks.length > 0) {
                        networksList = tempNetworks;
                    }
                }
            } catch (e) {
                // ignore
            }
        }

        // Fallback 2: Se ainda não preencheu e suporta fetchFundingFees
        if (networksList.length === 0 && typeof instance.fetchFundingFees === 'function') {
            try {
                const fees = await instance.fetchFundingFees();
                if (fees && fees.withdraw && fees.withdraw[coin]) {
                    networksList.push({
                        network: 'Mainnet',
                        fee: fees.withdraw[coin],
                        minAmount: 0,
                        transferTime: estimateTimeByNetwork(coin),
                        deposit: true,
                        withdraw: true
                    });
                }
            } catch (err) {
                // ignore
            }
        }

        // Filtra para remover redes desativadas tanto para depósito quanto para saque
        networksList = networksList.filter(n => n.deposit || n.withdraw);

        sendJson(response, 200, {
            exchange: exchangeAcronym,
            currency: coin,
            networks: networksList
        });

    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function listCatalog({ request, response }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const catalog = await getTransferCatalogEntries(decoded.id);
        sendJson(response, 200, { catalog });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function addCatalogEntry({ request, response }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const body = await readJsonBody(request);
        if (!body.exchange || !body.currency || !body.network) {
            return sendJson(response, 400, { error: 'exchange, currency e network são obrigatórios' });
        }

        const entry = await createTransferCatalogEntry(decoded.id, {
            exchange: body.exchange,
            currency: body.currency,
            network: body.network,
            fee: parseFloat(body.fee) || 0,
            minAmount: parseFloat(body.minAmount) || 0,
            transferTime: body.transferTime || '',
            targetExchange: body.targetExchange || '',
            depositAddress: body.depositAddress || '',
            depositTag: body.depositTag || ''
        });

        sendJson(response, 200, { entry });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function removeCatalogEntry({ request, response, params }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const { id } = params;
        await deleteTransferCatalogEntry(id, decoded.id);
        sendJson(response, 200, { message: 'Item removido do catálogo com sucesso.' });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function getDepositAddress({ request, response }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
        const exchangeId = url.searchParams.get('exchangeId');
        const currency = url.searchParams.get('currency');
        const network = url.searchParams.get('network');

        if (!exchangeId || !currency || !network) {
            return sendJson(response, 400, { error: 'exchangeId, currency e network são obrigatórios' });
        }

        const exchangeAcronym = exchangeId.toUpperCase();
        const coin = currency.toUpperCase();

        const instance = await crossMarketService.getCcxtInstance(exchangeAcronym, true).catch(() => null);
        if (!instance) {
            return sendJson(response, 400, { error: `Exchange ${exchangeAcronym} não está configurada ou credenciais privadas estão ausentes.` });
        }

        await instance.loadMarkets().catch(() => {});

        if (typeof instance.fetchDepositAddress !== 'function') {
            return sendJson(response, 501, { error: `A exchange ${exchangeAcronym} não suporta consulta automática de endereços pelo CCXT.` });
        }

        let addressData;
        let targetNetwork = network;
        
        // Tenta buscar no dicionário de moedas local do CCXT se houver correspondente case-insensitive ou aproximado
        if (instance.currencies && instance.currencies[coin]) {
            const destCoinData = instance.currencies[coin];
            if (destCoinData.networks && typeof destCoinData.networks === 'object') {
                const destNetworks = Object.keys(destCoinData.networks);
                const exactMatch = destNetworks.find(n => n.toUpperCase() === network.toUpperCase());
                if (exactMatch) {
                    targetNetwork = exactMatch;
                } else {
                    const clean = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
                    const cleanTarget = clean(network);
                    const approxMatch = destNetworks.find(n => clean(n) === cleanTarget || clean(n).includes(cleanTarget) || cleanTarget.includes(clean(n)));
                    if (approxMatch) {
                        targetNetwork = approxMatch;
                    }
                }
            }
        }

        try {
            addressData = await instance.fetchDepositAddress(coin, { network: targetNetwork });
        } catch (fetchErr) {
            // Parser de erro auto-healing para extrair opções válidas sugeridas pelo CCXT
            const matchMsg = fetchErr.message.match(/use one of (.+)/i);
            if (matchMsg && matchMsg[1]) {
                const validNetworks = matchMsg[1].split(',').map(n => n.trim().replace(/['"\[\]]/g, ''));
                const clean = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
                const targetClean = clean(targetNetwork);
                
                let bestMatch = validNetworks.find(n => clean(n) === targetClean);
                if (!bestMatch) {
                    bestMatch = validNetworks.find(n => clean(n).includes(targetClean) || targetClean.includes(clean(n)));
                }
                if (!bestMatch) {
                    bestMatch = validNetworks.find(n => clean(n).substring(0, 4) === targetClean.substring(0, 4));
                }

                if (bestMatch) {
                    console.log(`[transfers] Auto-healing rede: corrigindo ${targetNetwork} para ${bestMatch}`);
                    try {
                        addressData = await instance.fetchDepositAddress(coin, { network: bestMatch });
                    } catch (retryErr) {
                        throw new Error(`Falha ao obter endereço na corretora (após auto-correção para ${bestMatch}): ${retryErr.message}`);
                    }
                } else {
                    throw new Error(`Falha ao obter endereço na corretora: ${fetchErr.message}`);
                }
            } else {
                // Tenta fallback sem passar rede específica
                try {
                    addressData = await instance.fetchDepositAddress(coin);
                } catch (fallbackErr) {
                    throw new Error(`Falha ao obter endereço na corretora: ${fetchErr.message}`);
                }
            }
        }

        if (!addressData || !addressData.address) {
            throw new Error('Endereço não retornado pela corretora.');
        }

        sendJson(response, 200, {
            exchange: exchangeAcronym,
            currency: coin,
            network: network,
            address: addressData.address,
            tag: addressData.tag || ''
        });

    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function executeTransfer({ request, response }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const body = await readJsonBody(request);
        const { catalogId, amount } = body;

        if (!catalogId || !amount || parseFloat(amount) <= 0) {
            return sendJson(response, 400, { error: 'catalogId e um valor (amount) válido são obrigatórios.' });
        }

        const route = await getTransferCatalogEntryById(catalogId, decoded.id);
        if (!route) {
            return sendJson(response, 404, { error: 'Rota catalogada não encontrada.' });
        }

        if (parseFloat(amount) < route.minAmount) {
            return sendJson(response, 400, { error: `Quantidade menor que o valor mínimo exigido de ${route.minAmount} ${route.currency}` });
        }

        if (!route.depositAddress) {
            return sendJson(response, 400, { error: 'Esta rota não possui endereço de depósito destino cadastrado.' });
        }

        const exchangeConfig = await Exchange.findOne({ userId: decoded.id, acronym: route.exchange.toUpperCase() }).lean();
        const isLiveMode = exchangeConfig ? exchangeConfig.enableLiveTrading === true : false;

        if (!isLiveMode) {
            // Modo simulação
            console.log(`[transfers] [SIMULAÇÃO] Executando saque simulado de ${amount} ${route.currency} de ${route.exchange} para o endereço ${route.depositAddress} via rede ${route.network}`);
            const transactionId = `sim-${Math.random().toString(36).substr(2, 9)}`;

            await createTransferHistoryEntry({
                userId: decoded.id,
                catalogId: route._id,
                exchange: route.exchange,
                targetExchange: route.targetExchange,
                currency: route.currency,
                network: route.network,
                amount: parseFloat(amount),
                fee: route.fee,
                depositAddress: route.depositAddress,
                depositTag: route.depositTag || '',
                status: 'completed',
                transactionId,
                simulated: true
            }).catch(err => console.error('[transfers] erro ao salvar historico simulado:', err.message));

            return sendJson(response, 200, {
                success: true,
                message: `[Simulado] Transferência de ${amount} ${route.currency} de ${route.exchange} para ${route.targetExchange || 'Destino'} via rede ${route.network} iniciada com sucesso.`,
                transactionId,
                simulated: true
            });
        }

        // Modo Live (Real)
        console.log(`[transfers] [LIVE] Iniciando saque real de ${amount} ${route.currency} de ${route.exchange} para o endereço ${route.depositAddress} na rede ${route.network}`);
        
        let instance;
        try {
            instance = await crossMarketService.getCcxtInstance(route.exchange, true);
        } catch (err) {
            await createTransferHistoryEntry({
                userId: decoded.id,
                catalogId: route._id,
                exchange: route.exchange,
                targetExchange: route.targetExchange,
                currency: route.currency,
                network: route.network,
                amount: parseFloat(amount),
                fee: route.fee,
                depositAddress: route.depositAddress,
                depositTag: route.depositTag || '',
                status: 'failed',
                simulated: false,
                errorMessage: `Setup CCXT: ${err.message}`
            }).catch(e => console.error('[transfers] erro ao salvar historico:', e.message));

            return sendJson(response, 400, { error: `Exchange origem ${route.exchange} não configurada ou credenciais privadas ausentes.` });
        }

        if (!instance) {
            return sendJson(response, 400, { error: `Exchange origem ${route.exchange} não configurada ou credenciais privadas ausentes.` });
        }

        try {
            await instance.loadMarkets().catch(() => {});

            if (typeof instance.withdraw !== 'function') {
                throw new Error(`A exchange ${route.exchange} não suporta retiradas via CCXT.`);
            }

            // Executar retirada no CCXT
            const withdrawParams = {};
            if (route.network) {
                withdrawParams.network = route.network;
            }

            const result = await instance.withdraw(
                route.currency,
                parseFloat(amount),
                route.depositAddress,
                route.depositTag || undefined,
                withdrawParams
            );

            console.log(`[transfers] [LIVE] Saque efetuado com sucesso! ID de transação: ${result.id}`);

            await createTransferHistoryEntry({
                userId: decoded.id,
                catalogId: route._id,
                exchange: route.exchange,
                targetExchange: route.targetExchange,
                currency: route.currency,
                network: route.network,
                amount: parseFloat(amount),
                fee: result.fee || route.fee,
                depositAddress: route.depositAddress,
                depositTag: route.depositTag || '',
                status: 'completed',
                transactionId: result.id,
                simulated: false
            }).catch(e => console.error('[transfers] erro ao salvar historico:', e.message));

            sendJson(response, 200, {
                success: true,
                message: `Transferência de ${amount} ${route.currency} efetuada com sucesso!`,
                transactionId: result.id,
                fee: result.fee || null,
                simulated: false
            });

        } catch (withdrawErr) {
            await createTransferHistoryEntry({
                userId: decoded.id,
                catalogId: route._id,
                exchange: route.exchange,
                targetExchange: route.targetExchange,
                currency: route.currency,
                network: route.network,
                amount: parseFloat(amount),
                fee: route.fee,
                depositAddress: route.depositAddress,
                depositTag: route.depositTag || '',
                status: 'failed',
                simulated: false,
                errorMessage: withdrawErr.message
            }).catch(e => console.error('[transfers] erro ao salvar historico:', e.message));

            throw withdrawErr;
        }

    } catch (error) {
        console.error('[transfers] Erro na execução da transferência:', error.message);
        sendJson(response, 500, { error: error.message });
    }
}

async function listHistory({ request, response }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const history = await getTransferHistory(decoded.id);
        sendJson(response, 200, { history });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

function registerTransferRoutes(router) {
    router.register('GET', '/api/transfers/lookup', lookupTransferInfo);
    router.register('GET', '/api/transfers/catalog', listCatalog);
    router.register('GET', '/api/transfers/history', listHistory);
    router.register('GET', '/api/transfers/deposit-address', getDepositAddress);
    router.register('POST', '/api/transfers/catalog', addCatalogEntry);
    router.register('POST', '/api/transfers/execute', executeTransfer);
    router.register('DELETE', '/api/transfers/catalog/:id', removeCatalogEntry);
}

module.exports = { registerTransferRoutes };
