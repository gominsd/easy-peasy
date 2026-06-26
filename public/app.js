'use strict';

const form = document.getElementById('search-form');
const wordInput = document.getElementById('word');
const submitBtn = document.getElementById('submit-btn');
const resultArea = document.getElementById('result-area');
const levelOptions = document.getElementById('level-options');

// 난이도 칩 선택 표시 토글
levelOptions.addEventListener('change', () => {
  document.querySelectorAll('.level-chip').forEach((chip) => {
    const input = chip.querySelector('input');
    chip.classList.toggle('selected', input.checked);
  });
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const word = wordInput.value.trim();
  if (!word) return;

  const level = Number(
    document.querySelector('input[name="level"]:checked').value
  );

  setLoading(true);
  showLoading(word);

  try {
    const res = await fetch('/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word, level }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || '설명을 가져오지 못했습니다.');
    }
    showResult(data);
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
});

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.textContent = isLoading ? '생각하는 중…' : '쉽게 알아보기';
}

function showLoading(word) {
  resultArea.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <div>"<strong>${escapeHtml(word)}</strong>"의 뜻을 쉽게 풀고 있어요…</div>
    </div>`;
}

function showError(message) {
  resultArea.innerHTML = `
    <div class="error">
      😢 ${escapeHtml(message)}
    </div>`;
}

function showResult(data) {
  const sourcesHtml =
    data.sources && data.sources.length
      ? `<div class="sources">
           <h3>📚 네이버 백과사전에서 참고했어요</h3>
           <ul>
             ${data.sources
               .map(
                 (s) =>
                   `<li><a href="${escapeAttr(s.link)}" target="_blank" rel="noopener">${escapeHtml(
                     s.title
                   )}</a></li>`
               )
               .join('')}
           </ul>
         </div>`
      : '';

  resultArea.innerHTML = `
    <article class="result-card">
      <div class="result-head">
        <h2>${escapeHtml(data.word)}</h2>
        <span class="badge">${escapeHtml(data.levelLabel)}</span>
      </div>
      <div class="explanation">${formatExplanation(data.explanation)}</div>
      ${sourcesHtml}
    </article>`;
}

// 항목(한 줄 뜻 / 자세한 설명 / 예시)을 구분된 블록으로 나눠 여백을 줌
function formatExplanation(text) {
  const safe = escapeHtml(text).trim();
  // 마크다운 기호(#, *, >)와 번호, 콜론을 무시하고 항목 제목을 찾음
  const re = /(?:^|\n)[\s*#>]*(?:\d+\)\s*)?(한 줄 뜻|자세한 설명|예시)[\s*:：]*/g;

  const sections = [];
  let m;
  let lastLabel = null;
  let lastIndex = 0;
  while ((m = re.exec(safe)) !== null) {
    if (lastLabel !== null) {
      sections.push({ label: lastLabel, body: safe.slice(lastIndex, m.index) });
    }
    lastLabel = m[1];
    lastIndex = re.lastIndex;
  }
  if (lastLabel !== null) {
    sections.push({ label: lastLabel, body: safe.slice(lastIndex) });
  }

  // 항목을 못 찾으면 줄바꿈만 살려서 그대로 표시
  if (!sections.length) {
    return safe.replace(/\n/g, '<br>');
  }

  return sections
    .map(
      (s) =>
        `<div class="section">` +
        `<div class="section-title">${s.label}</div>` +
        `<div class="section-body">${s.body.trim().replace(/\n+/g, '<br>')}</div>` +
        `</div>`
    )
    .join('');
}

function escapeHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str = '') {
  return escapeHtml(str);
}
