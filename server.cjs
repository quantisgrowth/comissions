// Servidor local de desenvolvimento (zero dependências)
// Executa com: node server.cjs

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 8000;
const DIST_DIR = path.join(__dirname, 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // CORS permissivo para dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let reqPath = req.url.split('?')[0].split('#')[0];
  if (reqPath === '/' || reqPath === '/index.html') {
    reqPath = '/index.html';
  } else if (reqPath === '/admin.html') {
    reqPath = '/admin.html';
  }

  // Remove prefixo /dist se foi passado
  if (reqPath.startsWith('/dist/')) {
    reqPath = reqPath.slice(5);
  }

  const filePath = path.join(DIST_DIR, reqPath);

  // Previne directory traversal
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Acesso proibido');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>404 - Arquivo não encontrado</h1><p>O arquivo <code>${reqPath}</code> não foi encontrado na pasta <code>dist/</code>.</p>`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(` Servidor de desenvolvimento rodando com sucesso!`);
  console.log(` Portal do Cliente / Vendedor:  http://localhost:${PORT}/index.html`);
  console.log(` Portal SuperAdmin (Backoffice): http://localhost:${PORT}/admin.html`);
  console.log(`======================================================\n`);
});

