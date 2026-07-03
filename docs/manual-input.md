# 수기 입력 가이드 (S2 → 데이터) — PRD v0.5 수기 주도형

§12-G0 판정으로 신안군 데이터의 **원문 정본은 신안군의회 홈페이지(S2)** 이고, 수집은 **수기 입력**으로
한다. 이 문서는 원문을 보고 `data/manual-input/*.json` 을 만드는 방법이다.

## 전체 흐름

```
신안군의회 홈페이지(S2) 원문 열람
      │  (사람이 옮겨 적음)
      ▼
data/manual-input/<파일>.json 작성   ← 템플릿 _template.*.json 복사
      │
      ▼
npm run validate:input   ← 정규화 후 §8 스키마 통과하는지 즉시 확인
      │
      ▼
npm run pipeline         ← 정규화→A1 초안→Verifier→diff (.pipeline-out 스테이징)
      │
      ▼
사람 검수(원칙 6) → data/ 로 머지 → CI 배포
```

## 파일 규칙

- 위치: `data/manual-input/`. 파일명 예: `2026-bill-001.json`, `2026-plenary-001.json`.
- **`_` 로 시작하는 파일은 템플릿/예시로 간주되어 수집에서 제외**된다(`_template.agenda.json` 등).
- 한 파일에 **여러 항목을 배열**로 담아도 된다.
- 인코딩은 **UTF-8(BOM 없이)**. Windows 메모장 대신 VS Code 등에서 "UTF-8"로 저장.

## 항목 구조

```jsonc
{
  "kind": "agenda | meeting | member | executive",
  "sourceUrl": "원문 페이지 URL(정본) — 필수",
  "sourceText": "근거 대조용 원문 텍스트(안건이면 의안요지). A1 요약 Verifier 가 이걸로 대조.",
  "snapshotPath": null,
  "data": { /* §8 스키마의 해당 레코드 필드. _meta 는 파이프라인이 자동 생성 */ }
}
```

- `_meta`(source_url/source_system/collected_at/reviewed_by…)는 **직접 넣지 않는다** — 정규화가 자동으로 채운다(`source_system=MANUAL`, `reviewed_by=null`).
- `reviewed_by` 를 수기로 채우지 말 것: 검수는 사람이 하는 실질 게이트(원칙 6).

## 종류별 요령 (v0.5 축소 범위 반영)

### 안건(agenda) — 전수 수록
- `data` 필수: `id, title, type, proposer, outline, timeline, votes`.
- `timeline` 은 원문에 **날짜가 있는 단계만** 넣는다(제안/위원회 심사/본회의 의결/이송/공포).
- `result` 는 **중립 동사만**("원안가결", "수정가결", "부결" 등). 평가 형용사 금지(§14-1).
- `votes.recorded` 는 기본 `false`(무기명 처리) — 기명 표결 기록이 없으면 그대로 둔다.
- `sourceText`/`outline` 에 **의안요지 원문을 그대로** 넣어야 A1 요약이 근거를 가진다(근거 없으면 요약 미제공).

### 회의록(meeting) — 축소(메타 + 원문 링크)
- `data` 필수: `id, date, type, minutes_url`.
- **본문 전수 구조화는 하지 않는다.** `minutes_html` 은 `null` 로 두고 **`minutes_url`(원문 링크)로 정본 접근**을 보장한다.
- 발언 구조화(A2)는 우선순위 안건 위주로 별도 진행(§6-1 T3).

### 집행부 공보(executive)
- `data` 필수: `id, dept, title, date`. `sourceUrl` = 군 공보 원문(필수). 공보 외 출처 금지(§5).

## 검증·게시

- `npm run validate:input` — 정규화 후 §8 스키마 통과 여부를 항목별로 표시. **여기서 ✓ 가 떠야** 파이프라인에 올린다.
- 통과 후 `npm run pipeline` → `.pipeline-out/` 스테이징 + Verifier 결과 확인.
- **게시는 사람 검수 → 머지에서만.** 이 문서의 어떤 단계도 자동 게시를 하지 않는다.

## 향후

국회도서관이 신안군 제10대 데이터를 Open API 로 개방하면 `COLLECTOR=s1` 로 전환해 수기 부담을 줄인다
(어댑터만 교체, [pipeline.md](./pipeline.md)). 그 전까지 본 수기 워크플로가 주 수집 경로다.
