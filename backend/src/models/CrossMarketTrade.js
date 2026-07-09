const mongoose = require('mongoose');

const crossMarketTradeSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    strategyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CrossMarket',
        required: true,
        index: true
    },
    strategyName: {
        type: String,
        required: true
    },
    buyExchange: {
        type: String,
        required: true,
        uppercase: true
    },
    sellExchange: {
        type: String,
        required: true,
        uppercase: true
    },
    quoteAsset: { // e.g. USDT
        type: String,
        required: true,
        uppercase: true
    },
    baseAsset: { // e.g. HYPE
        type: String,
        required: true,
        uppercase: true
    },
    buyPrice: {
        type: Number,
        required: true
    },
    sellPrice: {
        type: Number,
        required: true
    },
    buyAmount: {
        type: Number,
        required: true
    },
    sellAmount: {
        type: Number,
        required: true
    },
    quoteAmount: {
        type: Number,
        required: true
    },
    spreadPercent: {
        type: Number,
        required: true
    },
    estimatedProfit: {
        type: Number,
        required: true
    },
    estimatedProfitPercent: {
        type: Number,
        required: true
    },
    buyOrderId: String,
    sellOrderId: String,
    buyOrderFee: {
        cost: Number,
        currency: String
    },
    sellOrderFee: {
        cost: Number,
        currency: String
    },
    status: {
        type: String,
        enum: ['SUCCESS', 'PARTIAL_FAILURE', 'FAILED'],
        default: 'SUCCESS'
    },
    errorMessage: String,
    rawBuyOrder: mongoose.Schema.Types.Mixed,
    rawSellOrder: mongoose.Schema.Types.Mixed
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    }
});

module.exports = mongoose.model('CrossMarketTrade', crossMarketTradeSchema);
