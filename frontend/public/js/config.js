// Configuração da API do backend
// Se rodando em localhost, aponta para o backend local; caso contrário, usa o IP remoto.

const API_URL = (typeof window !== 'undefined' && window.location.hostname === 'localhost')
    ? 'http://localhost:8081'
    : 'http://136.118.82.39:8081';

// Exporta para uso nos módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { API_URL };
} else {
    window.API_URL = API_URL;
}
