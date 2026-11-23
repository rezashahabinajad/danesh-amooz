// Danesh-Amooz-Man Two-Stage Smart Iranian Textbook AI Proxy Worker (v9.9.8)
// Pipeline:
//   1. Primary: Gemini Pool (Native Vision + Deep Persian Textbook Reasoning, VPN-free)
//   2. Fallback for Images:
//      - Stage 2A (Fast OCR-only): Cloudflare Vision (@cf/meta/llama-3.2-11b-vision-instruct, max_tokens: 450)
//        ONLY transcribes exact Persian titles, boxes & numbered questions (does NOT hallucinate answers).
//      - Stage 2B (Deep 70B Textbook Solver): Groq (qwen3.8-27b / llama-3.3-70b) or Cloudflare 70B
//        (@cf/meta/llama-3.3-70b-instruct-fp8-fast, 100% VPN-free) solves strictly per Iranian school textbooks
//        and outputs clean structured JSON.

let cachedG = 'gemini-3.8-flash';
let cachedQT = 'qwen/qwen3.8-27b';
let cachedOR = 'google/gemini-2.0-flash-exp:free';
let cfVisionAgreed = false;
let groqRegionBlockedUntil = 0;
const keyCooldowns = {};

const CF_VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const CF_TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const CF_TEXT_LITE = '@cf/meta/llama-3.1-8b-instruct';

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

function stripThinkTags(raw) {
  return String(raw || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*<\/think>\s*/i, '')
    .replace(/کالس/g, 'کلاس')
    .trim();
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

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1500, timeoutMs));
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractCfAiText(res) {
  if (!res) return '';
  if (typeof res === 'string') return stripThinkTags(res);
  const cand = res.response ?? res.result ?? res.text ?? res?.choices?.[0]?.message?.content ?? '';
  return typeof cand === 'string' ? stripThinkTags(cand) : '';
}

async function extractPageQuestionsViaCfVision(env, imgObj) {
  if (!env?.AI || typeof env.AI.run !== 'function' || !imgObj?.base64) return '';
  const dataUri = `data:${imgObj.mimeType || 'image/jpeg'};base64,${imgObj.base64}`;
  const messages = [
    {
      role: 'system',
      content: 'تو فقط یک دستگاه دقیق تایپ و استخراج متن (OCR) از تصویر کتاب درسی فارسی هستی. هرگز به سؤالات پاسخ نده! فقط عین متن فارسی، تیتر کادرها (مثل «خودت را امتحان کن»، «فعالیت»، «کار در کلاس»، «پیشنهاد») و شماره سؤالات داخل تصویر را دقیق و مرتب تایپ کن.'
    },
    {
      role: 'user',
      content: 'فقط عین متن و سؤالات موجود در این تصویر صفحه کتاب درسی را با حفظ عنوان هر کادر و شماره هر سؤال به فارسی دقیق استخراج کن (پاسخ ننویس).'
    }
  ];
  try {
    const out = await env.AI.run(CF_VISION_MODEL, { messages, image: dataUri, max_tokens: 450 });
    cfVisionAgreed = true;
    return extractCfAiText(out);
  } catch (err) {
    const msg = String(err?.message || err || '');
    if (!cfVisionAgreed && /agree|license|5016|accept/i.test(msg)) {
      try {
        await env.AI.run(CF_VISION_MODEL, { prompt: 'agree' });
        cfVisionAgreed = true;
        const retryOut = await env.AI.run(CF_VISION_MODEL, { messages, image: dataUri, max_tokens: 450 });
        return extractCfAiText(retryOut);
      } catch (_) {}
    }
    throw err;
  }
}

async function runCfTextSolver(env, promptText) {
  if (!env?.AI || typeof env.AI.run !== 'function') return { text: '', model: '' };
  const messages = [
    {
      role: 'system',
      content: 'تو دبیر رسمی و متخصص کتاب‌های درسی آموزش و پرورش ایران هستی. پاسخ هر پرسش را دقیقاً مطابق متن، مفاهیم و کلیدواژه‌های کتاب درسی رسمی ایران بنویس. هرگز متن یک کادر دیگر صفحه (مثل کادر «پیشنهاد») را به اشتباه به‌عنوان جواب سؤال قبلی کپی نکن! اگر قالب JSON خواسته شده، فقط JSON معتبر بدون علامت‌های ستاره (**) برگردان.'
    },
    { role: 'user', content: promptText }
  ];
  for (const mdl of [CF_TEXT_MODEL, CF_TEXT_LITE]) {
    try {
      const out = await env.AI.run(mdl, { messages, max_tokens: 1500 });
      const txt = extractCfAiText(out);
      if (txt) return { text: txt, model: `cf/${mdl.split('/').pop()}` };
    } catch (_) {}
  }
  return { text: '', model: '' };
}

function buildPersianSummary(errs) {
  const joined = errs.join(' | ');
  if (/429/.test(joined) && /403|Forbidden/i.test(joined)) {
    return 'سهمیه روزانه گوگل پر شده و سرویس Groq نیاز به VPN دارد.';
  }
  if (/429/.test(joined)) {
    return 'سهمیه رایگان کلیدهای متصل موقتاً پر شده است؛ کمی بعد دوباره تلاش کنید.';
  }
  if (/401|Invalid API Key/i.test(joined)) {
    return 'کلید API ثبت‌شده در سرور واسط نامعتبر است.';
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
    const hasCfAi = Boolean(env?.AI && typeof env.AI.run === 'function');
    const now = Date.now();

    if (request.method !== 'POST') {
      const activeCooldowns = Object.keys(keyCooldowns).filter(k => keyCooldowns[k] > now).length;
      return jsonResp({
        ok: true,
        service: 'danesh-ai-proxy',
        version: '9.9.8',
        geminiKeys: gKeys.length,
        groqKeys: qKeys.length,
        openRouterKeys: oKeys.length,
        workersAiBound: hasCfAi,
        activeCooldowns,
        models: {
          gemini: cachedG,
          groqText: cachedQT,
          cfVision: hasCfAi ? CF_VISION_MODEL : 'disabled',
          cfText: hasCfAi ? CF_TEXT_MODEL : 'disabled'
        }
      }, 200);
    }

    const deadline = now + 45000;
    const timeLeft = () => Math.max(0, deadline - Date.now());

    try {
      const b = await request.json().catch(() => ({}));
      const prompt = String(b.prompt || '').trim();
      const imgs = Array.isArray(b.images) ? b.images.filter(x => x && x.base64).slice(0, 1) : [];
      const temp = typeof b.temperature === 'number' ? b.temperature : 0.2;
      const errs = [];

      // 1. Primary: Gemini Pool
      const gStart = gKeys.length ? Math.floor(Math.random() * gKeys.length) : 0;
      for (let i = 0; i < gKeys.length && timeLeft() > 10000; i++) {
        const item = gKeys[(gStart + i) % gKeys.length];
        if (keyCooldowns[item.name] && keyCooldowns[item.name] > Date.now()) {
          errs.push(`${item.name}:cooldown`);
          continue;
        }
        try {
          const parts = [];
          if (prompt) parts.push({ text: prompt });
          if (imgs.length) {
            parts.push({ inlineData: { mimeType: imgs[0].mimeType || 'image/jpeg', data: imgs[0].base64 } });
          }
          const callG = (m, tMs) => fetchWithTimeout(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': item.key },
              body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: temp } })
            },
            Math.min(tMs, timeLeft() - 2000)
          );

          let r = await callG(cachedG, 9000);
          let d = await r.json().catch(() => ({}));

          if ((r.status === 404 || r.status === 400) && timeLeft() > 9000) {
            const lr = await fetchWithTimeout('https://generativelanguage.googleapis.com/v1beta/models', {
              headers: { 'x-goog-api-key': item.key }
            }, 4500);
            const ld = await lr.json().catch(() => ({}));
            const cand = (ld?.models || [])
              .filter(x => (x.supportedGenerationMethods || []).includes('generateContent') && /gemini.*flash/i.test(x.name || '') && !/tts|audio|image|embed/i.test(x.name || ''))
              .map(x => x.name.replace(/^models\//, ''))
              .reverse()[0];
            if (cand && cand !== cachedG) {
              cachedG = cand;
              r = await callG(cachedG, 8000);
              d = await r.json().catch(() => ({}));
            }
          }

          if (r.status === 429) keyCooldowns[item.name] = Date.now() + 600000;
          else if (r.status === 503) keyCooldowns[item.name] = Date.now() + 45000;
          else if (r.status === 401) keyCooldowns[item.name] = Date.now() + 1800000;

          const txt = stripThinkTags((d?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(''));
          if (r.ok && txt) {
            return jsonResp({ text: txt, model: cachedG, provider: 'gemini' }, 200);
          }
          errs.push(`${item.name}:${r.status}`);
        } catch (e) {
          errs.push(`${item.name}:${e?.name === 'AbortError' ? 'timeout' : 'net'}`);
        }
      }

      // 2A. Fast OCR-only extraction on Cloudflare 11B Vision
      let ocrExtracted = '';
      if (imgs.length && hasCfAi && timeLeft() > 10000) {
        try {
          ocrExtracted = await extractPageQuestionsViaCfVision(env, imgs[0]);
        } catch (cfErr) {
          errs.push(`CF_OCR:${String(cfErr?.message || 'err').slice(0, 40)}`);
        }
      }

      const solverPrompt = ocrExtracted
        ? `${prompt}\n\n=== متن و سؤالات دقیق استخراج‌شده از تصویر همین صفحه ===\n${ocrExtracted}\n\nهشدار مهم آموزشی: هرگز متن کادرهای دیگر صفحه (مثل کادر «پیشنهاد») را به‌جای جواب سؤالات «خودت را امتحان کن» یا «فعالیت» کپی نکن! پاسخ هر سؤال را دقیقاً بر اساس مفاهیم علمی کتاب درسی رسمی آموزش و پرورش ایران بنویس و حتماً در قالب JSON استاندارد خواسته‌شده برگردان.`
        : prompt;

      // 2B. Deep Reasoning Solver #1: Groq Pool (Qwen3 / Llama 3.3 70B)
      if (qKeys.length && groqRegionBlockedUntil <= Date.now() && timeLeft() > 6000) {
        const qStart = Math.floor(Math.random() * qKeys.length);
        for (let i = 0; i < qKeys.length && timeLeft() > 5000; i++) {
          const item = qKeys[(qStart + i) % qKeys.length];
          if (keyCooldowns[item.name] && keyCooldowns[item.name] > Date.now()) {
            errs.push(`${item.name}:cooldown`);
            continue;
          }
          try {
            const callQ = (m, tMs) => fetchWithTimeout(
              'https://api.groq.com/openai/v1/chat/completions',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${item.key}`,
                  'User-Agent': 'Mozilla/5.0 DaneshAmoozMan/9.9.8'
                },
                body: JSON.stringify({ model: m, messages: [{ role: 'user', content: solverPrompt }], temperature: temp })
              },
              Math.min(tMs, timeLeft() - 1000)
            );

            let r = await callQ(cachedQT, 9000);
            let d = await r.json().catch(() => ({}));

            if ((r.status === 404 || r.status === 400) && timeLeft() > 6000) {
              const lr = await fetchWithTimeout('https://api.groq.com/openai/v1/models', {
                headers: { 'Authorization': `Bearer ${item.key}`, 'User-Agent': 'Mozilla/5.0 DaneshAmoozMan/9.9.8' }
              }, 4000);
              const ld = await lr.json().catch(() => ({}));
              const ids = (ld?.data || []).map(x => x.id).filter(id => id && !/whisper|tts|guard|embed/i.test(id));
              const txtM = ids.find(id => /qwen|llama-3\.3|deepseek|llama-3\.1|gpt-oss/i.test(id)) || ids[0];
              if (txtM) {
                cachedQT = txtM;
                r = await callQ(cachedQT, 8000);
                d = await r.json().catch(() => ({}));
              }
            }

            if (r.status === 403) {
              groqRegionBlockedUntil = Date.now() + 120000;
              errs.push(`${item.name}:403`);
              break;
            }
            if (r.status === 429) keyCooldowns[item.name] = Date.now() + 300000;
            if (r.status === 401) keyCooldowns[item.name] = Date.now() + 1800000;

            const txt = stripThinkTags(d?.choices?.[0]?.message?.content || '');
            if (r.ok && txt) {
              const mdlName = ocrExtracted ? `cf-ocr+groq/${cachedQT}` : `groq/${cachedQT}`;
              return jsonResp({ text: txt, model: mdlName, provider: 'groq' }, 200);
            }
            errs.push(`${item.name}:${r.status}`);
          } catch (e) {
            errs.push(`${item.name}:${e?.name === 'AbortError' ? 'timeout' : 'net'}`);
          }
        }
      }

      // 2C. Deep Reasoning Solver #2: Cloudflare 70B Text Solver (100% VPN-Free!)
      if (hasCfAi && timeLeft() > 4000) {
        try {
          const cfRes = await runCfTextSolver(env, solverPrompt);
          if (cfRes.text) {
            const mdlName = ocrExtracted ? `cf-ocr+${cfRes.model}` : cfRes.model;
            return jsonResp({ text: cfRes.text, model: mdlName, provider: 'cloudflare_ai' }, 200);
          }
        } catch (cfTxtErr) {
          errs.push(`CF_70B:${String(cfTxtErr?.message || 'err').slice(0, 40)}`);
        }
      }

      // 3. Optional OpenRouter Pool
      for (let i = 0; i < oKeys.length && timeLeft() > 4000; i++) {
        const item = oKeys[i];
        if (keyCooldowns[item.name] && keyCooldowns[item.name] > Date.now()) continue;
        try {
          const r = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${item.key}`,
              'HTTP-Referer': 'https://danesh-amooz-man.github.io',
              'X-Title': 'DaneshAmoozMan'
            },
            body: JSON.stringify({ model: cachedOR, messages: [{ role: 'user', content: solverPrompt }], temperature: temp })
          }, Math.min(8000, timeLeft() - 500));
          const d = await r.json().catch(() => ({}));
          if (r.status === 429) keyCooldowns[item.name] = Date.now() + 300000;
          if (r.status === 401) keyCooldowns[item.name] = Date.now() + 1800000;
          const txt = stripThinkTags(d?.choices?.[0]?.message?.content || '');
          if (r.ok && txt) {
            return jsonResp({ text: txt, model: `openrouter/${cachedOR}`, provider: 'openrouter' }, 200);
          }
          errs.push(`${item.name}:${r.status}`);
        } catch (e) {
          errs.push(`${item.name}:net`);
        }
      }

      return jsonResp({
        error: errs.join(' | ') || 'No AI provider available',
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
