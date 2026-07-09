const mongoose = require('mongoose');
const User = require('./models/User');
const Exchange = require('./models/Exchange');
const CrossMarket = require('./models/CrossMarket');
const CrossMarketTrade = require('./models/CrossMarketTrade');
const TransferCatalog = require('./models/TransferCatalog');
const TransferHistory = require('./models/TransferHistory');

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

// ------- Exchange (API — filtrado por userId) -------

async function getAllExchanges(userId) {
    assertDatabaseAvailable();
    const filter = userId ? { userId } : {};
    const exchanges = await Exchange.find(filter).select('+secretKey +password').sort({ acronym: 1 }).lean();
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

// Uso interno pelos serviços de background (sem contexto de usuário)
async function getExchangeByAcronym(acronym) {
    assertDatabaseAvailable();
    return Exchange.findOne({ acronym: String(acronym || '').trim().toUpperCase() })
        .select('+secretKey +password +arbitrageConfig +marketMakingConfig')
        .lean();
}

// Retorna status de exchanges do usuário (para controle de abas no frontend)
async function getActiveExchangeStatuses(userId) {
    assertDatabaseAvailable();
    const filter = userId ? { userId } : {};
    const exchanges = await Exchange.find(filter).select('acronym active').lean();
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

// Uso interno pelos serviços de background (sem contexto de usuário)
async function getExchangeCredentialsByAcronym(acronym) {
    assertDatabaseAvailable();
    return Exchange.findOne({ acronym: String(acronym || '').trim().toUpperCase() })
        .select('+secretKey +password apiKey acronym active')
        .lean();
}

async function createExchange(userId, exchangeData) {
    assertDatabaseAvailable();
    const exchange = new Exchange({ ...exchangeData, userId });
    await exchange.save();
    return sanitizeExchange(exchange);
}

async function updateExchange(id, userId, updates) {
    assertDatabaseAvailable();
    // Garante que o documento pertence ao usuário antes de atualizar
    const exchange = await Exchange.findOneAndUpdate(
        { _id: id, userId },
        updates,
        { returnDocument: 'after' }
    ).select('+secretKey +password').lean();
    return sanitizeExchange(exchange);
}

async function deleteExchange(id, userId) {
    assertDatabaseAvailable();
    return Exchange.findOneAndDelete({ _id: id, userId });
}

async function toggleExchangeStatus(id, userId) {
    assertDatabaseAvailable();
    const exchange = await Exchange.findOne({ _id: id, userId }).select('+secretKey +password');
    if (!exchange) return null;

    exchange.active = !exchange.active;
    await exchange.save();

    return sanitizeExchange(exchange);
}

// ------- Cross-Market Strategy (API — filtrado por userId) -------

// Versão sem filtro usada pelo cross-market-service (background)
async function getAllCrossMarketStrategies(userId) {
    assertDatabaseAvailable();
    const filter = userId ? { userId } : {};
    return CrossMarket.find(filter).sort({ created_at: -1 }).lean();
}

async function getCrossMarketStrategyById(id, userId) {
    assertDatabaseAvailable();
    const filter = userId ? { _id: id, userId } : { _id: id };
    return CrossMarket.findOne(filter).lean();
}

async function createCrossMarketStrategy(userId, data) {
    assertDatabaseAvailable();
    const strategy = new CrossMarket({ ...data, userId });
    await strategy.save();
    return strategy.toObject();
}

async function updateCrossMarketStrategy(id, userId, updates) {
    assertDatabaseAvailable();
    return CrossMarket.findOneAndUpdate(
        { _id: id, userId },
        updates,
        { returnDocument: 'after' }
    ).lean();
}

async function deleteCrossMarketStrategy(id, userId) {
    assertDatabaseAvailable();
    return CrossMarket.findOneAndDelete({ _id: id, userId }).lean();
}

async function toggleCrossMarketStrategy(id, userId) {
    assertDatabaseAvailable();
    const strategy = await CrossMarket.findOne({ _id: id, userId });
    if (!strategy) return null;
    strategy.active = !strategy.active;
    await strategy.save();
    return strategy.toObject();
}

async function createCrossMarketTrade(tradeData) {
    assertDatabaseAvailable();
    const trade = new CrossMarketTrade(tradeData);
    await trade.save();
    return trade.toObject();
}

async function getCrossMarketTrades(userId, filter = {}, options = {}) {
    assertDatabaseAvailable();
    const queryFilter = { ...filter };
    if (userId) queryFilter.userId = userId;
    
    const limit = parseInt(options.limit) || 100;
    const skip = parseInt(options.skip) || 0;
    
    return CrossMarketTrade.find(queryFilter)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
}

async function getCrossMarketTradesCount(userId, filter = {}) {
    assertDatabaseAvailable();
    const queryFilter = { ...filter };
    if (userId) queryFilter.userId = userId;
    return CrossMarketTrade.countDocuments(queryFilter);
}

async function createTransferCatalogEntry(userId, data) {
    assertDatabaseAvailable();
    const query = { userId, exchange: data.exchange.toUpperCase(), currency: data.currency.toUpperCase(), network: data.network };
    const update = { ...data, userId, exchange: data.exchange.toUpperCase(), currency: data.currency.toUpperCase() };
    return TransferCatalog.findOneAndUpdate(query, update, {
        new: true,
        upsert: true,
        runValidators: true
    }).lean();
}

async function getTransferCatalogEntries(userId) {
    assertDatabaseAvailable();
    return TransferCatalog.find({ userId }).sort({ exchange: 1, currency: 1, network: 1 }).lean();
}

async function deleteTransferCatalogEntry(id, userId) {
    assertDatabaseAvailable();
    return TransferCatalog.findOneAndDelete({ _id: id, userId }).lean();
}

async function getTransferCatalogEntryById(id, userId) {
    assertDatabaseAvailable();
    return TransferCatalog.findOne({ _id: id, userId }).lean();
}

async function createTransferHistoryEntry(data) {
    assertDatabaseAvailable();
    const history = new TransferHistory(data);
    await history.save();
    return history.toObject();
}

async function getTransferHistory(userId) {
    assertDatabaseAvailable();
    return TransferHistory.find({ userId })
        .sort({ created_at: -1 })
        .populate('catalogId')
        .lean();
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
    toggleCrossMarketStrategy,
    createCrossMarketTrade,
    getCrossMarketTrades,
    getCrossMarketTradesCount,
    // Transfer Catalog
    createTransferCatalogEntry,
    getTransferCatalogEntries,
    deleteTransferCatalogEntry,
    getTransferCatalogEntryById,
    // Transfer History
    createTransferHistoryEntry,
    getTransferHistory
};
