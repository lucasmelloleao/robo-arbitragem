const mongoose = require('mongoose');

const arbitrageStrategySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Usuário é obrigatório'],
        index: true
    },
    name: {
        type: String,
        required: [true, 'Nome da estratégia é obrigatório'],
        trim: true
    },
    exchange: {
        type: String,
        required: [true, 'Corretora é obrigatória'],
        trim: true,
        uppercase: true
    },
    active: {
        type: Boolean,
        default: true
    },
    startAssets: { type: String, trim: true, default: 'USDC' },
    bridgeAssets: { type: String, trim: true, default: 'BTC,ETH,SOL' },
    targetAssets: { type: String, trim: true, default: 'ETH,SOL,XRP' },
    investmentAmount: { type: Number, default: 100 },
    tradingFee: { type: Number, default: 0.001 },
    scanIntervalMs: { type: Number, default: 3000 },
    maxTrianglesPerCycle: { type: Number, default: 8 },
    orderBookDepth: { type: Number, default: 10 },
    maxSpreadPercent: { type: Number, default: 0.2 },
    minVolumeBuffer: { type: Number, default: 1.05 },
    minProfitPercent: { type: Number, default: 0.1 },
    maxSlippagePercent: { type: Number, default: 0.15 },
    enableLiveTrading: { type: Boolean, default: false },
    assetsMode: { type: String, enum: ['list', 'all'], default: 'list' },
    chunkSize: { type: Number, default: 15 },
    notes: { type: String, trim: true }
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    }
});

// Índice único por usuário para evitar nomes de estratégias repetidos
arbitrageStrategySchema.index({ userId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('ArbitrageStrategy', arbitrageStrategySchema);
