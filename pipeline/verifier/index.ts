import type { AiContent, VerifierResult } from '../types.js';
import { checkGrounding } from './grounding.js';
import { checkForbiddenTerms } from './forbidden-terms.js';
import { checkAnchorIntegrity } from './anchor-integrity.js';

/**
 * Verifier — 스크리닝 계층 (PRD v0.4 §6-④, §14-3-2).
 *
 * 세 검사(근거 대조·금지 어휘·앵커 무결성) 중 하나라도 실패하면 통과 실패.
 * 통과 실패 건은 ai_content 없이(원문만으로) 검수 큐로 보낸다.
 *
 * ★ 통과는 정확성 증명이 아니다(§6 한계). 표기 변형 오탐/미탐, 재서술 의미 오류는
 *   잡지 못하며, 사람 검수(§14-3-3)가 유일한 실질 게이트다.
 */
export function verify(ai: AiContent, sourceText: string): VerifierResult {
  const failures = [
    ...checkGrounding(ai, sourceText),
    ...checkForbiddenTerms(ai),
    ...checkAnchorIntegrity(ai),
  ];
  return { passed: failures.length === 0, failures };
}

export { checkGrounding } from './grounding.js';
export { checkForbiddenTerms, loadForbiddenTerms, setForbiddenTerms } from './forbidden-terms.js';
export { checkAnchorIntegrity } from './anchor-integrity.js';
