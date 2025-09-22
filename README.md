# YodaAI · PMI Disciplined Agile Browser Assistant

This project bundles three capabilities:

1. **Targeted web scraper** for [`https://dabrowser.pmi.org/`](https://dabrowser.pmi.org/) that builds a local knowledge base.
2. **Lightweight JSON database** (`data/pmidb.json`) that stores page titles, cleaned text, and scrape timestamps.
3. **Grounded VChat interface** that only answers questions with facts taken from the scraped PMI Disciplined Agile Browser content.

The assistant enforces strict guardrails—if the knowledge base does not contain relevant information it declines to answer. When an OpenAI API key is configured, answers are generated with citations using only the retrieved context.

## Quick start

```bash
# 1. Install dependencies (Node.js 18+ includes everything required)
# 2. Scrape PMI Disciplined Agile Browser content (optional limit via MAX_PAGES)
npm run scrape

# 3. Start the HTTP server (default http://localhost:3000)
npm start
```

Open `http://localhost:3000` in your browser to use the chat UI. The sidebar shows the latest scraped pages and links to the raw dataset.

## Configuration

Create a `.env` file (or copy `.env.example`) to adjust behaviour:

```env
OPENAI_API_KEY=sk-your-api-key        # optional – enables OpenAI grounded answers
OPENAI_MODEL=gpt-4o-mini              # optional – override the chat model
PORT=3000                             # optional – change server port
MAX_PAGES=25                          # optional – scraper crawl limit
REQUEST_DELAY_MS=400                  # optional – politeness delay between requests
```

Without an `OPENAI_API_KEY`, the `/api/chat` endpoint falls back to returning relevant document excerpts so facilitators can craft answers manually.

## API overview

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/health` | GET | Returns dataset counts and last scrape timestamp. |
| `/api/pages?limit=10` | GET | Lists the most recently scraped pages. |
| `/api/search?q=agile&limit=5` | GET | Performs a keyword search across the knowledge base. |
| `/api/chat` | POST | `{ "message": "question" }` → grounded answer + cited sources. |

All endpoints return JSON and support CORS (`Access-Control-Allow-Origin: *`).

## Implementation notes

- Uses built-in `fetch`, `http`, and `fs` modules—no external npm packages are required.
- The scraper strips scripts/styles, decodes HTML entities, normalises whitespace, and ignores off-domain or query-string URLs.
- The JSON database performs simple term-frequency scoring to retrieve relevant passages for each query.
- The server exposes the raw dataset at `/data/pmidb.json` for transparency and auditing.
- The front-end UI (in `public/`) refreshes the dataset snapshot every minute and clearly signals when guardrails block answers.

## Limitations & next steps

- The scraper focuses on HTML pages reachable without query parameters; add a whitelist if deeper coverage is required.
- Text extraction is heuristic; integrating a DOM-aware parser would improve section fidelity.
- Retrieval currently uses term frequency; swapping in embeddings or BM25 would yield better relevance ranking when a vector database is available.

## Development scripts

```bash
npm run scrape   # crawl dabrowser.pmi.org and update data/pmidb.json
npm start        # launch the HTTP server and VChat UI
npm test         # placeholder – prints a message and exits
```

Contributions and improvements to the scraper, retrieval algorithm, or chat UI are welcome.
