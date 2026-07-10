const { readJsonBody, sendJson } = require('../http-utils');
const {
    getAllArbitrageStrategies,
    getArbitrageStrategyById,
    createArbitrageStrategy,
    updateArbitrageStrategy,
    deleteArbitrageStrategy,
    toggleArbitrageStrategy
} = require('../database');
const { verifyToken } = require('../middleware/auth-middleware');

async function listStrategies({ request, response }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const strategies = await getAllArbitrageStrategies(decoded.id);
        const systemExecutionService = require('../system-execution-service');
        const server = systemExecutionService.getArbitrageInstance();
        
        const mappedStrategies = (strategies || []).map(s => {
            const plain = s.toObject ? s.toObject() : s;
            const isRunning = server ? server.isArbitrageLoopRunning(plain._id) : false;
            return { ...plain, isRunning };
        });

        sendJson(response, 200, { strategies: mappedStrategies });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function getStrategyById({ request, response, params }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const { id } = params;
        const strategy = await getArbitrageStrategyById(id, decoded.id);
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
        const { name, exchange, startAssets, bridgeAssets, targetAssets } = body;

        if (!name || !exchange) {
            sendJson(response, 400, { error: 'Campos obrigatórios: name, exchange' });
            return;
        }

        const strategyData = {
            name: name.trim(),
            exchange: exchange.trim().toUpperCase(),
            active: body.active !== undefined ? Boolean(body.active) : true,
            startAssets: startAssets || 'USDC',
            bridgeAssets: bridgeAssets || 'BTC,ETH,SOL',
            targetAssets: targetAssets || 'ETH,SOL,XRP',
            investmentAmount: body.investmentAmount !== undefined ? Number(body.investmentAmount) : 100,
            tradingFee: body.tradingFee !== undefined ? Number(body.tradingFee) : 0.001,
            scanIntervalMs: body.scanIntervalMs !== undefined ? Number(body.scanIntervalMs) : 3000,
            maxTrianglesPerCycle: body.maxTrianglesPerCycle !== undefined ? Number(body.maxTrianglesPerCycle) : 8,
            orderBookDepth: body.orderBookDepth !== undefined ? Number(body.orderBookDepth) : 10,
            maxSpreadPercent: body.maxSpreadPercent !== undefined ? Number(body.maxSpreadPercent) : 0.2,
            minVolumeBuffer: body.minVolumeBuffer !== undefined ? Number(body.minVolumeBuffer) : 1.05,
            minProfitPercent: body.minProfitPercent !== undefined ? Number(body.minProfitPercent) : 0.1,
            maxSlippagePercent: body.maxSlippagePercent !== undefined ? Number(body.maxSlippagePercent) : 0.15,
            enableLiveTrading: Boolean(body.enableLiveTrading),
            assetsMode: body.assetsMode || 'list',
            chunkSize: body.chunkSize !== undefined ? Number(body.chunkSize) : 15,
            notes: body.notes || ''
        };

        const strategy = await createArbitrageStrategy(decoded.id, strategyData);

        // O reload/restart do service será acionado pelo index/system-execution-service
        const systemExecutionService = require('../system-execution-service');
        if (systemExecutionService && systemExecutionService.isActive()) {
            await systemExecutionService.startAll().catch(() => {});
        }

        sendJson(response, 201, { strategy });
    } catch (error) {
        if (error.code === 11000) {
            sendJson(response, 409, { error: 'Já existe uma estratégia de arbitragem com este nome' });
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

        const updates = {};
        const allowedFields = [
            'name', 'exchange', 'active', 'startAssets', 'bridgeAssets', 'targetAssets',
            'investmentAmount', 'tradingFee', 'scanIntervalMs', 'maxTrianglesPerCycle',
            'orderBookDepth', 'maxSpreadPercent', 'minVolumeBuffer', 'minProfitPercent',
            'maxSlippagePercent', 'enableLiveTrading', 'assetsMode', 'chunkSize', 'notes'
        ];

        allowedFields.forEach((field) => {
            if (body[field] !== undefined) {
                if (['investmentAmount', 'tradingFee', 'scanIntervalMs', 'maxTrianglesPerCycle', 'orderBookDepth', 'maxSpreadPercent', 'minVolumeBuffer', 'minProfitPercent', 'maxSlippagePercent', 'chunkSize'].includes(field)) {
                    updates[field] = Number(body[field]);
                } else if (['active', 'enableLiveTrading'].includes(field)) {
                    updates[field] = Boolean(body[field]);
                } else {
                    updates[field] = body[field];
                }
            }
        });

        const strategy = await updateArbitrageStrategy(id, decoded.id, updates);
        if (!strategy) {
            sendJson(response, 404, { error: 'Estratégia não encontrada' });
            return;
        }

        const systemExecutionService = require('../system-execution-service');
        if (systemExecutionService && systemExecutionService.isActive()) {
            await systemExecutionService.startAll().catch(() => {});
        }

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
        const strategy = await deleteArbitrageStrategy(id, decoded.id);
        if (!strategy) {
            sendJson(response, 404, { error: 'Estratégia não encontrada' });
            return;
        }

        const systemExecutionService = require('../system-execution-service');
        if (systemExecutionService && systemExecutionService.isActive()) {
            await systemExecutionService.startAll().catch(() => {});
        }

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
        const strategy = await toggleArbitrageStrategy(id, decoded.id);
        if (!strategy) {
            sendJson(response, 404, { error: 'Estratégia não encontrada' });
            return;
        }

        const systemExecutionService = require('../system-execution-service');
        if (systemExecutionService && systemExecutionService.isActive()) {
            await systemExecutionService.startAll().catch(() => {});
        }

        sendJson(response, 200, { strategy });
    } catch (error) {
        sendJson(response, 400, { error: error.message });
    }
}

async function startLoopHandler({ request, response, params }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const { id } = params;
        const systemExecutionService = require('../system-execution-service');
        const server = systemExecutionService.getArbitrageInstance();
        if (!server) {
            sendJson(response, 500, { error: 'Servidor de arbitragem não inicializado.' });
            return;
        }
        const result = await server.startBackgroundArbitrage(id);
        sendJson(response, 200, { message: 'Loop de arbitragem iniciado com sucesso', status: result });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

async function stopLoopHandler({ request, response, params }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;
    try {
        const { id } = params;
        const systemExecutionService = require('../system-execution-service');
        const server = systemExecutionService.getArbitrageInstance();
        if (!server) {
            sendJson(response, 500, { error: 'Servidor de arbitragem não inicializado.' });
            return;
        }
        const stopped = server.stopBackgroundArbitrage(id);
        sendJson(response, 200, { message: stopped ? 'Loop parado com sucesso' : 'Loop já estava inativo', stopped });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

function registerArbitrageStrategyRoutes(router) {
    router.register('GET', '/api/arbitrage/strategies', listStrategies);
    router.register('GET', '/api/arbitrage/strategies/:id', getStrategyById);
    router.register('POST', '/api/arbitrage/strategies', createStrategy);
    router.register('PUT', '/api/arbitrage/strategies/:id', updateStrategy);
    router.register('DELETE', '/api/arbitrage/strategies/:id', deleteStrategy);
    router.register('PATCH', '/api/arbitrage/strategies/:id/toggle', toggleStrategy);
    router.register('POST', '/api/arbitrage/strategies/:id/start', startLoopHandler);
    router.register('POST', '/api/arbitrage/strategies/:id/stop', stopLoopHandler);
}

module.exports = { registerArbitrageStrategyRoutes };
