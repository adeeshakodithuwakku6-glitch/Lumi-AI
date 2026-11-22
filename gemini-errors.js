export function getGeminiErrorInfo(error) {
  const queue = [error];
  const visited = new Set();
  const messages = [];
  const codes = [];
  const statuses = [];

  while (queue.length > 0 && visited.size < 12) {
    const item = queue.shift();
    if (item === null || item === undefined) continue;

    if (typeof item === 'string') {
      messages.push(item);
      try {
        const parsed = JSON.parse(item);
        if (parsed && typeof parsed === 'object') queue.push(parsed);
      } catch {
        // Plain error text is expected here.
      }
      continue;
    }

    if (typeof item !== 'object' || visited.has(item)) continue;
    visited.add(item);
    statuses.push(item.status);
    codes.push(item.code);
    queue.push(item.message, item.error, item.cause);
    for (const [key, value] of Object.entries(item)) {
      if (key !== 'status' && key !== 'code' && key !== 'message' && key !== 'error' && key !== 'cause') {
        queue.push(value);
      }
    }
  }

  const status = statuses.map(Number).find(Number.isFinite)
    ?? codes.map(Number).find(Number.isFinite)
    ?? Number(messages.join(' ').match(/\b(?:HTTP\s*)?(50[234]|429|40[13]|404)\b/i)?.[1]);
  const detail = [...messages, ...codes.map(String)].join(' ');
  const providerCode = [...codes, ...statuses].find((value) => (
    typeof value === 'string'
    && !/^\d+$/.test(value)
    && value.toLowerCase() !== 'unknown'
  ));

  let kind = 'other';
  if (status === 429 || /rate.?limit|quota|resource_exhausted/i.test(detail)) {
    kind = 'rate_limit';
  } else if (status === 401 || status === 403 || /unauthenticated|permission_denied|api.?key/i.test(detail)) {
    kind = 'access';
  } else if (status === 404 || /model.*not found|model.*unsupported/i.test(detail)) {
    kind = 'model';
  } else if (status === 503 || /high demand|unavailable|service.?unavailable/i.test(detail)) {
    kind = 'unavailable';
  } else if (/fetch failed|econnreset|econnrefused|etimedout|enotfound|network/i.test(detail)) {
    kind = 'network';
  }

  const code = providerCode ?? (kind === 'network' ? 'NETWORK_ERROR' : kind === 'unavailable' ? 'UNAVAILABLE' : 'unknown');

  return {
    status: Number.isFinite(status) ? status : undefined,
    code,
    kind,
    retryable: kind === 'unavailable' || kind === 'network' || status === 502 || status === 504,
    detail
  };
}

export async function getFirstStreamChunkWithRetry(ai, request, fallbackModel) {
  const models = [request.model];
  if (fallbackModel && fallbackModel !== request.model) models.push(fallbackModel);

  for (const [modelIndex, model] of models.entries()) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const stream = await ai.models.generateContentStream({ ...request, model });
        const iterator = stream[Symbol.asyncIterator]();
        const firstChunk = await iterator.next();
        return { iterator, firstChunk, model };
      } catch (error) {
        const info = getGeminiErrorInfo(error);
        const canRetry = attempt === 1 && info.retryable;
        const canFallback = modelIndex === 0 && models.length > 1 && info.kind === 'unavailable';
        if (canRetry) {
          console.warn(`Gemini temporarily unavailable (${info.code}); retrying once before streaming.`);
          await new Promise((resolve) => setTimeout(resolve, 800));
          continue;
        }
        if (canFallback) {
          console.warn(`Gemini model ${model} remains unavailable; trying fallback model ${fallbackModel}.`);
          break;
        }
        throw error;
      }
    }
  }

  throw new Error('Gemini stream did not start.');
}

export function getGeminiUserMessage(kind, model) {
  if (kind === 'rate_limit') {
    return 'Gemini is receiving too many requests right now. Please wait a moment and try again.';
  }
  if (kind === 'access') {
    return 'Gemini rejected the API key or access. Check that the key is active and Gemini API access is enabled for its project.';
  }
  if (kind === 'model') {
    return `The configured Gemini model (${model}) is unavailable to this API key. Check GEMINI_MODEL and the models enabled for your project.`;
  }
  if (kind === 'unavailable') {
    return 'Gemini is temporarily busy with high demand. Please wait a moment and try again.';
  }
  if (kind === 'network') {
    return 'Lumi could not reach Gemini. Check your internet connection and try again.';
  }
  return 'Lumi AI could not complete that request. Please try again in a moment.';
}
