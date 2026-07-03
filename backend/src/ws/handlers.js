const { createWebSocketRouter } = require('./router');

function createWebSocketHandlers(context) {
    const router = createWebSocketRouter();

    router.register('subscribe', async ({ request, socket, context: ctx }) => {
        return await ctx.subscribeSocketToExchange(socket, request.exchangeId);
    });

    router.register('unsubscribe', async ({ request, socket, context: ctx }) => {
        return ctx.unsubscribeSocketFromExchange(socket, request.exchangeId);
    });

    router.register('market-making-subscribe', async ({ request, socket, context: ctx }) => {
        return await ctx.subscribeSocketToMarketMaking(socket, request.exchangeId);
    });

    router.register('market-making-unsubscribe', async ({ request, socket, context: ctx }) => {
        return ctx.unsubscribeSocketFromMarketMaking(socket, request.exchangeId);
    });

    router.register('market-making-status', async ({ request, context: ctx }) => {
        const service = await ctx.getMarketMakingService(request.exchangeId);
        return await service.getStatus();
    });

    router.register('market-making-run', async ({ request, context: ctx }) => {
        const service = await ctx.getMarketMakingService(request.exchangeId);
        const run = await service.run();
        const status = await service.getStatus();
        return { run, status };
    });

    router.register('market-making-cancel', async ({ request, context: ctx }) => {
        const service = await ctx.getMarketMakingService(request.exchangeId);
        const cancellation = await service.cancelActiveExecution();
        const status = await service.getStatus();
        return { cancellation, status };
    });

    router.register('status', async ({ request, context: ctx }) => {
        const service = await ctx.getService(request.exchangeId);
        return await service.getStatus();
    });

    router.register('logs', async ({ request, context: ctx }) => {
        const service = await ctx.getService(request.exchangeId);
        return { logs: await service.readLogs(30) };
    });

    router.register('scan', async ({ request, context: ctx }) => {
        const service = await ctx.getService(request.exchangeId);
        const scan = await service.scan();
        return { scan, logs: await service.readLogs(10) };
    });

    return {
        handle: async (request, socket) => await router.handle(request, socket, context)
    };
}

module.exports = { createWebSocketHandlers };