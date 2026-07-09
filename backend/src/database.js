const mongoose = require('mongoose');
const User = require('./models/User');
const Exchange = require('./models/Exchange');
const CrossMarket = require('./models/CrossMarket');

const databaseUri = process.env.MONGODB_URI;
let isConnected = false;
let connectionPromise = null;
let retryTimeout = null;
let retryCount = 0;
const MAX_RETRIES = 10;
const INITIAL_RETRY_DELAY = 5000;

function maskCredential(value) {
    if (!value || typeof value !== 'string') {
        return '';
    }

    if (value.length <= 8) {
        return `${value.slice(0, 2)}***${value.slice(-2)}`;
    }

    return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function parseEnvInfoSections(envInfo) {
    if (!envInfo || typeof envInfo !== 'string') {
        return [];
    }

    return envInfo
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const [sectionTitle, rawContent] = line.includes('|')
                ? line.split('|', 2).map((part) => part.trim())
                : ['Geral', line];

            const items = rawContent
                .split('|')
                .map((item) => item.trim())
                .filter(Boolean);

            return {
                title: sectionTitle,
                items
            };
        });
}

function sanitizeExchange(exchange) {
    if (!exchange) {
        return null;
    }

    const source = typeof exchange.toObject === 'function' ? exchange.toObject() : exchange;
    const { secretKey, apiKey, password, ...rest } = source;

    return {
        ...rest,
        envInfoSections: parseEnvInfoSections(rest.envInfo),
        apiKeyMasked: maskCredential(apiKey),
        hasApiKey: Boolean(apiKey),
        hasSecretKey: Boolean(secretKey),
        hasPassword: Boolean(password)
    };
}

function assertDatabaseAvailable() {
    if (!databaseUri) {
        throw new Error('Banco de dados não configurado. Defina MONGODB_URI para habilitar recursos dependentes do MongoDB.');
    }
}

async function connect() {
    if (isConnected) {
        return;
    }

    if (!databaseUri) {
        console.warn('[database] MONGODB_URI não definida. Backend iniciado sem conexão com MongoDB.');
        return;
    }

    if (connectionPromise) {
        return connectionPromise;
    }

    if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
    }

    connectionPromise = mongoose.connect(databaseUri, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        retryReads: true,
        retryWrites: true,
        maxPoolSize: 10,
        minPoolSize: 5,
        maxIdleTimeMS: 30000
    });

    try {
        await connectionPromise;
        isConnected = true;
        retryCount = 0;
        console.log('[database] Conectado ao MongoDB');
    } catch (error) {
        connectionPromise = null;
        
        if (retryCount < MAX_RETRIES) {
            const delay = INITIAL_RETRY_DELAY * Math.pow(1.5, retryCount);
            retryCount++;
            console.error(`[database] Falha ao conectar (tentativa ${retryCount}/${MAX_RETRIES}). Nova tentativa em ${delay/1000}s...`);
            retryTimeout = setTimeout(() => connect(), delay);
        } else {
            console.error('[database] Falha ao conectar ao MongoDB após várias tentativas:', error.message);
            console.error('[database] Verifique se a URI está correta e se o cluster está acessível.');
        }
        
        throw error;
    }
}

async function disconnect() {
    if (!isConnected) {
        return;
    }

    if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
    }

    await mongoose.disconnect();
    isConnected = false;
    connectionPromise = null;
    retryCount = 0;
    console.log('[database] Desconectado do MongoDB');
}

async function getUserByUsername(username) {
    assertDatabaseAvailable();
    return User.findOne({ username }).lean();
}

async function getUserByEmail(mail) {
    assertDatabaseAvailable();
    return User.findOne({ mail }).lean();
}

async function createUser(userData) {
    assertDatabaseAvailable();
    const user = new User(userData);
    await user.save();
    return user.toObject();
}

async function updateUserStopTrader(username, stopTrader) {
    assertDatabaseAvailable();
    const result = await User.findOneAndUpdate(
        { username },
        { stopTrader },
        { returnDocument: 'after' }
    ).lean();

    return result;
}

async function getAllUsers() {
    assertDatabaseAvailable();
    return User.find({}, { password: 0 }).lean();
}

async function deleteUser(username) {
    assertDatabaseAvailable();
    return User.findOneAndDelete({ username }).lean();
}

async function getAllExchanges() {
    assertDatabaseAvailable();
    const exchanges = await Exchange.find({}).select('+secretKey +password').sort({ acronym: 1 }).lean();
    const sanitized = exchanges.map(sanitizeExchange);
    // Garante que a MEXC apareça primeiro na lista
    sanitized.sort((a, b) => {
        const aIsMexc = a.acronym === 'MEXC' ? 0 : 1;
        const bIsMexc = b.acronym === 'MEXC' ? 0 : 1;
        if (aIsMexc !== bIsMexc) return aIsMexc - bIsMexc;
        return a.acronym.localeCompare(b.acronym);
    });
    return sanitized;
}

async function getExchangeByAcronym(acronym) {
    assertDatabaseAvailable();
    return Exchange.findOne({ acronym: String(acronym || '').trim().toUpperCase() })
        .select('+secretKey +password +arbitrageConfig +marketMakingConfig')
        .lean();
}

async function getActiveExchangeStatuses() {
    assertDatabaseAvailable();
    const exchanges = await Exchange.find({}).select('acronym active').lean();
    const statusMap = {};
    for (const ex of exchanges) {
        statusMap[ex.acronym] = ex.active;
    }
    return statusMap;
}

async function getExchangeStatusByAcronym(acronym) {
    assertDatabaseAvailable();
    const exchange = await Exchange.findOne({ acronym: String(acronym || '').trim().toUpperCase() })
        .select('acronym active')
        .lean();
    return exchange ? exchange.active : null;
}

async function getExchangeCredentialsByAcronym(acronym) {
    assertDatabaseAvailable();
    return Exchange.findOne({ acronym: String(acronym || '').trim().toUpperCase() })
        .select('+secretKey +password apiKey acronym active')
        .lean();
}

async function createExchange(exchangeData) {
    assertDatabaseAvailable();
    const exchange = new Exchange(exchangeData);
    await exchange.save();
    return sanitizeExchange(exchange);
}

async function updateExchange(id, updates) {
    assertDatabaseAvailable();
    const exchange = await Exchange.findByIdAndUpdate(
        id,
        updates,
        { returnDocument: 'after' }
    ).select('+secretKey +password').lean();
    return sanitizeExchange(exchange);
}

async function deleteExchange(id) {
    assertDatabaseAvailable();
    const exchange = await Exchange.findByIdAndDelete(id);
    return exchange;
}

async function toggleExchangeStatus(id) {
    assertDatabaseAvailable();
    const exchange = await Exchange.findById(id).select('+secretKey +password');
    if (!exchange) return null;
    
    exchange.active = !exchange.active;
    await exchange.save();

    return sanitizeExchange(exchange);
}

// ===== Cross-Market Strategy =====

async function getAllCrossMarketStrategies() {
    assertDatabaseAvailable();
    return CrossMarket.find({}).sort({ created_at: -1 }).lean();
}

async function getCrossMarketStrategyById(id) {
    assertDatabaseAvailable();
    return CrossMarket.findById(id).lean();
}

async function createCrossMarketStrategy(data) {
    assertDatabaseAvailable();
    const strategy = new CrossMarket(data);
    await strategy.save();
    return strategy.toObject();
}

async function updateCrossMarketStrategy(id, updates) {
    assertDatabaseAvailable();
    return CrossMarket.findByIdAndUpdate(
        id,
        updates,
        { returnDocument: 'after' }
    ).lean();
}

async function deleteCrossMarketStrategy(id) {
    assertDatabaseAvailable();
    return CrossMarket.findByIdAndDelete(id).lean();
}

async function toggleCrossMarketStrategy(id) {
    assertDatabaseAvailable();
    const strategy = await CrossMarket.findById(id);
    if (!strategy) return null;
    strategy.active = !strategy.active;
    await strategy.save();
    return strategy.toObject();
}

module.exports = {
    connect,
    disconnect,
    getUserByUsername,
    getUserByEmail,
    createUser,
    updateUserStopTrader,
    deleteUser,
    getAllUsers,
    getAllExchanges,
    getExchangeByAcronym,
    getExchangeCredentialsByAcronym,
    getActiveExchangeStatuses,
    getExchangeStatusByAcronym,
    createExchange,
    updateExchange,
    deleteExchange,
    toggleExchangeStatus,
    // Cross-Market
    getAllCrossMarketStrategies,
    getCrossMarketStrategyById,
    createCrossMarketStrategy,
    updateCrossMarketStrategy,
    deleteCrossMarketStrategy,
    toggleCrossMarketStrategy
};
