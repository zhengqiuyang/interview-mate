/* LLM API 层：流式对话 + 健康检查 */
import { S } from './state.js';

export const hasKey = () => Boolean(S.settings.apiKey) || S.serverKey;

/**
 * 调用 /api/chat 并以回调逐段返回文本。
 * 服务端透传 SSE 原文，这里解析出 delta.content。
 */
export async function streamChat(payload, onDelta, signal) {
  const cfg = S.settings;
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      apiKey: cfg.apiKey || undefined,
      baseURL: cfg.baseURL || undefined,
      model: cfg.model || undefined,
      temperature: typeof cfg.temperature === 'number' ? cfg.temperature : undefined,
    }),
    signal,
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch (_) { /* ignore */ }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n');
    buf = parts.pop();
    for (const lineRaw of parts) {
      const line = lineRaw.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        const delta = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? '';
        if (delta) onDelta(delta);
      } catch (_) { /* 半包或非 JSON 行，忽略 */ }
    }
  }
}

export async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    const j = await res.json();
    S.serverKey = Boolean(j.serverKeyConfigured);
    return j;
  } catch (_) {
    return null;
  }
}

export async function loadBank() {
  const res = await fetch('/api/questions');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
