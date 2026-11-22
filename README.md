# Lumi AI

A responsive Sinhala and English AI chat app powered by the Google Gemini API. The browser talks to an Express server; your API key stays in the server-side `.env` file.

## Setup

1. Install Node.js 20 or newer.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env` in the project root and add your Gemini API key:

   ```env
   GEMINI_API_KEY=your_api_key
   GEMINI_MODEL=gemini-3.8-flash
   PORT=3000
   ```

4. Start Lumi AI with `npm start` and open [http://localhost:3000](http://localhost:3000).

The selected model can be changed with `GEMINI_MODEL` if it is unavailable for your API account. Chat history is kept in the current browser session and the server uses at most the latest 20 messages per request. Set `CORS_ORIGIN` only if a separate frontend origin needs API access; same-origin hosting works without it.
