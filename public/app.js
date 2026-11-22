const form = document.querySelector('#chat-form');
const input = document.querySelector('#message-input');
const sendButton = document.querySelector('#send-button');
const messagesElement = document.querySelector('#messages');
const welcomeElement = document.querySelector('#welcome');
const conversationScroll = document.querySelector('#conversation-scroll');
const errorElement = document.querySelector('#error-message');
const newChatButton = document.querySelector('#new-chat');

let history = [];
let isStreaming = false;

function scrollToBottom() {
  conversationScroll.scrollTop = conversationScroll.scrollHeight;
}

function makeAssistantAvatar() {
  const avatar = document.createElement('span');
  avatar.className = 'assistant-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.innerHTML = '<svg viewBox="0 0 32 32" fill="none"><path d="m16 3.5 2.9 8.6 8.6 2.9-8.6 2.9-2.9 8.6-2.9-8.6-8.6-2.9 8.6-2.9L16 3.5Z" fill="currentColor"/></svg>';
  return avatar;
}

function createMessage(role, text = '') {
  const row = document.createElement('article');
  row.className = `message-row ${role}`;

  const content = document.createElement('div');
  content.className = 'message-content';

  if (role === 'assistant') {
    row.append(makeAssistantAvatar(), content);
  } else {
    content.textContent = text;
    row.append(content);
  }

  messagesElement.append(row);
  return { row, content };
}

function renderMarkdown(content, text) {
  if (!window.marked || !window.DOMPurify) {
    content.textContent = text;
    return;
  }

  const rawHtml = window.marked.parse(text, { breaks: true });
  content.innerHTML = window.DOMPurify.sanitize(rawHtml);

  content.querySelectorAll('pre').forEach((pre) => {
    const copyButton = document.createElement('button');
    copyButton.className = 'copy-code';
    copyButton.type = 'button';
    copyButton.textContent = 'Copy';
    copyButton.setAttribute('aria-label', 'Copy code block');
    pre.append(copyButton);
  });
}

function showError(message) {
  errorElement.textContent = message;
  errorElement.hidden = false;
}

function clearError() {
  errorElement.textContent = '';
  errorElement.hidden = true;
}

function setBusy(busy) {
  isStreaming = busy;
  sendButton.disabled = busy;
  input.disabled = busy;
  sendButton.setAttribute('aria-label', busy ? 'Lumi AI is replying' : 'Send message');
}

function parseEventBlock(block) {
  const lines = block.split('\n');
  const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
  const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
  return { event, data };
}

async function streamReply(response, content) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';

    for (const block of blocks) {
      if (!block.trim()) continue;
      const { event, data } = parseEventBlock(block);

      if (event === 'error') {
        const payload = JSON.parse(data);
        throw new Error(payload.error || 'Something went wrong while generating a reply.');
      }
      if (event === 'done') return answer;
      if (data) {
        const payload = JSON.parse(data);
        if (typeof payload.text === 'string') {
          answer += payload.text;
          renderMarkdown(content, answer);
          scrollToBottom();
        }
      }
    }

    if (done) break;
  }

  return answer;
}

async function sendMessage(message) {
  if (!message || isStreaming) return;

  clearError();
  welcomeElement.hidden = true;
  history.push({ role: 'user', text: message });
  const userMessage = createMessage('user', message);
  input.value = '';
  input.style.height = 'auto';

  const { content } = createMessage('assistant');
  content.innerHTML = '<span class="typing-dots" aria-label="Lumi AI is typing"><span></span><span></span><span></span></span>';
  setBusy(true);
  scrollToBottom();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history })
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || `Request failed (${response.status}). Please try again.`);
    }

    const answer = await streamReply(response, content);
    if (!answer.trim()) throw new Error('Lumi AI returned an empty reply. Please try again.');
    history.push({ role: 'model', text: answer });
  } catch (error) {
    content.closest('.message-row')?.remove();
    userMessage.row.remove();
    history.pop();
    input.value = message;
    input.dispatchEvent(new Event('input'));
    showError(error.message || 'Could not reach Lumi AI. Check your connection and try again.');
  } finally {
    setBusy(false);
    input.focus();
    scrollToBottom();
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage(input.value.trim());
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
});

newChatButton.addEventListener('click', () => {
  if (isStreaming) return;
  history = [];
  messagesElement.replaceChildren();
  welcomeElement.hidden = false;
  clearError();
  input.value = '';
  input.style.height = 'auto';
  input.focus();
});

document.querySelectorAll('.suggestion').forEach((button) => {
  button.addEventListener('click', () => sendMessage(button.dataset.prompt ?? ''));
});

messagesElement.addEventListener('click', async (event) => {
  const button = event.target.closest('.copy-code');
  if (!button) return;

  try {
    const code = button.parentElement.querySelector('code')?.textContent ?? '';
    await navigator.clipboard.writeText(code);
    button.textContent = 'Copied';
    window.setTimeout(() => { button.textContent = 'Copy'; }, 1400);
  } catch {
    showError('Could not copy that code block. Please select and copy it manually.');
  }
});
