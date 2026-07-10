const Exchange = require('../models/Exchange');
const ArbitrageStrategy = require('../models/ArbitrageStrategy');

async function runMigration() {
    try {
        console.log('[Migration] Iniciando migração de configurações de arbitragem...');
        
        const exchanges = await Exchange.find({}).lean();
        let migratedCount = 0;

        for (const ex of exchanges) {
            // Se a exchange tiver arbitrageConfig definido
            if (ex.arbitrageConfig && Object.keys(ex.arbitrageConfig).length > 0) {
                const config = ex.arbitrageConfig;
                
                // Verificar se já existe uma estratégia de arbitragem com este nome para este usuário
                const strategyName = `Estratégia Arbitragem - ${ex.acronym}`;
                const exists = await ArbitrageStrategy.findOne({ userId: ex.userId, name: strategyName });
                
                if (!exists) {
                    await ArbitrageStrategy.create({
                        userId: ex.userId,
                        name: strategyName,
                        exchange: ex.acronym,
                        active: ex.active,
                        startAssets: config.startAssets || 'USDC',
                        bridgeAssets: config.bridgeAssets || 'BTC,ETH,SOL',
                        targetAssets: config.targetAssets || 'ETH,SOL,XRP',
                        investmentAmount: config.investmentAmount ?? 100,
                        tradingFee: config.tradingFee ?? 0.001,
                        scanIntervalMs: config.scanIntervalMs ?? 3000,
                        maxTrianglesPerCycle: config.maxTrianglesPerCycle ?? 8,
                        orderBookDepth: config.orderBookDepth ?? 10,
                        maxSpreadPercent: config.maxSpreadPercent ?? 0.2,
                        minVolumeBuffer: config.minVolumeBuffer ?? 1.05,
                        minProfitPercent: config.minProfitPercent ?? 0.1,
                        maxSlippagePercent: config.maxSlippagePercent ?? 0.15,
                        enableLiveTrading: config.enableLiveTrading ?? ex.enableLiveTrading ?? false,
                        assetsMode: ex.assetsMode || 'list',
                        chunkSize: config.chunkSize ?? 15,
                        notes: `Migrado automaticamente a partir do cadastro da corretora ${ex.name}.`
                    });
                    migratedCount++;
                }
            }
        }

        console.log(`[Migration] Migração concluída com sucesso! ${migratedCount} nova(s) estratégia(s) criada(s).`);
    } catch (err) {
        console.error('[Migration] Falha durante a migração de arbitragem:', err.message);
    }
}

module.exports = { runMigration };
