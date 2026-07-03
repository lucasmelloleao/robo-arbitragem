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