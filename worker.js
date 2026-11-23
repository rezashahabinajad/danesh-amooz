// Danesh-Amooz-Man Smart Self-Healing AI Proxy Worker (v9.9.4)
// Supports dynamic unlimited GEMINI_API_KEY*, GROQ_API_KEY*, OPENROUTER_API_KEY* secrets,
// smart 429/401 cooldowns, AbortController timeouts, live model auto-discovery,
// Vision -> Text automatic fallback, and zero-quota GET /health diagnostics.

let cachedG = 'gemini-3.8-flash';
let cachedQT = 'qwen/qwen3.8-27b';
let cachedQV = '';
let cachedOR = 'google/gemini-2.0-flash-exp:free';
const keyCooldowns = {};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-AI-No-Training, X-Client-App, X-Forwarded-AI-Key'
};

function jsonResp(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function collectEnvKeys(env, prefix) {
  if (!env || typeof env !== 'object') return [];
  const entries = [];
  for (const k of Object.keys(env)) {
    if (k === prefix || k.startsWith(prefix + '_')) {
      const val = String(env[k] || '').trim();
      if (val.length > 8) entries.push({ name: k, key: val });
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildPersianSummary(errs) {
  const joined = errs.join(' | ');
  if (/429/.test(joined) && /403|Forbidden/i.test(joined)) {
    return 'سهمیه روزانه گوگل پر شده و سرویس پشتیبان Groq نیاز به VPN دارد.';
  }
  if (/429/.test(joined) && /401|Invalid API Key/i.test(joined)) {
    return 'سهمیه روزانه گوگل پر شده و یکی از کلیدهای Groq نامعتبر است.';
  }
  if (/429/.test(joined)) {
    return 'سهمیه رایگان کلیدهای متصل موقتاً پر شده است؛ کمی بعد دوباره تلاش کنید.';
  }
  if (/401|Invalid API Key/i.test(joined)) {
    return 'کلید API ثبت‌شده در سرور واسط نامعتبر است (لطفاً کلیدها را بررسی کنید).';
  }
  if (/403|Forbidden/i.test(joined)) {
    return 'دسترسی به سرویس پشتیبان محدود است (با VPN تست کنید یا کلید Gemini اضافه کنید).';
  }
  if (/503|high demand/i.test(joined)) {
    return 'سرور هوش مصنوعی موقتاً شلوغ است؛ چند ثانیه بعد دوباره تلاش کنید.';
  }
  if (/timeout|abort/i.test(joined)) {
    return 'پاسخ‌دهی سرور هوش مصنوعی زمان‌بر شد؛ دوباره تلاش کنید.';
  }
  return 'پاسخی از سرویس‌های هوش مصنوعی دریافت نشد؛ لحظاتی بعد دوباره تلاش کنید.';
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const gKeys = collectEnvKeys(env, 'GEMINI_API_KEY');
    const qKeys = collectEnvKeys(env, 'GROQ_API_KEY');
    const oKeys = collectEnvKeys(env, 'OPENROUTER_API_KEY');
    const now = Date.now();

    if (request.method !== 'POST') {
      const activeCooldowns = Object.keys(keyCooldowns).filter(k => keyCooldowns[k] > now).length;
      return jsonResp({
        ok: true,
        service: 'danesh-ai-proxy',
        version: '9.9.4',
        geminiKeys: gKeys.length,
        groqKeys: qKeys.length,
        openRouterKeys: oKeys.length,
        activeCooldowns,
        models: {
          gemini: cachedG,
          groqText: cachedQT,
          groqVision: cachedQV || 'auto',
          openRouter: cachedOR
        }
      }, 200);
    }

    try {
      const b = await request.json().catch(() => ({}));
      const prompt = String(b.prompt || '').trim();
      const imgs = Array.isArray(b.images) ? b.images.filter(x => x && x.base64).slice(0, 1) : [];
      const temp = typeof b.temperature === 'number' ? b.temperature : 0.2;
      const errs = [];

      // 1. Gemini Pool (Supports Vision + Text, works without VPN)
      const gStart = gKeys.length ? Math.floor(Math.random() * gKeys.length) : 0;
      for (let i = 0; i < gKeys.length; i++) {
        const item = gKeys[(gStart + i) % gKeys.length];
        if (keyCooldowns[item.name] && keyCooldowns[item.name] > now) {
          errs.push(`${item.name}:429(cooldown)`);
          continue;
        }
        try {
          const parts = [];
          if (prompt) parts.push({ text: prompt });
          if (imgs.length) {
            parts.push({ inlineData: { mimeType: imgs[0].mimeType || 'image/jpeg', data: imgs[0].base64 } });
          }
          const callG = (m) => fetchWithTimeout(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': item.key },
              body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: temp } })
            },
            13000
          );

          let r = await callG(cachedG);
          let d = await r.json().catch(() => ({}));

          if (r.status === 404 || r.status === 400) {
            const lr = await fetchWithTimeout('https://generativelanguage.googleapis.com/v1beta/models', {
              headers: { 'x-goog-api-key': item.key }
            }, 7000);
            const ld = await lr.json().catch(() => ({}));
            const cand = (ld?.models || [])
              .filter(x => (x.supportedGenerationMethods || []).includes('generateContent') && /gemini.*flash/i.test(x.name || '') && !/tts|audio|image|embed/i.test(x.name || ''))
              .map(x => x.name.replace(/^models\//, ''))
              .reverse()[0];
            if (cand && cand !== cachedG) {
              cachedG = cand;
              r = await callG(cachedG);
              d = await r.json().catch(() => ({}));
            }
          }

          if (r.status === 429) keyCooldowns[item.name] = now + 600000; // 10 min cooldown
          if (r.status === 401) keyCooldowns[item.name] = now + 1800000; // 30 min cooldown

          const txt = (d?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
          if (r.ok && txt) {
            return jsonResp({ text: txt, model: cachedG, provider: 'gemini' }, 200);
          }
          errs.push(`${item.name}:${r.status}`);
        } catch (e) {
          errs.push(`${item.name}:${e?.name === 'AbortError' ? 'timeout' : 'net'}`);
        }
      }

      // 2. Groq Pool (Fast Text + Auto Vision->Text fallback)
      const qStart = qKeys.length ? Math.floor(Math.random() * qKeys.length) : 0;
      for (let i = 0; i < qKeys.length; i++) {
        const item = qKeys[(qStart + i) % qKeys.length];
        if (keyCooldowns[item.name] && keyCooldowns[item.name] > now) {
          errs.push(`${item.name}:cooldown`);
          continue;
        }
        try {
          const callQ = (m, content) => fetchWithTimeout(
            'https://api.groq.com/openai/v1/chat/completions',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${item.key}`,
                'User-Agent': 'Mozilla/5.0 DaneshAmoozMan/9.9.4'
              },
              body: JSON.stringify({ model: m, messages: [{ role: 'user', content }], temperature: temp })
            },
            12000
          );

          let useVis = Boolean(imgs.length && cachedQV);
          let curM = useVis ? cachedQV : cachedQT;
          let content = useVis
            ? [{ type: 'text', text: prompt || 'توضیح بده' }, { type: 'image_url', image_url: { url: `data:${imgs[0].mimeType || 'image/jpeg'};base64,${imgs[0].base64}` } }]
            : prompt;

          let r = await callQ(curM, content);
          let d = await r.json().catch(() => ({}));

          if (r.status === 404 || r.status === 400) {
            const lr = await fetchWithTimeout('https://api.groq.com/openai/v1/models', {
              headers: { 'Authorization': `Bearer ${item.key}`, 'User-Agent': 'Mozilla/5.0 DaneshAmoozMan/9.9.4' }
            }, 7000);
            const ld = await lr.json().catch(() => ({}));
            const ids = (ld?.data || []).map(x => x.id).filter(id => id && !/whisper|tts|guard|embed/i.test(id));
            const visM = imgs.length ? ids.find(id => /vision|llama-4|scout|maverick/i.test(id)) : '';
            const txtM = ids.find(id => /qwen|llama-3\.3|deepseek|llama-3\.1|gpt-oss/i.test(id)) || ids[0];
            if (visM) {
              cachedQV = visM;
              curM = visM;
              content = [{ type: 'text', text: prompt || 'توضیح بده' }, { type: 'image_url', image_url: { url: `data:${imgs[0].mimeType || 'image/jpeg'};base64,${imgs[0].base64}` } }];
            } else if (txtM) {
              cachedQT = txtM;
              curM = txtM;
              content = prompt;
            }
            r = await callQ(curM, content);
            d = await r.json().catch(() => ({}));
          }

          if (r.status === 429) keyCooldowns[item.name] = now + 300000;
          if (r.status === 401) keyCooldowns[item.name] = now + 1800000;

          const txt = String(d?.choices?.[0]?.message?.content || '').trim();
          if (r.ok && txt) {
            return jsonResp({ text: txt, model: `groq/${curM}`, provider: 'groq' }, 200);
          }
          errs.push(`${item.name}:${r.status} ${d?.error?.message || ''}`.trim());
        } catch (e) {
          errs.push(`${item.name}:${e?.name === 'AbortError' ? 'timeout' : 'net'}`);
        }
      }

      // 3. Optional OpenRouter Pool (if user adds OPENROUTER_API_KEY*)
      for (let i = 0; i < oKeys.length; i++) {
        const item = oKeys[i];
        if (keyCooldowns[item.name] && keyCooldowns[item.name] > now) continue;
        try {
          const r = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${item.key}`,
              'HTTP-Referer': 'https://danesh-amooz-man.github.io',
              'X-Title': 'DaneshAmoozMan'
            },
            body: JSON.stringify({ model: cachedOR, messages: [{ role: 'user', content: prompt }], temperature: temp })
          }, 12000);
          const d = await r.json().catch(() => ({}));
          if (r.status === 429) keyCooldowns[item.name] = now + 300000;
          if (r.status === 401) keyCooldowns[item.name] = now + 1800000;
          const txt = String(d?.choices?.[0]?.message?.content || '').trim();
          if (r.ok && txt) {
            return jsonResp({ text: txt, model: `openrouter/${cachedOR}`, provider: 'openrouter' }, 200);
          }
          errs.push(`${item.name}:${r.status}`);
        } catch (e) {
          errs.push(`${item.name}:net`);
        }
      }

      return jsonResp({
        error: errs.join(' | ') || 'No API keys configured',
        faError: buildPersianSummary(errs),
        details: errs
      }, 503);
    } catch (e) {
      return jsonResp({
        error: String(e?.message || e),
        faError: 'خطای داخلی سرور واسط؛ لطفاً چند لحظه بعد دوباره تلاش کنید.'
      }, 500);
    }
  }
};
