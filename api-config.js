// Local development uses the standalone API port. Production serves the API
// behind the same HTTPS origin through Nginx, so browser requests stay on the
// current domain instead of falling back to the visitor's localhost.
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
window.CONTENT_API_BASE = window.CONTENT_API_BASE || (localHosts.has(location.hostname) ? 'http://127.0.0.1:8787' : location.origin);
