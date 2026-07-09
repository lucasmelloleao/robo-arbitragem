const mongoose = require('mongoose');

const transferCatalogSchema = new mongoose.Schema({
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
        trim: true
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
    fee: {
        type: Number,
        default: 0
    },
    minAmount: {
        type: Number,
        default: 0
    },
    transferTime: {
        type: String,
        default: ''
    },
    targetExchange: {
        type: String,
        uppercase: true,
        trim: true,
        default: ''
    },
    depositAddress: {
        type: String,
        trim: true,
        default: ''
    },
    depositTag: {
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

// Índice composto único por usuário, exchange, moeda e rede
transferCatalogSchema.index(
    { userId: 1, exchange: 1, currency: 1, network: 1 },
    { unique: true }
);

module.exports = mongoose.model('TransferCatalog', transferCatalogSchema);
