const mongoose = require('mongoose');

const transferHistorySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    catalogId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TransferCatalog',
        required: true,
        index: true
    },
    exchange: {
        type: String,
        required: true,
        uppercase: true,
        trim: true
    },
    targetExchange: {
        type: String,
        uppercase: true,
        trim: true,
        default: ''
    },
    currency: {
        type: String,
        required: true,
        uppercase: true,
        trim: true
    },
    network: {
        type: String,
        required: true,
        trim: true
    },
    amount: {
        type: Number,
        required: true
    },
    fee: {
        type: Number,
        default: 0
    },
    depositAddress: {
        type: String,
        required: true,
        trim: true
    },
    depositTag: {
        type: String,
        trim: true,
        default: ''
    },
    status: {
        type: String,
        enum: ['completed', 'failed', 'pending'],
        default: 'pending'
    },
    transactionId: {
        type: String,
        trim: true,
        default: ''
    },
    simulated: {
        type: Boolean,
        default: false
    },
    errorMessage: {
        type: String,
        trim: true,
        default: ''
    }
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    }
});

module.exports = mongoose.model('TransferHistory', transferHistorySchema);
