const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-btn');
const statusDot = document.getElementById('api-status');
const statusText = document.getElementById('status-text');
const pageList = document.getElementById('page-list');
const lastUpdated = document.getElementById('last-updated');
const messageTemplate = document.getElementById('message-template');

function setStatus(state, message) {
  statusDot.style.background = state === 'ready' ? '#34a853' : state === 'error' ? '#ea4335' : '#6b7280';
  statusText.textContent = message;
}

function formatDate(dateString) {
  if (!dateString) return 'unknown';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderPages(pages) {
  pageList.innerHTML = '';
  if (!pages || pages.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'No pages scraped yet. Run npm run scrape to build the dataset.';
    empty.style.borderLeft = '4px solid #ea4335';
    empty.style.background = '#fee2e2';
    pageList.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  pages.forEach((page) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = page.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = page.title || page.url;
    const time = document.createElement('time');
    time.dateTime = page.scrapedAt;
    time.textContent = `Scraped ${formatDate(page.scrapedAt)}`;
    item.appendChild(link);
    item.appendChild(time);
    fragment.appendChild(item);
  });
  pageList.appendChild(fragment);
}

async function refreshDatasetSnapshot() {
  try {
    const response = await fetch('/api/pages', { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`Status ${response.status}`);
    }
    const data = await response.json();
    renderPages(data.pages || []);
    if (data.pages && data.pages.length > 0) {
      setStatus('ready', 'Dataset loaded');
      lastUpdated.textContent = `Knowledge base updated ${formatDate(data.pages[0].scrapedAt)} (${data.pages.length} pages shown).`;
    } else {
      setStatus('idle', 'Scrape the PMI DA Browser to start.');
      lastUpdated.textContent = 'No data loaded yet.';
    }
  } catch (error) {
    console.error('Failed to refresh dataset snapshot', error);
    setStatus('error', 'Server unavailable or dataset missing.');
  }
}

function createMessage(role, text, sources = []) {
  const fragment = messageTemplate.content.cloneNode(true);
  const article = fragment.querySelector('.message');
  article.classList.add(role);
  fragment.querySelector('.message-role').textContent = role === 'user' ? 'Participant' : 'YodaAI';
  fragment.querySelector('.message-time').textContent = new Date().toLocaleTimeString();
  fragment.querySelector('.message-body').textContent = text;
  const sourcesList = fragment.querySelector('.sources');
  sourcesList.innerHTML = '';
  if (sources && sources.length > 0) {
    sources.forEach((source, index) => {
      const li = document.createElement('li');
      const anchor = document.createElement('a');
      anchor.href = source.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      anchor.textContent = `${index + 1}. ${source.title || source.url}`;
      li.appendChild(anchor);
      if (source.snippet) {
        const snippet = document.createElement('div');
        snippet.textContent = source.snippet;
        snippet.className = 'snippet';
        li.appendChild(snippet);
      }
      sourcesList.appendChild(li);
    });
  } else {
    sourcesList.remove();
  }
  return fragment;
}

function appendMessage(role, text, sources = []) {
  const messageNode = createMessage(role, text, sources);
  chatLog.appendChild(messageNode);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function setLoading(isLoading) {
  sendButton.disabled = isLoading;
  chatInput.disabled = isLoading;
  if (isLoading) {
    sendButton.textContent = 'Sending…';
  } else {
    sendButton.textContent = 'Send';
  }
}

async function sendMessage(message) {
  appendMessage('user', message);
  setLoading(true);
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ message }),
    });
    const data = await response.json();
    if (!response.ok) {
      if (data && data.fallback) {
        appendMessage('assistant', data.fallback, data.sources || []);
      } else {
        throw new Error(`Server returned ${response.status}`);
      }
    } else {
      appendMessage('assistant', data.reply, data.sources || []);
    }
  } catch (error) {
    console.error('Failed to send message', error);
    appendMessage('assistant', 'I could not reach the YodaAI service. Please ensure the server is running.', []);
  } finally {
    setLoading(false);
  }
}

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  chatInput.value = '';
  sendMessage(message);
});

refreshDatasetSnapshot();
window.setInterval(refreshDatasetSnapshot, 60_000);
