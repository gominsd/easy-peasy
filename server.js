'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// 여러 모델을 쉼표로 적으면 앞에서부터 시도하고, 한도(429) 초과 시 다음 모델로 자동 폴백
const GEMINI_MODELS = (process.env.GEMINI_MODEL ||
  'gemini-2.5-flash-lite,gemini-2.5-flash,gemini-2.0-flash')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

// 같은 낱말+난이도 결과를 잠시 저장해 두어 무료 한도를 아낌 (서버 재시작 시 초기화)
const explainCache = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 난이도 단계 정의 (프론트엔드와 공유)
const LEVELS = {
  1: {
    label: '초등학교 1~2학년',
    guide:
      '아주 어린 아이도 알아들을 수 있게 설명해 주세요. 매우 쉬운 낱말만 쓰고, ' +
      '한 문장은 짧게(15자 안팎) 만들어 주세요. 어려운 한자어나 전문 용어는 절대 쓰지 말고, ' +
      '아이가 일상에서 자주 보는 것에 빗대어(비유) 친근한 말투로 설명해 주세요.',
  },
  2: {
    label: '초등학교 3~4학년',
    guide:
      '초등학교 3~4학년이 이해할 수 있게 설명해 주세요. 쉬운 낱말을 위주로 쓰되, ' +
      '꼭 필요한 낱말이 어려우면 그 자리에서 풀어서 알려 주세요. ' +
      '구체적인 예시를 하나 들어 주면 좋아요.',
  },
  3: {
    label: '초등학교 5~6학년',
    guide:
      '초등학교 5~6학년이 이해할 수 있게 설명해 주세요. 조금 더 자세하고 정확하게 설명해도 좋지만, ' +
      '여전히 어려운 전문 용어는 풀어서 알려 주세요. 왜 그런지 이유나 배경을 한두 가지 덧붙여 주세요.',
  },
};

// ---- 네이버 백과사전 검색 ----
async function searchNaverEncyc(query) {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    throw new Error('네이버 API 키가 설정되지 않았습니다. .env 파일을 확인하세요.');
  }
  const url =
    'https://openapi.naver.com/v1/search/encyc.json?display=3&query=' +
    encodeURIComponent(query);

  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`네이버 검색 실패 (${res.status}): ${body}`);
  }

  const data = await res.json();
  const items = (data.items || []).map((it) => ({
    title: stripTags(it.title),
    description: stripTags(it.description),
    link: it.link,
    source: extractSource(it.title, it.description), // 출처명 (예: 농업용어사전, 지구과학산책)
  }));
  return items;
}

// 네이버 백과사전 검색 결과에서 출처명을 뽑아냄.
// 출처는 보통 description 맨 앞(제목 바로 뒤)이나 "(출처: …)" 형태로 들어있다.
// 백과 항목처럼 출처 표기가 없으면 빈 문자열을 반환한다.
function extractSource(rawTitle, rawDescription) {
  const title = stripTags(rawTitle);
  let desc = stripTags(rawDescription);
  if (title && desc.startsWith(title)) desc = desc.slice(title.length).trimStart();

  // 1) 제목 바로 뒤 출처 라벨 (○○사전 / ○○백과 / ○○산책 / 용어해설 등으로 끝남)
  const KW =
    '(?:국어사전|영어사전|한자사전|용어사전|백과사전|미술대사전|용어해설|지식백과|대백과|백과|사전|산책|해설|도감|박물지|상식)';
  const prefixRe = new RegExp(
    '^([0-9A-Za-z·가-힣\\s]{1,25}?' + KW + ')(?=[\\s:：]|$)'
  );
  let m = desc.match(prefixRe);
  if (m) return m[1].replace(/\s+/g, ' ').trim();

  // 2) 본문 중 "(출처: ○○)" 형태
  m = desc.match(/\(([^()]*출처\s*[:：]\s*[^()]+)\)/);
  if (m) return m[1].replace(/.*출처\s*[:：]\s*/, '').replace(/\s+/g, ' ').trim();

  return '';
}

// HTML 태그/엔티티 정리
function stripTags(str = '') {
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// ---- Gemini로 쉽게 풀어서 설명 ----
async function explainWithGemini(word, level, referenceText) {
  if (!GEMINI_API_KEY) {
    throw new Error('Gemini API 키가 설정되지 않았습니다. .env 파일을 확인하세요.');
  }
  const levelInfo = LEVELS[level] || LEVELS[2];

  const prompt =
    `너는 어린이에게 낱말의 뜻을 쉽게 설명해 주는 친절한 선생님이야.\n\n` +
    `[설명할 낱말]\n${word}\n\n` +
    `[참고 자료 - 네이버 백과사전 검색 결과]\n` +
    `${referenceText || '(검색 결과가 없습니다. 네가 알고 있는 지식으로 설명해 주세요.)'}\n\n` +
    `[설명 대상]\n${levelInfo.label}\n\n` +
    `[설명 규칙]\n${levelInfo.guide}\n\n` +
    `[출력 형식]\n` +
    `"안녕", "오늘은", "~알려줄게요" 같은 인삿말이나 도입 문장은 절대 쓰지 말고, ` +
    `곧바로 "한 줄 뜻"부터 시작해 주세요.\n` +
    `1) 먼저 "한 줄 뜻"을 한 문장으로 알려 주세요.\n` +
    `2) 그다음 "자세한 설명"을 2~4문장으로 풀어 주세요.\n` +
    `3) 마지막으로 "예시"를 한 가지 들어 주세요.\n` +
    `각 항목 제목(한 줄 뜻 / 자세한 설명 / 예시)을 꼭 붙여 주세요. ` +
    `참고 자료가 어려우면 쉬운 말로 바꿔서 설명하고, 참고 자료에 없는 내용도 필요하면 보충해도 좋아요.`;

  const payload = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7 },
  });

  let quotaHit = false; // 모든 모델이 한도 초과였는지 추적

  // 모델 목록을 앞에서부터 시도. 429(한도)면 다음 모델로 넘어가고,
  // 500/503(일시 오류)는 같은 모델로 잠깐 기다렸다 재시도.
  for (const model of GEMINI_MODELS) {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=` +
      GEMINI_API_KEY;

    const MAX_TRIES = 3;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });

      if (res.ok) {
        const data = await res.json();
        const text =
          data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ||
          '';
        if (!text) {
          throw new Error('AI가 설명을 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
        }
        return text.trim();
      }

      const body = await res.text().catch(() => '');

      // 한도 초과(429): 이 모델은 오늘 더 못 씀 → 바로 다음 모델로
      if (res.status === 429) {
        quotaHit = true;
        console.warn(`[gemini] ${model} 한도 초과(429) → 다음 모델로 폴백`);
        break;
      }

      // 일시 오류(500/503): 같은 모델로 잠깐 기다렸다 재시도
      if ((res.status === 500 || res.status === 503) && attempt < MAX_TRIES) {
        const wait = 1500 * attempt;
        console.warn(`[gemini] ${model} ${res.status} 일시 오류, ${wait}ms 후 재시도 (${attempt}/${MAX_TRIES})`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      // 그 밖의 오류는 다음 모델로 시도
      console.error(`[gemini] ${model} 실패 (${res.status}): ${body.slice(0, 200)}`);
      break;
    }
  }

  // 여기까지 왔으면 모든 모델 실패
  if (quotaHit) {
    const err = new Error(
      '오늘 무료 사용량을 모두 썼어요. 잠시 후(보통 한국 시간 오후 4~5시에 초기화) 다시 시도하거나, 관리자에게 문의해 주세요.'
    );
    err.code = 'QUOTA';
    throw err;
  }
  throw new Error('AI 설명을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.');
}

// ---- API 라우트 ----
app.post('/api/explain', async (req, res) => {
  try {
    const word = (req.body.word || '').toString().trim();
    const level = parseInt(req.body.level, 10) || 2;

    if (!word) {
      return res.status(400).json({ error: '낱말을 입력해 주세요.' });
    }
    if (!LEVELS[level]) {
      return res.status(400).json({ error: '난이도 값이 올바르지 않습니다.' });
    }

    // 0) 캐시 확인 — 같은 낱말+난이도면 API를 다시 부르지 않음
    const cacheKey = `${level}::${word}`;
    if (explainCache.has(cacheKey)) {
      return res.json({ ...explainCache.get(cacheKey), cached: true });
    }

    // 1) 네이버 백과사전 검색
    let sources = [];
    try {
      sources = await searchNaverEncyc(word);
    } catch (e) {
      // 검색 실패해도 Gemini 자체 지식으로 설명 시도
      console.error('[naver]', e.message);
    }

    const referenceText = sources
      .map((s, i) => `${i + 1}. ${s.title}: ${s.description}`)
      .join('\n');

    // 2) Gemini로 쉽게 설명
    const explanation = await explainWithGemini(word, level, referenceText);

    const result = {
      word,
      level,
      levelLabel: LEVELS[level].label,
      explanation,
      sources,
    };
    explainCache.set(cacheKey, result);
    res.json(result);
  } catch (e) {
    console.error('[explain]', e.message);
    // 한도 초과는 429로, 그 외는 500으로 응답 (메시지는 이미 사용자 친화적)
    const status = e.code === 'QUOTA' ? 429 : 500;
    res.status(status).json({ error: e.message || '알 수 없는 오류가 발생했습니다.' });
  }
});

// 난이도 목록 제공
app.get('/api/levels', (req, res) => {
  res.json(
    Object.entries(LEVELS).map(([value, v]) => ({
      value: Number(value),
      label: v.label,
    }))
  );
});

app.listen(PORT, () => {
  console.log(`\n  쉽게 말해줘 서버 실행 중 →  http://localhost:${PORT}`);
  console.log(`  Gemini 모델 순서: ${GEMINI_MODELS.join(' → ')}\n`);
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    console.warn('  ⚠ 네이버 API 키가 비어 있습니다. .env 파일을 확인하세요.');
  }
  if (!GEMINI_API_KEY) {
    console.warn('  ⚠ Gemini API 키가 비어 있습니다. .env 파일을 확인하세요.');
  }
});
