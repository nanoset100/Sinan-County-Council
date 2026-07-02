import { describe, it, expect, beforeEach } from 'vitest';
import { verify, setForbiddenTerms, loadForbiddenTerms } from './index.js';
import type { AiContent } from '../types.js';

/**
 * Verifier DoD 증명 (PRD v0.4 §11).
 * ① 원문에 없는 숫자 포함 요약 차단
 * ② 금지 어휘 포함 요약 차단
 * ③ fragment 없이 quote 만 있는 앵커(폴백) 인정
 * ④ url·fragment·quote 가 유효하지 않은 앵커 거부
 */

function ai(overrides: Partial<AiContent>): AiContent {
  return {
    generated_at: '2026-07-02',
    model: 'test',
    verifier_passed: false,
    reviewed_by: null,
    reviewed_at: null,
    summary_one_line: '요약',
    what_changes: [],
    ...overrides,
  };
}

describe('Verifier — 스크리닝 계층', () => {
  beforeEach(() => {
    // 검사 격리: 각 테스트에서 필요한 금지어만 주입(파일 의존 제거)
    setForbiddenTerms([]);
  });

  it('① 원문에 없는 숫자를 포함한 요약을 차단한다', () => {
    const source = '이 조례는 지원 대상을 규정한다.';
    const content = ai({
      summary_one_line: '지원 조례',
      what_changes: [
        {
          text: '지원 금액을 500원으로 정한다', // 500 은 원문에 없음
          anchor: { url: 'https://ex/1', quote: '지원 대상을 규정한다' },
        },
      ],
    });
    const result = verify(content, source);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.check === 'grounding' && f.detail === '500')).toBe(true);
  });

  it('② 금지 어휘(평가 표현)를 포함한 요약을 차단한다', () => {
    setForbiddenTerms(['우수한']);
    const source = '본 안건은 예산을 정한다.';
    const content = ai({
      summary_one_line: '예산 안건',
      what_changes: [
        {
          text: '이 사업은 우수한 성과를 낸다', // 금지 어휘
          anchor: { url: 'https://ex/1', quote: '예산을 정한다' },
        },
      ],
    });
    const result = verify(content, source);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.check === 'forbidden-terms' && f.detail === '우수한')).toBe(true);
  });

  it('③ fragment 없이 quote 만 있는 앵커(인용문 폴백)를 인정한다', () => {
    const source = '농어촌버스 요금을 지원한다.';
    const content = ai({
      summary_one_line: '버스비 지원',
      what_changes: [
        {
          text: '농어촌버스 요금을 지원한다',
          anchor: { url: 'https://ex/1', quote: '농어촌버스 요금을 지원한다' }, // fragment 없음
        },
      ],
    });
    const result = verify(content, source);
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('④ url 만 있고 fragment/quote 가 둘 다 없는 앵커를 거부한다', () => {
    const source = '농어촌버스 요금을 지원한다.';
    const content = ai({
      summary_one_line: '버스비 지원',
      what_changes: [
        {
          text: '농어촌버스 요금을 지원한다',
          anchor: { url: 'https://ex/1' }, // fragment·quote 둘 다 없음
        },
      ],
    });
    const result = verify(content, source);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.check === 'anchor-integrity')).toBe(true);
  });

  it('근거 원문이 비어 있으면 차단한다(근거 없이 게시 불가, §14-2)', () => {
    const content = ai({
      summary_one_line: '요약',
      what_changes: [{ text: '내용', anchor: { url: 'https://ex/1', quote: '내용' } }],
    });
    const result = verify(content, '');
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.check === 'grounding')).toBe(true);
  });
});

describe('금지 어휘 사전 파일', () => {
  it('config/forbidden-terms.json 을 로드하며 비어있지 않다', () => {
    setForbiddenTerms(null as unknown as string[]); // 캐시 무효화 → 파일 재로딩
    const terms = loadForbiddenTerms();
    expect(Array.isArray(terms)).toBe(true);
    expect(terms.length).toBeGreaterThan(0);
  });
});
