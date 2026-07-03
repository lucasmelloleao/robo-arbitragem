const mongoose = require('mongoose');

const exchangeSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Nome da corretora é obrigatório'],
        trim: true
    },
    acronym: {
        type: String,
        required: [true, 'Sigla da corretora é obrigatória'],
        unique: true,
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
    notes: {
        type: String,
        trim: true
    },
    envInfo: {
        type: String,
        trim: true
    }
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: true
    }
});

module.exports = mongoose.model('Exchange', exchangeSchema);
