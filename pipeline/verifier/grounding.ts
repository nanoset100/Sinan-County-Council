import type { AiContent, VerifierFailure } from '../types.js';

/**
 * 근거 대조 (PRD v0.4 §6-④, §14-3-2 · 스크리닝 계층).
 *
 * AI 문장 속 숫자·날짜가 원문에 실재하는지, 그리고 각 앵커의 인용문(quote)이 원문의 실제
 * 부분 문자열인지 자동 확인한다. 하나라도 원문에서 확인되지 않으면 실패.
 *
 * ⚠️ 한계(명문화, §6): 이것은 '스크리닝'이지 정확성 증명이 아니다.
 *   - 한국어 표기 변형(띄어쓰기·약칭·한자 병기)으로 오탐/미탐이 날 수 있다.
 *   - 숫자·인용이 모두 원문에 있어도 재서술의 '의미'가 틀릴 수 있다(예: 인상/인하 방향 오류).
 *     이 의미 오류는 여기서 잡지 못하며, 사람 검수(§14-3-3)가 유일한 게이트다.
 *   - 고유명사 대조는 한국어 특성상 자동화 신뢰도가 낮아 이 계층에서 강제하지 않는다(사람 검수 몫).
 */

export function checkGrounding(ai: AiContent, sourceText: string): VerifierFailure[] {
  const failures: VerifierFailure[] = [];
  const normSource = normalize(sourceText);

  if (normSource.trim().length === 0) {
    failures.push({
      check: 'grounding',
      message: '근거 원문(sourceText)이 비어 있어 대조할 수 없습니다. 근거 없이 게시 불가(§14-2).',
    });
    return failures;
  }

  const aiText = collectAiText(ai);
  const normSourceNoComma = normSource.replace(/,/g, '');

  // 1) 숫자 토큰 대조 (양쪽 모두 콤마 제거 후 비교)
  for (const token of extractNumbers(aiText)) {
    if (!normSourceNoComma.includes(normalizeNumber(token))) {
      failures.push({
        check: 'grounding',
        message: '원문에 없는 숫자가 요약에 포함됨',
        detail: token,
      });
    }
  }

  // 2) 날짜 토큰 대조
  for (const token of extractDates(aiText)) {
    if (!normSource.includes(normalize(token))) {
      failures.push({
        check: 'grounding',
        message: '원문에 없는 날짜가 요약에 포함됨',
        detail: token,
      });
    }
  }

  // 3) 앵커 인용문(quote) 부분 문자열 대조 — 근거의 핵심
  for (const quote of collectQuotes(ai)) {
    if (!normSource.includes(normalize(quote))) {
      failures.push({
        check: 'grounding',
        message: '앵커 인용문이 원문에서 확인되지 않음',
        detail: quote,
      });
    }
  }

  return failures;
}

function collectAiText(ai: AiContent): string {
  const parts: string[] = [ai.summary_one_line];
  for (const c of ai.what_changes ?? []) parts.push(c.text);
  if (ai.who_affected) parts.push(ai.who_affected.text);
  return parts.join('\n');
}

function collectQuotes(ai: AiContent): string[] {
  const quotes: string[] = [];
  for (const c of ai.what_changes ?? []) if (c.anchor.quote) quotes.push(c.anchor.quote);
  if (ai.who_affected?.anchor.quote) quotes.push(ai.who_affected.anchor.quote);
  return quotes;
}

/** 공백을 제거해 띄어쓰기 변형에 견고하게 만든다(스크리닝 수준). */
function normalize(s: string): string {
  return s.replace(/\s+/g, '');
}

/** 숫자 토큰: 1,000 / 12.5 / 30% 등. */
function extractNumbers(text: string): string[] {
  return text.match(/\d[\d,]*(?:\.\d+)?%?/g) ?? [];
}

/** 대조용으로 콤마·퍼센트를 제거한 숫자 코어. */
function normalizeNumber(token: string): string {
  return token.replace(/,/g, '').replace(/%$/, '');
}

/** 날짜 토큰: 2026-07-01 / 2026.07.01 / 2026년 7월 1일 / 2026년 7월. */
function extractDates(text: string): string[] {
  const patterns = [
    /\d{4}[-.]\d{1,2}[-.]\d{1,2}/g,
    /\d{4}년\s*\d{1,2}월\s*\d{1,2}일/g,
    /\d{4}년\s*\d{1,2}월/g,
  ];
  const out: string[] = [];
  for (const p of patterns) out.push(...(text.match(p) ?? []));
  return out;
}
