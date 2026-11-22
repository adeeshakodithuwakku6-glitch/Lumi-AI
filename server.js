import dotenv from 'dotenv';
import cors from 'cors';
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMediaAction } from './media-action.js';
import {
  getFirstStreamChunkWithRetry,
  getGeminiErrorInfo,
  getGeminiUserMessage
} from './gemini-errors.js';

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);
dotenv.config({ path: path.join(currentDirectory, '.env') });

const app = express();
const port = Number(process.env.PORT) || 3000;
const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.6-flash';
const apiKey = process.env.GEMINI_API_KEY;
const historyLimit = 20;
const messageLimit = 12_000;
const systemInstruction = `You are Lumi AI, a friendly, helpful, clear, and approachable everyday AI companion.

Language and style:
- Automatically detect the language the user uses.
- If the user writes in Sinhala or clear Singlish (Sinhala expressed with Latin letters), reply in natural, clear Sinhala. Keep standard technical and programming terms in English when helpful.
- If the user writes in English, reply in clear, well-structured English.
- If a message genuinely mixes languages, follow the language used most; preserve the user's intent.
- If asked who you are, introduce yourself as Lumi AI.
- If the user asks to play music or a song, briefly confirm in their language that you can open a YouTube search result. Do not claim playback has started.
- Format responses cleanly with Markdown, including headings, lists, and fenced code blocks where useful.`;

app.use(cors({ origin: process.env.CORS_ORIGIN || false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(currentDirectory, 'public')));

app.get('/api/health', (_request, response) => {
  response.json({
    status: 'ok',
    model,
    fallbackModel,
    apiKeyConfigured: Boolean(apiKey)
  });
});

app.post('/api/chat', async (request, response) => {
  if (!apiKey) {
    response.status(503).json({
      error: 'Lumi AI is not configured yet. Add GEMINI_API_KEY to your .env file and restart the server.'
    });
    return;
  }

  const { messages } = request.body ?? {};
  if (!Array.isArray(messages)) {
    response.status(400).json({ error: 'Send conversation history as a messages array.' });
    return;
  }

  const history = messages
    .slice(-historyLimit)
    .filter((message) => (
      message
      && (message.role === 'user' || message.role === 'model')
      && typeof message.text === 'string'
      && message.text.trim().length > 0
      && message.text.length <= messageLimit
    ))
    .map((message) => ({
      role: message.role,
      parts: [{ text: message.text }]
    }));

  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    response.status(400).json({ error: 'Add a message before asking Lumi AI.' });
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const mediaAction = getMediaAction(history[history.length - 1].parts[0].text);
    const streamRequest = {
      model,
      contents: history,
      config: { systemInstruction }
    };
    const { iterator, firstChunk, model: servingModel } = await getFirstStreamChunkWithRetry(ai, streamRequest, fallbackModel);
    if (servingModel !== model) console.info(`Gemini is serving this reply with fallback model ${servingModel}.`);

    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();

    const sendChunk = (chunk) => {
      const text = chunk.text;
      if (text) {
        response.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    };

    if (!firstChunk.done) sendChunk(firstChunk.value);
    while (true) {
      const { value, done } = await iterator.next();
      if (done) break;
      sendChunk(value);
    }

    if (mediaAction) {
      response.write(`event: result\ndata: ${JSON.stringify({ action: mediaAction })}\n\n`);
    }
    response.write('event: done\ndata: {}\n\n');
    response.end();
  } catch (error) {
    const info = getGeminiErrorInfo(error);
    const message = getGeminiUserMessage(info.kind, model);
    const errorCode = /^[a-z0-9_-]{1,48}$/i.test(info.code) ? info.code : 'unknown';
    const statusLabel = Number.isFinite(info.status) ? info.status : 'unknown';
    const safeDetails = String(error?.message ?? 'No additional error details.')
      .split(apiKey).join('[redacted]')
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 240);
    console.error(`Gemini request failed (HTTP ${statusLabel}; ${errorCode}): ${safeDetails}`);

    if (response.headersSent) {
      response.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
      response.end();
      return;
    }

    const responseStatus = info.kind === 'rate_limit'
      ? 429
      : info.kind === 'unavailable'
        ? 503
        : info.kind === 'access'
          ? info.status ?? 502
          : info.kind === 'model'
            ? 502
            : info.kind === 'network'
              ? 503
              : 502;
    response.status(responseStatus).json({ error: message });
  }
});

app.listen(port, () => {
  console.log(`Lumi AI is ready at http://localhost:${port}`);
});
