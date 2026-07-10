const mongoose = require('mongoose');

const arbitrageTradeSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    exchange: { type: String, required: true, uppercase: true, trim: true },
    route: { type: String, required: true }, // e.g. "USDC -> HYPE -> USDT -> USDC"
    investmentAmount: { type: Number, required: true },
    profitPercent: { type: Number, required: true },
    profitLoss: { type: Number, required: true },
    finalAmount: { type: Number, required: true },
    status: { type: String, required: true, enum: ['SUCCESS', 'FAILED', 'PARTIAL_FAILURE'] },
    errorMessage: { type: String, default: null },
    pairs: [{ type: String }], // e.g. ["HYPE/USDC", "HYPE/USDT", "USDT/USDC"]
    orders: {
        order1: { type: mongoose.Schema.Types.Mixed },
        order2: { type: mongoose.Schema.Types.Mixed },
        order3: { type: mongoose.Schema.Types.Mixed }
    },
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ArbitrageTrade', arbitrageTradeSchema);
