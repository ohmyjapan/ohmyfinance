// Simple proxy server to forward Windows localhost to WSL
// Run with: node proxy-server.cjs

const http = require('http');

const WSL_HOST = '127.0.0.1';  // WSL localhost via Windows
const WSL_PORT = 6100;
const PROXY_PORT = 3000;

const server = http.createServer((req, res) => {
    const options = {
        hostname: WSL_HOST,
        port: WSL_PORT,
        path: req.url,
        method: req.method,
        headers: req.headers
    };

    const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
        console.error('Proxy error:', err.message);
        res.writeHead(502);
        res.end('Proxy Error: ' + err.message);
    });

    req.pipe(proxyReq);
});

server.listen(PROXY_PORT, '127.0.0.1', () => {
    console.log(`Proxy server running at http://localhost:${PROXY_PORT}/`);
    console.log(`Forwarding to WSL at ${WSL_HOST}:${WSL_PORT}`);
    console.log('\nOpen http://localhost:3000/ in your browser');
});
