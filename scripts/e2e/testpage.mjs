/** Minimal static server for the extension e2e test page (stdlib only). */
import { createServer } from 'node:http';

const HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>AutoCorrect AI e2e</title></head>
<body>
  <h1>e2e</h1>
  <textarea id="ta" rows="3" cols="40"></textarea><br>
  <input id="in" type="text"><br>
  <div id="ce" contenteditable="true" style="border:1px solid #999;min-height:2em;"></div><br>
  <textarea id="ai" rows="3" cols="40"></textarea><br>
  <input id="search" type="search" placeholder="Search"><br>
  <input id="pwd" type="password"><br>
  <input id="dis" type="text" disabled value=""><br>
  <form id="f"><input id="formIn" type="text"></form><br>
  <textarea id="btn" rows="3" cols="40"></textarea><br>
  <div id="ce2" contenteditable="true" style="border:1px solid #999;min-height:2em;"></div>
  <script>
    window.__formSubmitted = false;
    document.getElementById('f').addEventListener('submit', (e) => {
      e.preventDefault();
      window.__formSubmitted = true;
    });
  </script>
  <div style="height:1500px;"></div>
  <textarea id="mid" rows="3" cols="40"></textarea>
  <div style="height:1500px;"></div>
  <textarea id="bottom" rows="3" cols="40"></textarea>
</body>
</html>`;

export function startTestPageServer(port = 8901) {
  const server = createServer((req, res) => {
    if (req.url === '/test.html' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(HTML);
      return;
    }
    res.writeHead(404);
    res.end('nope');
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
