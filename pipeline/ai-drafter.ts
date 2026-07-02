import type { AiContent } from './types.js';

/**
 * AI Drafter (PRD v0.4 §6-③, §7-B A1) — 안건 3단 요약 초안 생성.
 *
 * 배치 1 범위: 인터페이스 + 시스템 프롬프트(§14 금지 규칙 내장) + dry-run(mock).
 * 실제 배치 생성은 배치 2에서 §12-3 파일럿(제9대 10건)으로 프롬프트·Verifier 확정 후 본 가동.
 *
 * 원칙: 생성물은 반드시 Verifier(스크리닝) → 사람 검수를 통과해야 게시된다. 여기서 만든 초안은
 * verifier_passed=false, reviewed_by=null 상태로 나온다(무검수 게시 금지, 원칙 6).
 */

export const A1_SYSTEM_PROMPT = `당신은 대한민국 신안군의회의 공식 안건 기록을 '읽어주는' 보조자입니다.
당신의 유일한 임무는 제공된 원문에 명시된 사실을 평이한 한국어로 재서술하는 것입니다.

[절대 금지 — 하나라도 어기면 생성 실패]
- 평가·등급·순위·비교 우열(예: "활발한", "소극적", "우수한", "미흡한").
- 감정·성향·이념 분석, 의도 추정("~하려는 의도로 보인다").
- 예측(표결 결과, 정책 성패 등)과 영향 평가·전망.
- 원문에 없는 숫자·고유명사·날짜·인과관계의 생성.
- "대폭/급증/크게" 등 정도를 과장하는 수식어. 증감은 숫자·퍼센트만.

[반드시]
- 원문에 명시된 사실의 재서술만 한다.
- 모든 사실 진술(숫자·고유명사·날짜·결과)은 원문에서 확인 가능해야 한다.
- 각 문단에는 근거 앵커(원문 URL + fragment 또는 원문에서 그대로 인용한 quote)를 붙인다.

[출력(JSON)]
{
  "summary_one_line": "한 줄 요지",
  "what_changes": [{ "text": "무엇이 어떻게 바뀌나(개정 전/후 재서술)", "anchor": { "url": "...", "quote": "원문 인용" } }],
  "who_affected": { "text": "원문에 명시된 적용 대상·시행일만", "anchor": { "url": "...", "quote": "원문 인용" } }
}`;

export interface DraftInput {
  /** 안건 제목. */
  title: string;
  /** 의안요지 등 근거 원문. */
  sourceText: string;
  /** 근거 앵커에 쓸 원문 URL. */
  sourceUrl: string;
}

export interface AiDrafter {
  draftAgendaSummary(input: DraftInput): Promise<AiContent>;
}

/** dry-run/mock 드래프터 — 실 API 호출 없이 파이프라인 흐름을 검증한다. */
export class MockAiDrafter implements AiDrafter {
  readonly model = 'mock:no-generation';

  async draftAgendaSummary(input: DraftInput): Promise<AiContent> {
    // 실제 생성을 하지 않는다. 원문 첫 문장을 인용해 앵커만 갖춘 자리표시 초안을 만든다.
    const firstSentence = input.sourceText.split(/[.。\n]/)[0]?.trim() ?? '';
    return {
      generated_at: new Date().toISOString().slice(0, 10),
      model: this.model,
      verifier_passed: false,
      reviewed_by: null,
      reviewed_at: null,
      summary_one_line: `[초안 미생성] ${input.title}`,
      what_changes: firstSentence
        ? [{ text: firstSentence, anchor: { url: input.sourceUrl, quote: firstSentence } }]
        : [],
      who_affected: firstSentence
        ? { text: firstSentence, anchor: { url: input.sourceUrl, quote: firstSentence } }
        : undefined,
    };
  }
}

/**
 * Claude 기반 드래프터의 골격 (배치 2에서 구현).
 * @anthropic-ai/sdk 로 A1_SYSTEM_PROMPT 를 사용해 생성한다. 여기서는 미구현으로 명시한다.
 */
export class ClaudeAiDrafter implements AiDrafter {
  constructor(private readonly _apiKey: string, private readonly _model: string) {}

  async draftAgendaSummary(_input: DraftInput): Promise<AiContent> {
    throw new Error(
      'ClaudeAiDrafter 는 배치 2에서 구현합니다(§12-3 파일럿 후 본 가동). ' +
        '지금은 MockAiDrafter 를 사용하세요.',
    );
  }
}

/** ANTHROPIC_API_KEY 유무로 드래프터 선택. 키 없으면 Mock. */
export function selectDrafter(): AiDrafter {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    return new ClaudeAiDrafter(key, process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8');
  }
  return new MockAiDrafter();
}
