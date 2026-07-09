const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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
        required: [true, 'Senha é obrigatória']
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

// Middleware para "hashear" a senha antes de salvar (Mongoose 9: hooks retornam promises)
userSchema.pre('save', async function () {
    if (!this.isModified('password')) {
        return;
    }

    const candidate = this.password || '';

    // Evita rehashear uma senha que já está hasheada (ex.: migração de senha legada)
    if (candidate.startsWith('$2')) {
        return;
    }

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(candidate, salt);
});

// Método para comparar senhas (com migração de senhas legadas em texto puro)
userSchema.methods.comparePassword = async function (candidatePassword) {
    const stored = this.password || '';
    const looksHashed = stored.startsWith('$2');

    if (looksHashed) {
        return bcrypt.compare(candidatePassword, stored);
    }

    // Migração: senhas antigas salvas em texto puro são hasheadas no primeiro login
    if (stored === candidatePassword) {
        this.password = await bcrypt.hash(candidatePassword, await bcrypt.genSalt(10));
        await this.save();
        return true;
    }

    return false;
};

module.exports = mongoose.model('User', userSchema);