const mongoose = require('mongoose');

const crossMarketSchema = new mongoose.Schema({
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
    active: {
        type: Boolean,
        default: true
    },
    exchange1: {
        type: String,
        required: [true, 'Corretora 1 é obrigatória'],
        trim: true,
        uppercase: true
    },
    exchange2: {
        type: String,
        required: [true, 'Corretora 2 é obrigatória'],
        trim: true,
        uppercase: true
    },
    asset1: {
        type: String,
        required: [true, 'Moeda 1 é obrigatória'],
        trim: true,
        uppercase: true
    },
    asset2: {
        type: String,
        required: [true, 'Moeda 2 é obrigatória'],
        trim: true,
        uppercase: true
    },
    operationAmount: {
        type: Number,
        required: [true, 'Valor de operação é obrigatório'],
        min: [0.0001, 'Valor mínimo de operação é 0.0001']
    },
    minSpreadPercent: {
        type: Number,
        default: 0.1,
        min: 0
    },
    maxSlippagePercent: {
        type: Number,
        default: 0.15,
        min: 0
    },
    tradingFeePercent: {
        type: Number,
        default: 0.1,
        min: 0
    },
    scanIntervalMs: {
        type: Number,
        default: 5000,
        min: 1000
    },
    enableLiveTrading: {
        type: Boolean,
        default: false
    },
    notes: {
        type: String,
        trim: true
    }
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    }
});

// Índice composto por usuário: evita duplicata da mesma dupla de corretoras+moedas para o mesmo usuário
crossMarketSchema.index(
    { userId: 1, exchange1: 1, exchange2: 1, asset1: 1, asset2: 1 },
    { unique: true }
);

module.exports = mongoose.model('CrossMarket', crossMarketSchema);