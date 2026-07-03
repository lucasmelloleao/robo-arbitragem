function createWebSocketRouter() {
    const handlers = new Map();

    function register(action, handler) {
        handlers.set(action, handler);
    }

    async function handle(request, socket, context) {
        const handler = handlers.get(request?.action);

        if (!handler) {
            throw new Error('Ação WebSocket não suportada.');
        }

        return await handler({ request, socket, context });
    }

    return {
        handle,
        register
    };
}

module.exports = { createWebSocketRouter };