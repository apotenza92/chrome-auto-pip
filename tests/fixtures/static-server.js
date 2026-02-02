const http = require('http');
const fs = require('fs');
const path = require('path');

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/sample-video.html') {
        const filePath = path.resolve(__dirname, 'sample-video.html');
        fs.readFile(filePath, (err, data) => {
          if (err) {
            res.statusCode = 500;
            res.end('Failed to read fixture');
            return;
          }
          res.setHeader('Content-Type', 'text/html');
          res.end(data);
        });
        return;
      }

      res.statusCode = 404;
      res.end('Not found');
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind server'));
        return;
      }
      resolve({ server, baseURL: `http://127.0.0.1:${address.port}` });
    });
  });
}

module.exports = { startStaticServer };
