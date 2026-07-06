// Configuração da API do backend
// Pode ser sobrescrita via variável de ambiente VITE_API_URL ou localStorage
const API_URL = window.__API_URL__ || window.location.hostname === 'localhost' && window.location.port === '3000'
    ? 'http://localhost:8080'
    : '';

// Exporta para uso nos módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { API_URL };
} else {
    window.API_URL = API_URL;
}