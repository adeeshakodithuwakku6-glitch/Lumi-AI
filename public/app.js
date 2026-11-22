const form = document.querySelector('#chat-form');
const input = document.querySelector('#message-input');
const sendButton = document.querySelector('#send-button');
const face = document.querySelector('#mic-button');
const cornerMic = document.querySelector('#corner-mic');
const status = document.querySelector('#visualizer-status');
const errorElement = document.querySelector('#error-message');

let history = [];
let isStreaming = false;
let voiceRepliesEnabled = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
let recognition = null;
let isListening = false;
let isSpeaking = false;
let recognizedText = '';
let inputLanguage = navigator.language.toLowerCase().startsWith('si') ? 'si-LK' : 'en-US';
let pendingMediaUrl = '';
let speechGeneration = 0;

function announce(message) {
  status.textContent = '';
  window.requestAnimationFrame(() => { status.textContent = message; });
}

function syncFaceState() {
  const state = isListening ? 'listening' : isSpeaking ? 'speaking' : isStreaming ? 'thinking' : 'idle';
  face.dataset.state = state;
  const label = pendingMediaUrl
    ? 'Open the requested YouTube search'
    : isListening ? 'Stop listening to Lumi AI' : 'Start talking to Lumi AI';
  face.setAttribute('aria-label', label);
  cornerMic.setAttribute('aria-label', isListening ? 'Stop listening to Lumi AI' : 'Start talking to Lumi AI');
  cornerMic.classList.toggle('is-listening', isListening);

  if (state === 'listening') announce('Listening. Speak now.');
  else if (state === 'speaking') announce('Lumi is speaking.');
  else if (state === 'thinking') announce('Lumi is thinking.');
  else announce('Ready. Tap the face to speak.');
}

function parseEventBlock(block) {
  const lines = block.split('\n');
  const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
  const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
  return { event, data };
}

async function streamReply(response) {
  if (!response.body) throw new Error('This browser cannot read the streaming response.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  let action = null;

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
      if (event === 'result') {
        action = JSON.parse(data).action ?? null;
      } else if (event === 'done') {
        return { answer, action };
      } else if (data) {
        const payload = JSON.parse(data);
        if (typeof payload.text === 'string') answer += payload.text;
      }
    }

    if (done) break;
  }

  return { answer, action };
}

function cleanForSpeech(text) {
  return text
    .replace(/```[\w-]*\n([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadSpeechVoices() {
  const synth = window.speechSynthesis;
  const currentVoices = synth.getVoices();
  if (currentVoices.length > 0) return Promise.resolve(currentVoices);

  return new Promise((resolve) => {
    let timer;
    const finish = () => {
      window.clearTimeout(timer);
      synth.removeEventListener('voiceschanged', finish);
      resolve(synth.getVoices());
    };
    synth.addEventListener('voiceschanged', finish, { once: true });
    timer = window.setTimeout(finish, 1200);
  });
}

async function speakReply(text, hasMediaAction) {
  if (!voiceRepliesEnabled || !('speechSynthesis' in window)
    || typeof SpeechSynthesisUtterance === 'undefined') {
    isSpeaking = false;
    if (voiceRepliesEnabled) announce('Spoken replies are unavailable in this browser.');
    syncFaceState();
    return;
  }

  const sinhala = /[\u0D80-\u0DFF]/u.test(text);
  const generation = ++speechGeneration;
  const spokenText = hasMediaAction
    ? `${cleanForSpeech(text)} ${sinhala ? 'ගීත සෙවුම විවෘත කිරීමට මගේ මුහුණ නැවත තට්ටු කරන්න.' : 'Tap my face again to open the song search.'}`
    : cleanForSpeech(text);

  try {
    window.speechSynthesis.cancel();
    const voices = await loadSpeechVoices();
    if (generation !== speechGeneration || !voiceRepliesEnabled || isListening) return;
    const preferredLanguage = sinhala ? 'si-LK' : 'en-US';
    const voice = voices.find((item) => item.lang.toLowerCase() === preferredLanguage.toLowerCase())
      ?? voices.find((item) => item.lang.toLowerCase().startsWith(sinhala ? 'si' : 'en'))
      ?? voices.find((item) => item.default)
      ?? voices[0];

    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = voice?.lang ?? preferredLanguage;
    if (voice) utterance.voice = voice;

    utterance.onstart = () => {
      isSpeaking = true;
      syncFaceState();
    };
    utterance.onend = () => {
      isSpeaking = false;
      syncFaceState();
    };
    utterance.onerror = () => {
      isSpeaking = false;
      announce('Voice playback failed. Check your browser voice settings.');
      syncFaceState();
    };
    window.speechSynthesis.speak(utterance);
  } catch {
    isSpeaking = false;
    announce('Voice playback failed. Check your browser voice settings.');
    syncFaceState();
  }
}

async function sendMessage(message) {
  if (!message || isStreaming) return;

  errorElement.hidden = true;
  pendingMediaUrl = '';
  history.push({ role: 'user', text: message });
  isStreaming = true;
  face.disabled = true;
  cornerMic.disabled = true;
  sendButton.disabled = true;
  syncFaceState();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history })
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || `Request failed (${response.status}).`);
    }

    const result = await streamReply(response);
    if (!result.answer.trim()) throw new Error('Lumi AI returned an empty reply.');
    history.push({ role: 'model', text: result.answer });

    pendingMediaUrl = result.action?.type === 'PLAY_MEDIA' && typeof result.action.query === 'string'
      ? `https://www.youtube.com/results?search_query=${encodeURIComponent(result.action.query)}`
      : '';
    speakReply(result.answer, Boolean(pendingMediaUrl));
  } catch (error) {
    history.pop();
    errorElement.textContent = error.message || 'Could not reach Lumi AI. Check your connection.';
    errorElement.hidden = false;
    if (voiceRepliesEnabled && 'speechSynthesis' in window) {
      speakReply(error.message || 'Lumi could not answer. Please try again.', false);
    } else {
      announce(error.message || 'Lumi could not answer. Tap the face to try again.');
    }
  } finally {
    isStreaming = false;
    face.disabled = false;
    cornerMic.disabled = false;
    sendButton.disabled = false;
    syncFaceState();
  }
}

function setupSpeechRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    announce('Speech input is unavailable. Use the T key to type instead.');
    return;
  }

  recognition = new Recognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = inputLanguage;
  recognition.onstart = () => {
    isListening = true;
    recognizedText = '';
    errorElement.hidden = true;
    syncFaceState();
  };
  recognition.onresult = (event) => {
    recognizedText = '';
    for (let index = 0; index < event.results.length; index += 1) {
      if (event.results[index].isFinal) recognizedText += event.results[index][0].transcript;
    }
  };
  recognition.onerror = (event) => {
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      errorElement.textContent = event.error === 'not-allowed'
        ? 'Microphone access was blocked. Allow microphone access in browser settings.'
        : 'Speech recognition stopped. Please try again.';
      errorElement.hidden = false;
      announce(errorElement.textContent);
    }
  };
  recognition.onend = () => {
    isListening = false;
    const message = recognizedText.trim();
    if (message) sendMessage(message);
    else syncFaceState();
  };
}

function toggleListening() {
  if (!recognition) {
    form.hidden = false;
    input.focus();
    return true;
  }
  if (isStreaming) return true;
  if (isListening) {
    recognition.stop();
    return true;
  }

  if ('speechSynthesis' in window) {
    speechGeneration += 1;
    window.speechSynthesis.cancel();
    isSpeaking = false;
  }
  recognition.lang = inputLanguage;
  try {
    recognition.start();
  } catch {
    errorElement.textContent = 'Microphone is already active. Wait a moment and tap the face again.';
    errorElement.hidden = false;
  }
  return true;
}

face.addEventListener('click', () => {
  if (pendingMediaUrl) {
    const url = pendingMediaUrl;
    pendingMediaUrl = '';
    window.open(url, '_blank', 'noopener,noreferrer');
    syncFaceState();
    return;
  }
  toggleListening();
});

cornerMic.addEventListener('click', () => toggleListening());

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (message) {
    input.value = '';
    form.hidden = true;
    sendMessage(message);
  }
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
});

document.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.target === input) return;
  if (event.key.toLowerCase() === 'm') {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      announce('Spoken replies are unavailable in this browser.');
      return;
    }
    voiceRepliesEnabled = !voiceRepliesEnabled;
    if (!voiceRepliesEnabled) {
      speechGeneration += 1;
      window.speechSynthesis?.cancel();
      isSpeaking = false;
    }
    announce(voiceRepliesEnabled ? 'Voice replies on.' : 'Voice replies muted.');
    syncFaceState();
  } else if (event.key.toLowerCase() === 'l') {
    if (isListening) return;
    inputLanguage = inputLanguage === 'en-US' ? 'si-LK' : 'en-US';
    if (recognition) recognition.lang = inputLanguage;
    announce(inputLanguage === 'si-LK' ? 'Sinhala input selected.' : 'English input selected.');
  } else if (event.key.toLowerCase() === 't') {
    form.hidden = false;
    input.focus();
  } else if (event.key === 'Escape') {
    if (isListening && recognition) {
      recognizedText = '';
      recognition.abort();
    }
    speechGeneration += 1;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    isSpeaking = false;
    isListening = false;
    history = [];
    pendingMediaUrl = '';
    form.hidden = true;
    input.value = '';
    errorElement.hidden = true;
    syncFaceState();
  }
});

setupSpeechRecognition();
syncFaceState();
