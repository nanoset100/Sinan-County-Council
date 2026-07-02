import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NormalizedRecord } from './normalize.js';

/**
 * 변경 감지 (PRD v0.4 §6-⑤).
 *
 * 새 정규화 레코드를 기존 data/<kind>/<id>.json 과 비교해 신규/변경/무변경을 판정한다.
 * 실제 PR 생성은 GitHub Actions(.github/workflows/pipeline.yml)에서 이 결과로 수행한다.
 *
 * 해시는 _meta 의 휘발성 필드(collected_at 등)를 제외하고 계산해, 재수집만으로 '변경'이
 * 뜨지 않게 한다.
 */

export type DiffStatus = 'new' | 'changed' | 'unchanged';

const KIND_DIR: Record<NormalizedRecord['kind'], string> = {
  agenda: 'agendas',
  meeting: 'meetings',
  member: 'members',
  executive: 'executives',
};

export interface DiffEntry {
  kind: NormalizedRecord['kind'];
  id: string;
  status: DiffStatus;
}

export async function diffRecord(n: NormalizedRecord): Promise<DiffEntry> {
  const id = String((n.record as { id?: unknown }).id ?? 'UNKNOWN');
  const dir = KIND_DIR[n.kind];
  const path = join(process.cwd(), 'data', dir, `${id}.json`);

  let existing: unknown;
  try {
    existing = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return { kind: n.kind, id, status: 'new' };
  }

  const same = stableHash(n.record) === stableHash(existing);
  return { kind: n.kind, id, status: same ? 'unchanged' : 'changed' };
}

/** _meta 휘발성 필드를 제외한 안정 해시. */
function stableHash(record: unknown): string {
  const clone = JSON.parse(JSON.stringify(record)) as { _meta?: Record<string, unknown> };
  if (clone._meta) {
    delete clone._meta.collected_at;
    delete clone._meta.source_alive;
  }
  return createHash('sha256').update(canonical(clone)).digest('hex');
}

/** 키 정렬 직렬화(속성 순서 무관 비교). */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}
