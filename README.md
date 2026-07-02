# 신안군 의정활동 공개 포털

공개된 공식 기록에 근거해 신안군의회와 신안군 집행부의 활동을 **중립적으로 공개**하고, AI로 기록의
**가독성·접근성**을 높이는 비영리 시민 투명성 포털. — *"판단은 군민이, 번역은 AI가."*

> 본 사이트는 공개된 공식 기록을 정리한 비영리 시민 정보 서비스이며 특정 정당·후보와 무관합니다.

스펙: [PRD v0.4](../Cowork/신안군%20의회/신안군_의정활동공개_사이트_PRD_v0.4.md)

## 현재 상태 — 배치 1 (기반 구축)

이 저장소는 **데이터 모델 + 파이프라인 골격**을 구현한 상태다. 화면(F1~F8)과 실제 AI 배치 생성은
배치 2에서 추가한다.

**왜 기반만?** PRD 최우선 게이트 **§12-G0(S1 API 신안군 커버리지 실증)**를 먼저 수행했고, 그 결과에
따라 파이프라인 방향을 확정했다. PRD §6이 정의한 **어댑터 구조 + 수기 폴백**을 그대로 구현했다.
→ [docs/G0-api-key-request.md](docs/G0-api-key-request.md)

### G0 판정 결과 (2026-07-02): **전면 수기 주도형 확정**
국회도서관 지방의정포털(S1)에는 **MVP 대상인 신안군 제10대(2026-07~) 데이터가 없다**:
- 의안: Open API rasmblyId 목록에 신안군 부재 + 웹 상세검색 0건.
- 회의록: 웹에 168건 있으나 **전부 제6대(2013) 과거분** — 제10대는 아직 미반영(포털 공지: 2026 지선
  데이터는 각 의회 홈페이지 참고해 추후 업데이트 예정).

→ **수집 주체 = 수기(ManualCollector), 원문 정본 = 신안군의회 홈페이지(S2)**. S1Collector 는 (a)과거
소급 아카이브 (b)향후 국회도서관 개방 시 전환을 위한 어댑터로 유지한다. `COLLECTOR=manual` 이 기본.

### 배치 1에 포함된 것
- `schema/` — §8 데이터 모델 JSON Schema(공통 `_meta`/`anchor`/`ai_content` + 레코드 6종). 앵커 인용문 폴백 규칙 포함.
- `pipeline/collectors/` — 수집기 어댑터(`Collector` 인터페이스 + `S1Collector` 스텁 + `ManualCollector` 폴백).
- `pipeline/normalize.ts` · `ai-drafter.ts` — 정규화, AI Drafter 인터페이스(시스템 프롬프트 + Mock/dry-run).
- `pipeline/verifier/` — **스크리닝 계층**(근거 대조·금지 어휘·앵커 무결성) + DoD 단위 테스트.
- `pipeline/run.ts` · `differ.ts` — 오케스트레이션, 변경 감지.
- `scripts/validate-data.ts` — CI 스키마 검증(실패 시 빌드 중단).
- `scripts/g0-smoke-test.ts` — 인증키 도착 즉시 G0 완료용 실호출 리포트.
- `config/` — `forbidden-terms.json`(금지 어휘), `gazetteer.json`(신안 14개 읍면·섬).
- `.github/workflows/` — 검증·파이프라인 CI 골격.

### 배치 2 이후 (비범위)
- 프론트엔드 F1~F8, Pagefind 검색, AI 요약 라벨·원문 대조 토글, AI 투명성 페이지(§14-5).
- 실제 A1 배치 생성 + **§12-3 AI 품질 파일럿**(Verifier 오탐/미탐·검수 시간·비용 실측).
- A7/A8 런타임 RAG, A9 TTS, 카카오톡·인쇄 채널(§16).
- **⚠️ 사이트 공개 전 필수(사람 작업, 코드로 대체 불가):**
  - §12-G0 인증키 실증 완료 → 파이프라인 방향 확정.
  - §15 법률 검토(공직선거법·저작권·명예훼손) + §15-3 선거 기간 운영 정책.
  - §12-4 회기 중 검수자 최소 2인 확보.

## 설계 원칙 (§0 — 충돌 시 항상 우선)
1. 중립성 2. 사실 기반(1차 출처만) 3. 양방향 공개(의회+집행부) 4. 데이터 포털이지 점수판 아님
5. 전수 수록 6. 무검수 게시 금지(런타임 AI A7·A8만 §14-7 통제 하 예외) 7. 읽어주는 AI, 판단하지 않는 AI

## 개발

```bash
npm install
npm test            # Verifier DoD 테스트
npm run validate    # §8 스키마 검증
npm run pipeline    # 수기 폴백으로 수집→검증 흐름(.pipeline-out/ 스테이징)
npm run build       # Astro 정적 빌드
npm run g0          # (인증키 확보 후) S1 신안군 커버리지 실증
```

자세한 파이프라인 운영: [docs/pipeline.md](docs/pipeline.md)
