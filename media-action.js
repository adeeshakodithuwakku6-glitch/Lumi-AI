export function getMediaAction(text) {
  const commandPrefix = /^\s*(?:(?:please|can you|could you|would you)\s+)*/i;
  const englishRequest = text.match(/^\s*(?:(?:please|can you|could you|would you)\s+)*(?:play|put on|listen to)\s+(.+?)\s*[.!?]*\s*$/i);
  const openMediaRequest = text.match(/^\s*(?:(?:please|can you|could you|would you)\s+)*(?:open|search for)\s+(?:(?:the|some)\s+)?(?:media|music|youtube|video|song|track)(?:\s+(?:for|search)\s+(.+?))?\s*[.!?]*\s*$/i);
  const sinhalaRequest = /(?:සින්දු|සින්දුව|ගීත|ගීයක්|සංගීත)/u.test(text)
    && /(?:අහන්න|අහමු|දමන්න|දෙන්න|කරන්න|play|ahanna|ahamu|karanna|danna)/iu.test(text);
  const singlishRequest = /\b(?:sindu|sinduwak|geethayak|song|music)\b/i.test(text)
    && /\b(?:play|ahanna|ahamu|karanna|danna|listen)\b/i.test(text);

  if (!englishRequest && !openMediaRequest && !sinhalaRequest && !singlishRequest) return null;

  let query = englishRequest?.[1] ?? (openMediaRequest ? openMediaRequest[1] ?? '' : text.replace(commandPrefix, ''));
  query = query
    .replace(/^(?:(?:a|an|the|some|song|music|track)\s+)+/i, '')
    .replace(/^(?:සින්දුවක්|සින්දුව|සින්දු|ගීතයක්|ගීත|සංගීතය|sinduwak|sindu|geethayak|song|music|track)(?:\s+ekak)?\s*/iu, '')
    .replace(/\s*(?:play\s*(?:කරන්න|karanna)?|please|for me|කරන්න|දෙන්න|දමන්න|අහන්න|අහමු|karanna|ahanna|ahamu|danna|listen)\s*$/iu, '')
    .trim();

  if (!query || /^(?:song|music|track|something|a song|some music|media|youtube|video)$/i.test(query)) {
    query = /[\u0D80-\u0DFF]/u.test(text) ? 'සිංහල ගීත' : 'songs';
  }

  return { type: 'PLAY_MEDIA', query: query.slice(0, 200) };
}
