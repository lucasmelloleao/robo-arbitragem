const mongoose = require('mongoose');

const exchangeSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Usuário é obrigatório'],
        index: true
    },
    name: {
        type: String,
        required: [true, 'Nome da corretora é obrigatório'],
        trim: true
    },
    acronym: {
        type: String,
        required: [true, 'Sigla da corretora é obrigatória'],
        trim: true,
        uppercase: true
    },
    apiKey: {
        type: String,
        trim: true
    },
    secretKey: {
        type: String,
        trim: true,
        select: false
    },
    password: {
        type: String,
        trim: true,
        select: false
    },
    active: {
        type: Boolean,
        default: true
    },
    assetsMode: {
        type: String,
        enum: ['list', 'all'],
        default: 'list'
    },
    notes: {
        type: String,
        trim: true
    },
    envInfo: {
        type: String,
        trim: true
    },
    arbitrageConfig: {
        startAssets: { type: String, trim: true },
        bridgeAssets: { type: String, trim: true },
        targetAssets: { type: String, trim: true },
        investmentAmount: { type: Number },
        tradingFee: { type: Number },
        scanIntervalMs: { type: Number },
        maxTrianglesPerCycle: { type: Number },
        orderBookDepth: { type: Number },
        maxSpreadPercent: { type: Number },
        minVolumeBuffer: { type: Number },
        minProfitPercent: { type: Number },
        maxSlippagePercent: { type: Number },
        enableLiveTrading: { type: Boolean, default: false },
        opportunityLogFile: { type: String, trim: true },
        chunkSize: { type: Number }
    },
    marketMakingConfig: {
        mode: { type: String, trim: true },
        keepListening: { type: Boolean, default: true },
        symbol: { type: String, trim: true },
        maxSymbolAttempts: { type: Number },
        orderBookDepth: { type: Number },
        quoteOffsetPercent: { type: Number },
        minSpreadPercent: { type: Number },
        quoteBudget: { type: Number },
        updateIntervalMs: { type: Number },
        opportunityLogFile: { type: String, trim: true }
    }
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: true
    }
});

// Índice composto: um usuário não pode ter duas exchanges com a mesma sigla
exchangeSchema.index({ userId: 1, acronym: 1 }, { unique: true });

module.exports = mongoose.model('Exchange', exchangeSchema);