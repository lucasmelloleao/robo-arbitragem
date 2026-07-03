function normalizePathname(pathname) {
    if (!pathname || pathname === '/') {
        return '/';
    }

    return pathname.replace(/\/+$/, '') || '/';
}

function splitPath(pathname) {
    const normalizedPath = normalizePathname(pathname);

    if (normalizedPath === '/') {
        return [];
    }

    return normalizedPath.split('/').filter(Boolean);
}

function matchPath(pattern, pathname) {
    const patternSegments = splitPath(pattern);
    const pathnameSegments = splitPath(pathname);

    if (patternSegments.length !== pathnameSegments.length) {
        return null;
    }

    const params = {};

    for (let index = 0; index < patternSegments.length; index += 1) {
        const patternSegment = patternSegments[index];
        const pathnameSegment = pathnameSegments[index];

        if (patternSegment.startsWith(':')) {
            params[patternSegment.slice(1)] = decodeURIComponent(pathnameSegment);
            continue;
        }

        if (patternSegment !== pathnameSegment) {
            return null;
        }
    }

    return params;
}

function createRouter() {
    const routes = [];

    function register(method, pattern, handler) {
        routes.push({
            method: method.toUpperCase(),
            pattern,
            handler
        });
    }

    async function handle(request, response, requestUrl, context) {
        const method = request.method.toUpperCase();
        const pathname = normalizePathname(requestUrl.pathname);

        for (const route of routes) {
            if (route.method !== method) {
                continue;
            }

            const params = matchPath(route.pattern, pathname);

            if (!params) {
                continue;
            }

            await route.handler({ request, response, requestUrl, params, context });
            return true;
        }

        return false;
    }

    return {
        handle,
        register
    };
}

module.exports = { createRouter };