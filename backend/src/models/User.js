const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: [true, 'Username é obrigatório'],
        unique: true,
        trim: true
    },
    name: {
        type: String,
        required: [true, 'Nome é obrigatório'],
        trim: true
    },
    mail: {
        type: String,
        required: [true, 'Email é obrigatório'],
        trim: true,
        lowercase: true
    },
    password: {
        type: String,
        required: [true, 'Senha é obrigatória'],
        select: false
    },
    stopTrader: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: false
    }
});


module.exports = mongoose.model('User', userSchema);