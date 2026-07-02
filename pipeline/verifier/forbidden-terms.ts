import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiContent, VerifierFailure } from '../types.js';

/**
 * 금지 어휘 검사 (PRD v0.4 §6-④, §14-1 · §14-3-2).
 *
 * 평가 형용사·순위·감정·예측 표현을 config/forbidden-terms.json 사전으로 기계 검사한다.
 * 하나라도 포함되면 실패 → 게시 큐 진입 불가.
 *
 * ⚠️ 한계: 사전 기반이라 신조어·우회 표현은 놓칠 수 있다(사람 검수가 최종 게이트).
 */

let cachedTerms: string[] | null = null;

export function loadForbiddenTerms(): string[] {
  if (cachedTerms) return cachedTerms;
  const path = join(process.cwd(), 'config', 'forbidden-terms.json');
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { terms: string[] };
  cachedTerms = parsed.terms ?? [];
  return cachedTerms;
}

/** 테스트/재로딩용 — 사전 주입. */
export function setForbiddenTerms(terms: string[]): void {
  cachedTerms = terms;
}

export function checkForbiddenTerms(ai: AiContent, terms = loadForbiddenTerms()): VerifierFailure[] {
  const failures: VerifierFailure[] = [];
  const text = collectAiText(ai);
  for (const term of terms) {
    if (text.includes(term)) {
      failures.push({
        check: 'forbidden-terms',
        message: '금지 어휘(평가·순위·감정·예측)가 요약에 포함됨',
        detail: term,
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
