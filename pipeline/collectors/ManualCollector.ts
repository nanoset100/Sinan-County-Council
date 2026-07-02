import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Collector } from './Collector.js';
import type { RawRecord, RecordKind } from '../types.js';

/**
 * 수기 주도형 폴백 수집기 (PRD v0.4 §6 폴백).
 *
 * data/manual-input/*.json 을 읽는다. 각 파일은 아래 형태의 배열:
 *   [{ "kind": "agenda", "sourceUrl": "...", "sourceText": "...", "snapshotPath": null, "data": { ...§8 스키마 필드... } }]
 *
 * G0 실패 시에도 §5(축소 재정의) 범위로 즉시 운영 가능. 운영자 입력 폼의 산출물이 이 형태다.
 */

const INPUT_DIR = join(process.cwd(), 'data', 'manual-input');
const VALID_KINDS: RecordKind[] = ['agenda', 'meeting', 'member', 'executive'];

interface ManualEntry {
  kind: RecordKind;
  sourceUrl: string;
  sourceText?: string;
  snapshotPath?: string | null;
  data: Record<string, unknown>;
}

export class ManualCollector implements Collector {
  readonly name = 'ManualCollector(data/manual-input)';

  async collectBills(): Promise<RawRecord[]> {
    return this.collectKind('agenda');
  }

  async collectMinutes(): Promise<RawRecord[]> {
    return this.collectKind('meeting');
  }

  async collectMembers(): Promise<RawRecord[]> {
    return this.collectKind('member');
  }

  private async collectKind(kind: RecordKind): Promise<RawRecord[]> {
    const entries = await this.readAllEntries();
    return entries
      .filter((e) => e.kind === kind)
      .map((e) => ({
        kind: e.kind,
        source: 'MANUAL' as const,
        sourceUrl: e.sourceUrl,
        snapshotPath: e.snapshotPath ?? null,
        data: e.data,
        sourceText: e.sourceText ?? '',
      }));
  }

  private async readAllEntries(): Promise<ManualEntry[]> {
    let files: string[];
    try {
      files = (await readdir(INPUT_DIR)).filter((f) => f.endsWith('.json'));
    } catch {
      return []; // 입력 폴더가 아직 없으면 빈 수집(정상)
    }

    const all: ManualEntry[] = [];
    for (const file of files) {
      const raw = await readFile(join(INPUT_DIR, file), 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(`수기 입력 JSON 파싱 실패 (${file}): ${(err as Error).message}`);
      }
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        this.assertEntry(item, file);
        all.push(item as ManualEntry);
      }
    }
    return all;
  }

  private assertEntry(item: unknown, file: string): void {
    if (!item || typeof item !== 'object') {
      throw new Error(`수기 입력 형식 오류 (${file}): 객체가 아님`);
    }
    const e = item as Record<string, unknown>;
    if (!VALID_KINDS.includes(e.kind as RecordKind)) {
      throw new Error(`수기 입력 kind 오류 (${file}): "${String(e.kind)}" (허용: ${VALID_KINDS.join(', ')})`);
    }
    if (typeof e.sourceUrl !== 'string' || e.sourceUrl.length === 0) {
      throw new Error(`수기 입력 sourceUrl 누락 (${file}) — 원문 링크는 필수(§2 사실 기반)`);
    }
    if (!e.data || typeof e.data !== 'object') {
      throw new Error(`수기 입력 data 누락 (${file})`);
    }
  }
}
