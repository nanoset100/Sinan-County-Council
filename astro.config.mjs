// @ts-check
import { defineConfig } from 'astro/config';

// 배치 1: 데이터·파이프라인 중심. Astro는 SSG 껍데기로만 설정한다.
// 프론트엔드(F1~F8) 페이지는 배치 2에서 src/pages 아래에 구현한다.
// site 값은 배포 도메인 확정 시 교체.
export default defineConfig({
  site: 'https://example.invalid',
  output: 'static',
  build: {
    format: 'directory',
  },
});
