const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const {
  ensureDatabaseFile,
  getRecentPages,
  searchPages,
  readDatabase,
  DB_PATH,
} = require('./src/db');

loadEnvFile();

const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_PORT = Number.parseInt(process.env.PORT || '3000', 10);
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

ensureDatabaseFile();

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }
  const content = fs.readFileSync(envPath, 'utf8');
  content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .forEach((line) => {
      const index = line.indexOf('=');
      if (index === -1) return;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
        process.env[key] = value;
      }
    });
}

function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

function handleOptions(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end();
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Payload too large'));
        req.connection.destroy();
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', (err) => reject(err));
  });
}

function sanitizeContext(content) {
  if (!content) return '';
  return content.replace(/\s+/g, ' ').trim();
}

function createContextBlock(result, index) {
  const snippet = sanitizeContext(result.snippet || result.content || '').slice(0, 1200);
  return `Source ${index + 1}: ${result.title}\nURL: ${result.url}\nExcerpt: ${snippet}`;
}

async function callOpenAI(prompt, contextBlocks) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const body = {
    model,
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content:
          'You are YodaAI. Only answer questions using the supplied PMI Disciplined Agile Browser context. ' +
          'If the context does not contain the answer, respond with: "I do not have enough information from the PMI Disciplined Agile Browser dataset."',
      },
      {
        role: 'user',
        content: `Context:\n${contextBlocks.join('\n\n')}\n\nQuestion: ${prompt}\nAnswer using only the context above.`,
      },
    ],
  };
  const response = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${detail}`);
  }
  const json = await response.json();
  const reply = json?.choices?.[0]?.message?.content;
  return reply ? reply.trim() : null;
}

function fallbackAnswer(results) {
  if (!results.length) {
    return 'I do not have enough information from the PMI Disciplined Agile Browser dataset to answer that yet.';
  }
  const bullets = results
    .slice(0, 5)
    .map((item) => `• ${item.title || item.url}: ${sanitizeContext(item.snippet || item.content).slice(0, 180)}…`)
    .join('\n');
  return `OpenAI API key not configured. Here are relevant references you can review manually:\n${bullets}`;
}

async function handleChat(req, res) {
  try {
    const body = await readRequestBody(req);
    const message = (body.message || '').trim();
    if (!message) {
      sendJson(res, 400, { error: 'Message is required.' });
      return;
    }
    const matches = searchPages(message, 6) || [];
    if (matches.length === 0) {
      sendJson(res, 200, {
        reply: 'I do not have enough information from the PMI Disciplined Agile Browser dataset to answer that yet.',
        sources: [],
      });
      return;
    }
    const contextBlocks = matches.map((result, index) => createContextBlock(result, index));
    try {
      const aiReply = await callOpenAI(message, contextBlocks);
      const reply = aiReply || fallbackAnswer(matches);
      sendJson(res, 200, { reply, sources: matches });
    } catch (error) {
      console.error('OpenAI call failed:', error.message);
      sendJson(res, 502, {
        error: 'Failed to generate response from OpenAI.',
        detail: error.message,
        fallback: fallbackAnswer(matches),
        sources: matches,
      });
    }
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') {
    handleOptions(res);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/health') {
    const db = readDatabase();
    sendJson(res, 200, {
      status: 'ok',
      pages: db.pages.length,
      lastScraped: db.lastScraped,
      dbPath: DB_PATH,
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/pages') {
    const limit = Number.parseInt(url.searchParams.get('limit') || '10', 10);
    const pages = getRecentPages(Number.isNaN(limit) ? 10 : limit);
    sendJson(res, 200, { pages });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/search') {
    const query = url.searchParams.get('q') || '';
    const limit = Number.parseInt(url.searchParams.get('limit') || '5', 10);
    const results = searchPages(query, Number.isNaN(limit) ? 5 : limit);
    sendJson(res, 200, { query, results });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    handleChat(req, res);
    return;
  }
  sendJson(res, 404, { error: 'Not found' });
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    default:
      return 'application/octet-stream';
  }
}

function serveStaticFile(res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server Error');
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': getContentType(filePath) });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url);
    return;
  }
  if (url.pathname === '/data/pmidb.json') {
    fs.access(DB_PATH, fs.constants.F_OK, (err) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Dataset not found' }));
        return;
      }
      serveStaticFile(res, DB_PATH);
    });
    return;
  }
  let filePath = path.join(PUBLIC_DIR, decodeURIComponent(url.pathname));
  if (url.pathname === '/') {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }
  if (filePath.endsWith('/')) {
    filePath = path.join(filePath, 'index.html');
  }
  serveStaticFile(res, filePath);
});

server.listen(DEFAULT_PORT, () => {
  console.log(`YodaAI server ready on http://localhost:${DEFAULT_PORT}`);
  console.log(`Knowledge base stored at ${DB_PATH}`);
});
