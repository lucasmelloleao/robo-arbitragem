function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    response.end(JSON.stringify(payload));
}

function sendNoContent(response) {
    response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Length': '0'
    });
    response.end();
}

async function readJsonBody(request) {
    let body = '';

    for await (const chunk of request) {
        body += chunk;
    }

    return JSON.parse(body || '{}');
}

module.exports = {
    readJsonBody,
    sendJson,
    sendNoContent
};