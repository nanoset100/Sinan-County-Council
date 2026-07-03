import type { AiContent, Anchor } from './types.js';

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
- 각 문단에는 근거 앵커(원문 URL + 원문에서 그대로 인용한 quote)를 붙인다.

[앵커 quote 규칙 — 엄격]
- quote 는 **원문의 연속된 한 구간을 글자 그대로** 복사한다(공백 포함).
- 축약·요약·바꿔쓰기 금지. 서로 떨어진 문장을 "..." 나 줄임표로 이어붙이지 않는다.
- quote 는 반드시 원문에 그대로 존재하는 부분 문자열이어야 한다(자동 검증에서 없으면 생성 실패로 처리됨).
- 한 문단의 근거가 원문 여러 곳이면, 가장 핵심인 한 구간만 골라 그대로 인용한다.

[출력(JSON)]
{
  "summary_one_line": "한 줄 요지",
  "what_changes": [{ "text": "무엇이 어떻게 바뀌나(개정 전/후 재서술)", "anchor": { "url": "...", "quote": "원문의 연속 구간 그대로" } }],
  "who_affected": { "text": "원문에 명시된 적용 대상·시행일만", "anchor": { "url": "...", "quote": "원문의 연속 구간 그대로" } }
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

export interface TokenUsage { input_tokens: number; output_tokens: number }

interface RawSummary {
  summary_one_line?: unknown;
  what_changes?: unknown;
  who_affected?: unknown;
}

/**
 * Claude 기반 A1 드래프터 (PRD §6-③, §7-B). @anthropic-ai/sdk 로 A1_SYSTEM_PROMPT 사용.
 *
 * - 원문(의안요지)만 근거로 3단 요약 JSON 생성. 파싱 실패는 생성 실패로 처리(throw).
 * - 앵커 url 은 모델 출력 대신 실제 input.sourceUrl 로 강제(오염 방지). quote 는 모델 값 유지.
 * - 출력은 verifier_passed=false·reviewed_by=null 상태 — 반드시 Verifier→사람 검수를 거친다.
 * - lastUsage 로 토큰 사용량을 노출(파일럿 비용 실측용, §12-3).
 */
export class ClaudeAiDrafter implements AiDrafter {
  lastUsage: TokenUsage | null = null;

  constructor(private readonly apiKey: string, readonly model: string) {}

  async draftAgendaSummary(input: DraftInput): Promise<AiContent> {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: this.apiKey });

    const msg = await client.messages.create({
      model: this.model,
      max_tokens: 1024,
      // ⚠️ temperature 등 샘플링 파라미터 금지: claude-sonnet-5/opus-4-8/4.7/fable-5 는
      //    비기본 temperature 를 400 으로 거부한다. A1 재현성은 프롬프트로 확보한다.
      system: A1_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content:
            `다음 안건의 원문만 근거로 A1 3단 요약 JSON 을 출력하세요. JSON 외 다른 텍스트는 쓰지 마세요.\n\n` +
            `[제목] ${input.title}\n\n[원문(의안요지)]\n${input.sourceText}`,
        },
      ],
    });

    this.lastUsage = { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens };

    const text = msg.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    const parsed = parseSummaryJson(text);
    return this.toAiContent(parsed, input.sourceUrl);
  }

  private toAiContent(raw: RawSummary, sourceUrl: string): AiContent {
    const forceUrl = (a: Anchor | undefined): Anchor => ({
      url: sourceUrl, // 앵커 url 은 항상 실제 원문 URL 로 강제
      ...(a?.quote ? { quote: String(a.quote) } : {}),
      ...(a?.fragment ? { fragment: String(a.fragment) } : {}),
    });
    const changes = Array.isArray(raw.what_changes)
      ? raw.what_changes.map((c: any) => ({ text: String(c?.text ?? ''), anchor: forceUrl(c?.anchor) }))
      : [];
    const who = raw.who_affected as any;
    return {
      generated_at: new Date().toISOString().slice(0, 10),
      model: this.model,
      verifier_passed: false,
      reviewed_by: null,
      reviewed_at: null,
      summary_one_line: String(raw.summary_one_line ?? ''),
      what_changes: changes,
      who_affected: who?.text ? { text: String(who.text), anchor: forceUrl(who.anchor) } : undefined,
    };
  }
}

/** 모델 출력에서 JSON 을 견고하게 추출. 실패 시 생성 실패(throw). */
function parseSummaryJson(text: string): RawSummary {
  let body = text.trim();
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('AI 응답에서 JSON 을 찾지 못함(생성 실패)');
  return JSON.parse(body.slice(start, end + 1)) as RawSummary;
}

/** ANTHROPIC_API_KEY 유무로 드래프터 선택. 키 없으면 Mock. 배치 요약은 비용을 위해 기본 sonnet. */
export function selectDrafter(): AiDrafter {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    return new ClaudeAiDrafter(key, process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5');
  }
  return new MockAiDrafter();
}
