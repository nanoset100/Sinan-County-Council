import type { AiContent, Anchor, VerifierFailure } from '../types.js';

/**
 * 앵커 무결성 검사 (PRD v0.4 §6-④, §8 앵커 공통 구조 · 인용문 폴백).
 *
 * 모든 문단(what_changes 각 항목, who_affected)에 유효 앵커가 있어야 한다.
 * 유효 기준: url 존재 AND (fragment 또는 quote 중 하나 이상 존재).
 * → fragment 없이 quote 만 있어도 인정한다(S2 등 안정 fragment 불가 원문 폴백).
 */

export function checkAnchorIntegrity(ai: AiContent): VerifierFailure[] {
  const failures: VerifierFailure[] = [];

  const changes = ai.what_changes ?? [];
  if (changes.length === 0 && !ai.who_affected) {
    // A1 요약이 무엇이 바뀌나/누구에게 중 아무 문단도 없으면 앵커를 붙일 근거 문단 자체가 없다.
    failures.push({
      check: 'anchor-integrity',
      message: '앵커를 가진 근거 문단이 하나도 없음(what_changes/who_affected 비어 있음)',
    });
    return failures;
  }

  changes.forEach((c, i) => {
    const err = validateAnchor(c.anchor);
    if (err) failures.push({ check: 'anchor-integrity', message: `what_changes[${i}] 앵커 무효: ${err}` });
  });

  if (ai.who_affected) {
    const err = validateAnchor(ai.who_affected.anchor);
    if (err) failures.push({ check: 'anchor-integrity', message: `who_affected 앵커 무효: ${err}` });
  }

  return failures;
}

function validateAnchor(anchor: Anchor | undefined): string | null {
  if (!anchor) return '앵커 없음';
  if (!anchor.url || anchor.url.length === 0) return 'url 없음';
  const hasFragment = typeof anchor.fragment === 'string' && anchor.fragment.length > 0;
  const hasQuote = typeof anchor.quote === 'string' && anchor.quote.length > 0;
  if (!hasFragment && !hasQuote) return 'fragment/quote 둘 다 없음(폴백 불가)';
  return null;
}
