import { getGlossary, type GlossaryTerm } from "./content";

/**
 * 행정용어 주석 (A5, PRD §7-B) — 고정 사전으로 평문에 term 툴팁을 단다(런타임 생성 아님).
 * 사전에 있는 용어를 텍스트에서 찾아 <span class="term" title="설명"> 로 감싼 HTML 을 만든다.
 * 원문 변형 없이 표시 계층에서만 주석한다.
 */
export function annotateGlossary(text: string, glossary: GlossaryTerm[] = getGlossary()): string {
  const escaped = escapeHtml(text);
  // 긴 용어부터 치환(부분 겹침 방지). 이미 감싼 구간은 건드리지 않도록 1회 패스로 처리.
  const terms = [...glossary].sort((a, b) => b.term.length - a.term.length);
  let result = escaped;
  for (const t of terms) {
    const needle = escapeHtml(t.term);
    // 이미 title= 안에 들어간 경우를 피하려 단순 분할 치환 사용.
    result = replaceOutsideTags(result, needle, (m) =>
      `<span class="term" tabindex="0" title="${escapeHtml(t.plain)}">${m}</span>`,
    );
  }
  return result;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 이미 생성된 <span ...> 태그 내부는 건드리지 않고 텍스트 노드에서만 치환. */
function replaceOutsideTags(html: string, needle: string, wrap: (m: string) => string): string {
  const parts = html.split(/(<[^>]+>)/); // 태그와 텍스트를 번갈아 분리
  return parts
    .map((seg) => (seg.startsWith("<") ? seg : seg.split(needle).join(wrap(needle))))
    .join("");
}
