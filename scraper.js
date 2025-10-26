const { setTimeout: delay } = require('node:timers/promises');
const { upsertPage, ensureDatabaseFile, DB_PATH } = require('./src/db');

const DEFAULT_BASE_URL = 'https://dabrowser.pmi.org/';
const MAX_PAGES = Number.parseInt(process.env.MAX_PAGES || '20', 10);
const REQUEST_DELAY_MS = Number.parseInt(process.env.REQUEST_DELAY_MS || '500', 10);

function normalizeUrl(input) {
  try {
    const url = new URL(input);
    url.hash = '';
    let pathname = url.pathname;
    if (pathname && pathname !== '/') {
      pathname = pathname.replace(/\/+$/, '');
      if (!pathname.startsWith('/')) {
        pathname = `/${pathname}`;
      }
      if (pathname === '') {
        pathname = '/';
      }
    }
    url.pathname = pathname || '/';
    return url.toString();
  } catch (error) {
    return input;
  }
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'YodaAI-Scraper/1.0 (+https://dabrowser.pmi.org)',
      'Accept': 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return await response.text();
}

function decodeHtmlEntities(text) {
  if (!text) return '';
  const entities = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#x27;': "'",
    '&#8217;': "'",
    '&#8220;': '"',
    '&#8221;': '"',
  };
  return text.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (match) => {
    if (entities[match]) return entities[match];
    if (match.startsWith('&#x')) {
      return String.fromCodePoint(parseInt(match.slice(3, -1), 16));
    }
    if (match.startsWith('&#')) {
      return String.fromCodePoint(parseInt(match.slice(2, -1), 10));
    }
    return ' ';
  });
}

function extractTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    return decodeHtmlEntities(titleMatch[1]).trim();
  }
  return '';
}

function stripTags(html) {
  if (!html) return '';
  let cleaned = html;
  const blockTags = [
    'article',
    'section',
    'header',
    'footer',
    'main',
    'div',
    'p',
    'li',
    'ul',
    'ol',
    'nav',
    'table',
    'tr',
    'td',
    'th',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
  ];
  cleaned = cleaned.replace(/<!--([\s\S]*?)-->/g, ' ');
  cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  cleaned = cleaned.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  cleaned = cleaned.replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ');
  cleaned = cleaned.replace(/<br\s*\/?\s*>/gi, '\n');
  for (const tag of blockTags) {
    const regexOpen = new RegExp(`<${tag}[^>]*>`, 'gi');
    const regexClose = new RegExp(`<\/${tag}>`, 'gi');
    cleaned = cleaned.replace(regexOpen, '\n');
    cleaned = cleaned.replace(regexClose, '\n');
  }
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');
  cleaned = decodeHtmlEntities(cleaned);
  cleaned = cleaned.replace(/\r/g, ' ');
  cleaned = cleaned.replace(/\t/g, ' ');
  cleaned = cleaned.replace(/\f/g, ' ');
  cleaned = cleaned.replace(/\u00a0/g, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ');
  return cleaned.trim();
}

function extractLinks(html, currentUrl, allowedHost) {
  const links = new Set();
  const anchorRegex = /<a [^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1];
    try {
      const candidate = new URL(href, currentUrl);
      if (!candidate.protocol.startsWith('http')) continue;
      if (candidate.hostname !== allowedHost) continue;
      candidate.hash = '';
      const normalized = normalizeUrl(candidate.toString());
      if (normalized.includes('?')) continue;
      links.add(normalized);
    } catch (error) {
      // ignore invalid URLs
    }
  }
  return Array.from(links);
}

async function scrape(baseUrl = DEFAULT_BASE_URL) {
  ensureDatabaseFile();
  const normalizedBase = normalizeUrl(baseUrl);
  const host = new URL(normalizedBase).hostname;
  const queue = [normalizedBase];
  const visited = new Set();
  while (queue.length && visited.size < MAX_PAGES) {
    const current = queue.shift();
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    try {
      console.log(`Scraping ${current}`);
      const html = await fetchHtml(current);
      const title = extractTitle(html) || current;
      const content = stripTags(html);
      if (content && content.length > 0) {
        upsertPage({ url: current, title, content });
      } else {
        console.warn(`No readable content detected for ${current}`);
      }
      const links = extractLinks(html, current, host);
      for (const link of links) {
        if (!visited.has(link) && !queue.includes(link) && queue.length + visited.size < MAX_PAGES * 2) {
          queue.push(link);
        }
      }
    } catch (error) {
      console.error(`Failed to process ${current}: ${error.message}`);
    }
    if (REQUEST_DELAY_MS > 0) {
      await delay(REQUEST_DELAY_MS);
    }
  }
  console.log(`Scraping complete. Stored ${visited.size} pages in ${DB_PATH}`);
}

if (require.main === module) {
  const baseUrl = process.argv[2] || DEFAULT_BASE_URL;
  scrape(baseUrl).catch((error) => {
    console.error('Unexpected scraper error:', error);
    process.exitCode = 1;
  });
}

module.exports = { scrape };
