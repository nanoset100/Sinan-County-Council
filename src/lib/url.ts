/**
 * 렌더링되는 링크 href 를 http/https 로만 제한한다(공개 사이트 방어).
 * 운영자 검수 데이터라도 `javascript:` 등 위험 스킴이 href 에 들어가면 실행될 수 있으므로,
 * http(s) 가 아니면 '#' 를 반환한다.
 */
export function safeHref(url: string | null | undefined): string {
  if (typeof url !== "string") return "#";
  const u = url.trim();
  return /^https?:\/\//i.test(u) ? u : "#";
}
