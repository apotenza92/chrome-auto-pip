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

      if (req.url === '/sample.mp4') {
        const filePath = path.resolve(__dirname, 'sample.mp4');

        fs.stat(filePath, (err, stats) => {
          if (err || !stats) {
            res.statusCode = 500;
            res.end('Failed to read video');
            return;
          }

          const total = stats.size;
          const range = req.headers.range;

          res.setHeader('Content-Type', 'video/mp4');
          res.setHeader('Accept-Ranges', 'bytes');

          if (!range) {
            res.statusCode = 200;
            res.setHeader('Content-Length', total);
            fs.createReadStream(filePath).pipe(res);
            return;
          }

          const match = /^bytes=(\d+)-(\d+)?$/.exec(range);
          if (!match) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${total}`);
            res.end();
            return;
          }

          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : total - 1;

          if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${total}`);
            res.end();
            return;
          }

          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
          res.setHeader('Content-Length', end - start + 1);

          fs.createReadStream(filePath, { start, end }).pipe(res);
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
