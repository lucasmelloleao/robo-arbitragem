const systemExecutionService = require('../system-execution-service');
const { sendJson, readJsonBody } = require('../http-utils');
const { verifyToken } = require('../middleware/auth-middleware');

async function getExecutionStatus({ request, response }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;

    sendJson(response, 200, { active: systemExecutionService.isActive() });
}

async function toggleExecution({ request, response }) {
    const decoded = verifyToken(request, response);
    if (!decoded) return;

    try {
        const body = await readJsonBody(request);
        const { active } = body;

        if (active) {
            await systemExecutionService.startAll();
        } else {
            await systemExecutionService.stopAll();
        }

        sendJson(response, 200, { success: true, active: systemExecutionService.isActive() });
    } catch (err) {
        sendJson(response, 500, { error: err.message });
    }
}

function registerSystemRoutes(router) {
    router.register('GET', '/api/system/execution-status', getExecutionStatus);
    router.register('POST', '/api/system/toggle-execution', toggleExecution);
}

module.exports = { registerSystemRoutes };
