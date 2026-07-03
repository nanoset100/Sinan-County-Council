# 데이터 파이프라인 가이드 (PRD v0.4 §6)

## 흐름

```
수집(Collector) → 정규화(Normalize) → AI 초안(A1) → Verifier(스크리닝)
  → 변경 감지(Differ) → [사람 검수 = 실질 게이트] → 머지 → 정적 빌드·배포
```

이 저장소의 스크립트는 **검수 전 단계까지만** 자동화한다. 게시는 사람 검수(원칙 6) 후 머지에서만
일어난다. `pipeline/run.ts` 는 `data/` 를 절대 직접 쓰지 않고 `.pipeline-out/` 스테이징에만 쓴다.

## 어댑터 전환 (S1 ↔ 수기)

- `COLLECTOR=manual` (기본): `data/manual-input/*.json` 을 읽는다. G0 통과 전 폴백. §5 범위는 축소 재정의(안건 메타·타임라인 전수 + 회의록은 원문 링크·회차 메타만).
- `COLLECTOR=s1`: 인증키(`S1_API_KEY`)와 신안군 `S1_RASMBLY_ID` 로 Open API 를 호출한다. **G0 통과 후에만.** 절차는 [G0-api-key-request.md](./G0-api-key-request.md).

두 수집기는 `pipeline/collectors/Collector.ts` 인터페이스를 공유하므로, G0 통과 시 하류 코드 변경 없이 어댑터만 교체된다.

**S1 API 실측 주의(2026-07):** `rasmblyId` 필터는 `searchType`이 비-ALL(bill.do=`BI_SJ`, minutes.do/assemblyinfo.do=`RASMBLY_NM`)이고 `searchKeyword`가 빈값일 때만 적용된다(ALL 이면 전국 반환). 또한 **`bill.do` 상세에는 의안요지(BI_OUTLINE) 본문이 없다** — 제목·메타·결과·파일명만 제공한다. 따라서 **A1 요약의 근거 원문(의안요지)은 S1이 아니라 신안군의회 홈페이지(S2)/첨부문서에서 확보**해야 한다. A1 품질 파일럿(`npm run pilot`)은 `--input=<의안요지 파일>`(fixtures/pilot/_template.json 참고)로 실제 원문을 공급한다.

## 명령

| 명령 | 설명 |
|---|---|
| `npm run pipeline` | 수집→정규화→초안→Verifier→diff 실행, `.pipeline-out/` 에 스테이징 |
| `npm run validate` | `data/**` 전체를 §8 JSON Schema 로 검증(실패 시 exit 1) |
| `npm test` | Verifier DoD 테스트(§11) |
| `npm run g0` | S1 신안군 커버리지 실호출 실증(인증키 필요) |
| `npm run build` | Astro 정적 빌드 |

## Verifier (스크리닝 계층, §6-④ / §14-3)

세 검사 중 하나라도 실패하면 `verifier_passed=false` → ai_content 없이 원문만 검수 큐로.

1. **근거 대조(grounding)**: 요약 속 숫자·날짜, 앵커 인용문이 원문에 실재하는지.
2. **금지 어휘(forbidden-terms)**: `config/forbidden-terms.json` 사전 기계 검사(§14-1).
3. **앵커 무결성(anchor-integrity)**: 모든 문단에 `url` + (`fragment` | `quote`).

**한계(명문화, §6):** 통과는 정확성 증명이 아니다. 한국어 표기 변형 오탐/미탐, 재서술의 의미
오류(인상/인하 방향 등)는 잡지 못한다. **사람 검수가 유일한 실질 게이트다.** 이 한계는 AI 투명성
페이지(§14-5, 배치 2)에도 공개한다.

## 검수 티어·SLA (§6-1)

| 티어 | 대상 | SLA(회기 중) | SLA(폐회 중) |
|---|---|---|---|
| T1 | 안건 데이터 + A1 요약 + 집행부 공보 | 7일 | 7일 |
| T2 | 회의록 메타 + 원문 링크 | 14일 | 7일 |
| T3 | A2 발언 구조화 + A4b 태그 + A6 연결 | 21일 | 14일 |

회기 중 검수자 최소 2인(주 2~3시간) 확보가 티어제 전제(§12-4). 1인 운영 시 T1만 유지하고 T2·T3 SLA 배증.

## 데이터 배치 레이아웃

```
data/
  glossary.json           # A5 고정 사전(배열)
  manual-input/*.json     # 수기 입력(폴백) — 정규화 전 원시
  members/*.json          # 검수·머지된 게시 레코드 (배치 2부터 채워짐)
  agendas/*.json
  meetings/*.json
  statements/*.json
  executives/*.json
```
