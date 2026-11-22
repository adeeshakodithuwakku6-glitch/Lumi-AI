# Lumi AI

A responsive Sinhala and English AI chat app powered by the Google Gemini API. The browser talks to an Express server; your API key stays in the server-side `.env` file.

The interface shows only Lumi's animated face. Tap it to talk; Lumi speaks replies aloud. A text box is available when needed. Music requests return a YouTube search link and never autoplay media.

## Setup

1. Install Node.js 20 or newer.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env` in the project root and add your Gemini API key:

   ```env
   GEMINI_API_KEY=your_api_key
   GEMINI_MODEL=gemini-3.8-flash
   GEMINI_FALLBACK_MODEL=gemini-3.6-flash
   PORT=3000
   ```

4. Start Lumi AI with `npm run dev` (auto-restarts during development) or `npm start`, then open [http://localhost:3000](http://localhost:3000).

## Voice and media

- **Microphone:** Open the site on `localhost` or HTTPS, allow microphone access, then click the mic at the bottom-right corner (or tap Lumi's face) and speak. Your recognized speech is sent when you finish. Speech Recognition is browser-dependent (best supported in Chrome/Edge).
- **Language:** Input defaults to the browser's language. Press **L** to switch between English and Sinhala.
- **Voice:** Spoken replies are on by default. Press **M** to mute or unmute; available system voices are used, with Sinhala selected when the reply contains Sinhala text.
- **Text fallback:** Press **T** to type if speech input is unavailable.
- **New conversation:** Press **Escape**.
- **Play a song:** Ask, for example, “Play Shape of You”, `සින්දුවක් play කරන්න`, or `sindu ekak play karanna`. After Lumi replies, tap the face again to open the YouTube search.

Run focused tests with `npm test`. If Gemini returns a temporary high-demand error for `GEMINI_MODEL`, Lumi retries once and then tries `GEMINI_FALLBACK_MODEL`. Both model settings can be changed for models enabled on your API account. Chat history is kept in the current browser session and the server uses at most the latest 20 messages per request. Set `CORS_ORIGIN` only if a separate frontend origin needs API access; same-origin hosting works without it.
