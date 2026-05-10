'use strict';

const fs = require('fs');
const path = require('path');

class ArtifactWriter {
  constructor(rootDir) {
    this.rootDir = rootDir;
    fs.mkdirSync(rootDir, { recursive: true });
  }

  writeJson(name, payload) {
    const filePath = path.join(this.rootDir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
    return filePath;
  }
}

module.exports = { ArtifactWriter };
