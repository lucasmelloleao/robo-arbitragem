const {
    createUserHandler,
    listUsers,
    updateUserHandler,
    deleteUserHandler
} = require('../controllers/users-controller');

function registerUserRoutes(router) {
    router.register('GET', '/api/users', listUsers);
    router.register('POST', '/api/users', createUserHandler);
    router.register('PUT', '/api/users/:username', updateUserHandler);
    router.register('DELETE', '/api/users/:username', deleteUserHandler);
}

module.exports = { registerUserRoutes };
