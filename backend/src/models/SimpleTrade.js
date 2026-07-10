const mongoose = require('mongoose');

const simpleTradeSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    exchange: {
        type: String,
        required: true,
        uppercase: true,
        index: true
    },
    symbol: {
        type: String,
        required: true,
        uppercase: true
    },
    side: {
        type: String,
        required: true,
        uppercase: true
    },
    amount: {
        type: Number,
        required: true
    },
    price: {
        type: Number,
        default: 0
    },
    orderId: String,
    fee: {
        cost: Number,
        currency: String
    },
    status: {
        type: String,
        enum: ['SUCCESS', 'FAILED'],
        default: 'SUCCESS',
        index: true
    },
    errorMessage: String,
    rawOrder: mongoose.Schema.Types.Mixed
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    }
});

module.exports = mongoose.model('SimpleTrade', simpleTradeSchema);
