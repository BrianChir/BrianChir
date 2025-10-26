const fs = require('node:fs');
const path = require('node:path');

const DB_PATH = path.join(__dirname, '..', 'data', 'pmidb.json');

function ensureDatabaseFile() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    const initial = { pages: [], lastScraped: null };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), 'utf8');
  }
}

function readDatabase() {
  ensureDatabaseFile();
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    if (!raw.trim()) {
      return { pages: [], lastScraped: null };
    }
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to read database file. Recreating a clean copy.', error);
    const fallback = { pages: [], lastScraped: null };
    fs.writeFileSync(DB_PATH, JSON.stringify(fallback, null, 2), 'utf8');
    return fallback;
  }
}

function writeDatabase(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeUrl(input) {
  try {
    const url = new URL(input);
    url.hash = '';
    if (url.pathname !== '/') {
      url.pathname = url.pathname.replace(/\/+$/, '');
      if (url.pathname === '') {
        url.pathname = '/';
      }
    }
    return url.toString();
  } catch (error) {
    return input;
  }
}

function upsertPage(page) {
  const { url, title, content, scrapedAt } = page;
  if (!url || !content) {
    return;
  }
  const db = readDatabase();
  const normalizedUrl = normalizeUrl(url);
  const now = scrapedAt || new Date().toISOString();
  const entry = {
    url: normalizedUrl,
    title: title || normalizedUrl,
    content,
    scrapedAt: now,
  };
  const index = db.pages.findIndex((item) => item.url === normalizedUrl);
  if (index >= 0) {
    db.pages[index] = entry;
  } else {
    db.pages.push(entry);
  }
  db.lastScraped = now;
  writeDatabase(db);
}

function getRecentPages(limit = 10) {
  const db = readDatabase();
  return db.pages
    .slice()
    .sort((a, b) => new Date(b.scrapedAt || 0) - new Date(a.scrapedAt || 0))
    .slice(0, limit);
}

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function escapeRegExp(term) {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countOccurrences(text, term) {
  if (!text || !term) return 0;
  const regex = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi');
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function buildSnippet(content, terms, radius = 140) {
  if (!content) return '';
  const lower = content.toLowerCase();
  let bestIndex = Infinity;
  for (const term of terms) {
    const idx = lower.indexOf(term.toLowerCase());
    if (idx !== -1 && idx < bestIndex) {
      bestIndex = idx;
    }
  }
  if (!Number.isFinite(bestIndex)) {
    return content.length > 280 ? `${content.slice(0, 280)}…` : content;
  }
  const start = Math.max(0, bestIndex - radius);
  const end = Math.min(content.length, bestIndex + radius);
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}

function searchPages(query, limit = 5) {
  const terms = tokenize(query);
  const db = readDatabase();
  if (!terms.length) {
    return getRecentPages(limit);
  }
  const scored = db.pages
    .map((page) => {
      const title = page.title || '';
      const content = page.content || '';
      let score = 0;
      for (const term of terms) {
        score += countOccurrences(title, term) * 5;
        score += countOccurrences(content, term);
      }
      if (score === 0) return null;
      return {
        ...page,
        score,
        snippet: buildSnippet(content, terms),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored;
}

module.exports = {
  DB_PATH,
  ensureDatabaseFile,
  readDatabase,
  upsertPage,
  searchPages,
  getRecentPages,
};
