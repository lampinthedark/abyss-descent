'use strict';

/**
 * Copy the GitHub Pages site into www/ and link the Capacitor-only shell.
 * Root index.html is never modified, so Pages keeps serving the browser build.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const www = path.join(root, 'www');

const COPY = ['index.html', 'favicon.ico', 'favicon.svg', 'css', 'js'];

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });

for (const rel of COPY) {
  fs.cpSync(path.join(root, rel), path.join(www, rel), { recursive: true });
}

const mobileOut = path.join(www, 'mobile');
fs.mkdirSync(mobileOut, { recursive: true });
for (const name of ['shell.css', 'shell.js']) {
  fs.copyFileSync(path.join(root, 'mobile', name), path.join(mobileOut, name));
}

const indexPath = path.join(www, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
if (html.includes('mobile/shell')) {
  throw new Error('source index.html already references the native shell');
}
if (!html.includes('</head>') || !html.includes('</body>')) {
  throw new Error('index.html is missing </head> or </body>');
}
html = html.replace(
  '</head>',
  '  <link rel="stylesheet" href="mobile/shell.css" />\n</head>'
);
html = html.replace(
  '</body>',
  '  <script src="mobile/shell.js"></script>\n</body>'
);
fs.writeFileSync(indexPath, html);

const rootHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (rootHtml.includes('mobile/shell')) {
  throw new Error('GitHub Pages index.html must not link the native shell');
}

console.log('Copied the web game into www/ with the Capacitor shell.');
