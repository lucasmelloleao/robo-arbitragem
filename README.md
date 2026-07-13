# Lucas

Projeto separado em duas frentes principais:

- `frontend/public`: interface web estática, com `index.html`, `app.js` e `styles.css`.
- `backend`: ponto de entrada e código do servidor.

## Estrutura

```text
backend/
  index.js
  src/
    arbitrage-service.js
    database.js
    market-making-service.js
    models/
    server.js
frontend/
  public/
    app.js
    index.html
    styles.css
logs/
```

## Execução

- `npm run dev`: sobe o backend em modo watch.
- `npm run start`: sobe o backend em modo normal.

O backend serve os arquivos estáticos do frontend a partir de `frontend/public`.

## Backend HTTP

Estrutura principal do backend:

- `backend/src/routes`: definição das rotas HTTP por domínio.
- `backend/src/controllers`: lógica HTTP desacoplada do servidor.
- `backend/src/ws`: roteamento e handlers de ações websocket.

Endpoints HTTP atuais:

- `GET /api/users`
- `POST /api/users`
- `PUT /api/users/:username`
- `GET /api/arbitrage/:exchangeId/status`
- `POST /api/arbitrage/:exchangeId/scan`
- `GET /api/arbitrage/:exchangeId/logs?limit=30`
- `GET /api/market-making/:exchangeId/status`
- `POST /api/market-making/:exchangeId/run`
- `POST /api/market-making/:exchangeId/cancel`

## Backend WebSocket

Canal websocket:

- `ws://host/ws`

Ações suportadas:

- `subscribe`
- `unsubscribe`
- `status`
- `logs`
- `scan`
- `market-making-subscribe`
- `market-making-unsubscribe`
- `market-making-status`
- `market-making-run`
- `market-making-cancel`

## Banco de dados

As rotas de usuário dependem de `MONGODB_URI` no ambiente.
Sem essa variável, o backend sobe normalmente, mas as operações de usuário retornam erro de configuração.

## Docker e Google Cloud Run

O projeto está configurado para rodar no Google Cloud Run usando containers Docker.

### Arquivos de configuração

- `backend/Dockerfile`: imagem Docker para o backend (Node.js 18 Alpine).
- `frontend/Dockerfile`: imagem Docker para o frontend (Node.js 18 Alpine).
- `backend/.dockerignore` e `frontend/.dockerignore`: arquivos ignorados no build.
- `docker-compose.yml`: para testar localmente com Docker Compose.

### Variáveis de ambiente

- `PORT`: porta que o container deve escutar (Cloud Run fornece automaticamente).
- `STRATEGY`: estratégia a iniciar (`arbitrage`, `cross-market`, `market-making`).
- `MONGODB_URI`: string de conexão com o MongoDB (obrigatória para funcionalidades de usuário).
- Outras variáveis conforme necessário (ex: chaves de API das exchanges).

### Build e execução local com Docker Compose

```bash
docker-compose up --build
```

### Deploy no Google Cloud Run

1. Build e push da imagem (exemplo com Google Artifact Registry):

```bash
# Backend
gcloud builds submit --tag gcr.io/SEU_PROJETO/backend ./backend
gcloud run deploy backend \
  --image gcr.io/SEU_PROJETO/backend \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars STRATEGY=arbitrage,MONGODB_URI=sua_uri

# Frontend
gcloud builds submit --tag gcr.io/SEU_PROJETO/frontend ./frontend
gcloud run deploy frontend \
  --image gcr.io/SEU_PROJETO/frontend \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

Substitua `SEU_PROJETO` pelo ID do seu projeto no Google Cloud e ajuste a região conforme necessário.