import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 콘텐츠 로더 (PRD v0.5) — 빌드 시 data/ 의 게시 레코드를 읽는다.
 *
 * 실데이터가 아직 없어(신안군 제10대 개원 직후) 개발 미리보기용 fixtures/ 를 함께 로드하고,
 * fixtures 유래 레코드는 isSample=true 로 표시해 UI 가 "샘플" 배지를 달게 한다.
 * 배포 시에는 SITE_FIXTURES=0 으로 끈다(실데이터만 게시).
 */

const ROOT = process.cwd();

/**
 * 픽스처(샘플·가상 데이터)는 절대 프로덕션 빌드에 새어들면 안 된다(중립성 §0-1).
 * ★ fail-closed: 기본은 OFF. 오직 개발 서버(astro dev → NODE_ENV=development)이거나
 *   명시적으로 SITE_FIXTURES=1 일 때만 로드한다. astro build·CI·NODE_ENV 미설정은 전부 차단.
 *   SITE_FIXTURES=0 은 개발 중에도 강제 OFF.
 */
const USE_FIXTURES =
  process.env.SITE_FIXTURES === '1' ||
  (process.env.SITE_FIXTURES !== '0' && process.env.NODE_ENV === 'development');

export interface Anchor { url: string; fragment?: string; quote?: string }
export interface AiContent {
  generated_at: string; model: string; verifier_passed: boolean;
  reviewed_by: string | null; reviewed_at: string | null;
  summary_one_line: string;
  what_changes?: Array<{ text: string; anchor: Anchor }>;
  who_affected?: { text: string; anchor: Anchor };
}
export interface Meta {
  source_url: string; source_system: string; snapshot_path?: string | null;
  source_alive?: boolean; collected_at: string;
  reviewed_by?: string | null; reviewed_at?: string | null;
}
export interface Sampleable { isSample?: boolean }

export interface Agenda extends Sampleable {
  id: string; title: string; bill_no?: string | null; type: string;
  proposer: { type: string; raw: string }; outline: string;
  timeline: Array<{ stage: string; date?: string | null; result?: string | null; no?: string | null }>;
  votes: { recorded: boolean; records: unknown[] };
  related_members?: string[]; related_dept?: string | null; related_meetings?: string[];
  region_tags?: string[]; files?: string[];
  ai_content?: AiContent; _meta: Meta;
}
export interface Member extends Sampleable {
  id: string; name: string; photo_url?: string | null; district?: string | null;
  party?: string | null; term: string; committees?: string[]; links?: string[]; _meta: Meta;
}
export interface Meeting extends Sampleable {
  id: string; date: string; type: string; session?: string | null;
  agendas?: string[]; minutes_html?: string | null; minutes_url: string; _meta: Meta;
}
export interface Executive extends Sampleable {
  id: string; dept: string; title: string; date: string;
  related_agendas?: string[]; region_tags?: string[]; ai_content?: AiContent; _meta: Meta;
}
export interface GlossaryTerm { term: string; plain: string }

function loadDir<T>(kind: string): T[] {
  const out: T[] = [];
  const sources: Array<{ dir: string; sample: boolean }> = [
    { dir: join(ROOT, 'data', kind), sample: false },
  ];
  if (USE_FIXTURES) sources.push({ dir: join(ROOT, 'fixtures', kind), sample: true });

  for (const { dir, sample } of sources) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json') || file.startsWith('_')) continue;
      const raw = readFileSync(join(dir, file), 'utf8').replace(/^﻿/, '');
      const rec = JSON.parse(raw) as T & Sampleable;
      if (sample) rec.isSample = true;
      out.push(rec);
    }
  }
  return out;
}

export const getAgendas = (): Agenda[] =>
  loadDir<Agenda>('agendas').sort((a, b) => firstDate(b).localeCompare(firstDate(a)));
export const getAgenda = (id: string): Agenda | undefined => getAgendas().find((a) => a.id === id);

export const getMembers = (): Member[] =>
  loadDir<Member>('members').sort((a, b) => a.name.localeCompare(b.name, 'ko'));
export const getMember = (id: string): Member | undefined => getMembers().find((m) => m.id === id);

export const getMeetings = (): Meeting[] =>
  loadDir<Meeting>('meetings').sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
export const getMeeting = (id: string): Meeting | undefined => getMeetings().find((m) => m.id === id);

export const getExecutives = (): Executive[] =>
  loadDir<Executive>('executives').sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

export function getGlossary(): GlossaryTerm[] {
  const path = join(ROOT, 'data', 'glossary.json');
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) as GlossaryTerm[];
}

/** 안건의 대표 날짜(제안일 우선) — 정렬용. */
export function firstDate(a: Agenda): string {
  return a.timeline?.find((t) => t.date)?.date ?? a._meta?.collected_at ?? '';
}

/** 게시(검수 완료) 여부 — reviewed_by 존재. 샘플은 미검수로 간주. */
export function isReviewed(meta: Meta): boolean {
  return !!meta.reviewed_by;
}

/** A1 요약이 게시 가능한 상태인지(§14-2): verifier 통과 + 검수 완료. */
export function hasPublishableSummary(ai?: AiContent): boolean {
  return !!ai && ai.verifier_passed && !!ai.reviewed_by;
}

/** 사이트에 샘플 데이터가 하나라도 섞여 있는지(개발 배너용). */
export function hasSampleData(): boolean {
  return USE_FIXTURES && (
    getAgendas().some((x) => x.isSample) ||
    getMembers().some((x) => x.isSample) ||
    getMeetings().some((x) => x.isSample)
  );
}
