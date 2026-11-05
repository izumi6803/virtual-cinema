const DEFAULT_TERMS = [
  'porn',
  'pornography',
  'sex video',
  'xxx',
  '18+',
  'khiêu dâm',
  'khieu dam',
  'ấu dâm',
  'au dam',
  'cá độ',
  'ca do',
  'casino',
  'bet365',
  '1xbet',
  'ma túy',
  'ma tuy',
  'cocaine',
  'heroin',
  'bạo lực tình dục',
  'bao luc tinh duc',
  'child porn',
];

const DEFAULT_DOMAINS = [
  'pornhub.com',
  'xvideos.com',
  'xnxx.com',
  'xhamster.com',
  'onlyfans.com',
  'bet365.com',
  '1xbet.com',
];

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsTerm(text, term) {
  if (!term) return false;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(text);
}

function localTerms() {
  const custom = process.env.MODERATION_TERMS;
  const terms = custom ? custom.split(',') : DEFAULT_TERMS;
  return terms.map(normalize).filter(Boolean);
}

async function openAiCheck(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return { verdict: 'allowed', provider: 'openai', reason: `OpenAI trả lỗi ${response.status}.` };
    }
    const data = await response.json();
    const result = data.results?.[0];
    if (result?.flagged) {
      const categories = Object.entries(result.categories || {})
        .filter(([, flagged]) => flagged)
        .map(([category]) => category);
      return {
        verdict: 'flagged',
        provider: 'openai',
        reason: `OpenAI gắn cờ: ${categories.join(', ') || 'nội dung không phù hợp'}.`,
      };
    }
    return { verdict: 'allowed', provider: 'openai', reason: '' };
  } catch (error) {
    return {
      verdict: 'allowed',
      provider: 'openai',
      reason: `Không gọi được OpenAI (${error.message}); đã dùng kiểm tra local.`,
    };
  }
}

export async function moderateFilm({ name, description, src }) {
  const text = [name, description, src].filter(Boolean).join('\n');
  const normalized = normalize(text);

  const term = localTerms().find((item) => containsTerm(normalized, item));
  if (term) {
    return {
      verdict: 'flagged',
      provider: 'local',
      reason: `Tên phim hoặc mô tả chứa từ khoá nghi vấn ("${term}").`,
    };
  }

  const domain = DEFAULT_DOMAINS.find((item) => normalized.includes(item));
  if (domain) {
    return {
      verdict: 'blocked',
      provider: 'local',
      reason: `Nguồn phim thuộc tên miền bị chặn ("${domain}").`,
    };
  }

  const remote = await openAiCheck(text);
  if (remote) return remote;

  return { verdict: 'allowed', provider: 'local', reason: '' };
}

export function moderationProvider() {
  return process.env.OPENAI_API_KEY ? 'openai' : 'local';
}
