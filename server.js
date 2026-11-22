import dotenv from 'dotenv';
import cors from 'cors';
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);
dotenv.config({ path: path.join(currentDirectory, '.env') });

const app = express();
const port = Number(process.env.PORT) || 3000;
const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
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
- Format responses cleanly with Markdown, including headings, lists, and fenced code blocks where useful.`;

app.use(cors({ origin: process.env.CORS_ORIGIN || false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(currentDirectory, 'public')));

app.get('/api/health', (_request, response) => {
  response.json({
    status: 'ok',
    model,
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
    const stream = await ai.models.generateContentStream({
      model,
      contents: history,
      config: { systemInstruction }
    });

    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        response.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    response.write('event: done\ndata: {}\n\n');
    response.end();
  } catch (error) {
    const status = Number(error?.status ?? error?.code);
    const errorDetails = `${error?.code ?? ''} ${error?.message ?? ''}`;
    const isRateLimited = status === 429 || /429|rate.?limit|quota|resource_exhausted/i.test(errorDetails);
    const isAccessError = status === 401 || status === 403 || /unauthenticated|permission_denied|api.?key/i.test(errorDetails);
    const isModelError = status === 404 || /model.*not found|model.*unsupported/i.test(errorDetails);
    let message = 'Lumi AI could not complete that request. Please try again in a moment.';
    if (isRateLimited) {
      message = 'Lumi AI is getting lots of requests right now. Please wait a moment and try again.';
    } else if (isAccessError) {
      message = 'Gemini rejected the API key or access. Check that the key is active and Gemini API access is enabled for its project.';
    } else if (isModelError) {
      message = `The configured Gemini model (${model}) is unavailable to this API key. Check GEMINI_MODEL and the models enabled for your project.`;
    }

    const errorCode = typeof error?.code === 'string' && /^[a-z0-9_-]{1,48}$/i.test(error.code)
      ? error.code
      : 'unknown';
    const statusLabel = Number.isFinite(status) ? status : 'unknown';
    const safeDetails = String(error?.message ?? 'No additional error details.')
      .split(apiKey).join('[redacted]')
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 240);
    console.error(`Gemini request failed (HTTP ${statusLabel}; ${errorCode}): ${safeDetails}`);

    if (message === 'Lumi AI could not complete that request. Please try again in a moment.') {
      message = `Gemini request failed (HTTP ${statusLabel}; ${errorCode}). Check the server terminal for details.`;
    }

    if (response.headersSent) {
      response.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
      response.end();
      return;
    }

    response.status(isRateLimited ? 429 : 502).json({ error: message });
  }
});

app.listen(port, () => {
  console.log(`Lumi AI is ready at http://localhost:${port}`);
});
