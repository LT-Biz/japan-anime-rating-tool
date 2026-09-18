# 일본 애니메이션 방영 정보

일본 애니메이션의 요일별 편성, 분기 신작, 검색 정보를 보여주는 **완전한 정적 웹사이트**입니다. 빌드 도구나 백엔드 서버 없이 Vanilla JS/CSS로 작성되어 있으며, 브라우저가 아래 세 데이터 소스를 사용자가 선택한 대로 **직접** 호출합니다.

- [AniList GraphQL API](https://docs.anilist.co/) (기본 소스)
- [Kitsu API](https://kitsu.docs.apiary.io/)
- [Jikan REST API v4](https://docs.api.jikan.moe/) (MyAnimeList 비공식 오픈 API)

세 API 모두 CORS를 전면 허용하므로 별도의 백엔드 프록시 없이 동작합니다.

## 폴더 구조

```
.
├── public/                  # 실제 배포에 필요한 전부 (정적 사이트 루트)
│   ├── index.html           # 화면 구조 (요일별 편성 / 분기 신작 / 검색 탭)
│   ├── style.css            # Vanilla CSS 스타일
│   ├── anilistClient.js     # AniList GraphQL API 클라이언트 (기본 데이터 소스)
│   ├── kitsuClient.js       # Kitsu API 클라이언트
│   ├── jikanClient.js       # Jikan REST API 클라이언트
│   └── app.js                # DOM 렌더링 및 이벤트 처리, 데이터 소스 선택 로직
├── server.js                 # 로컬 미리보기용 정적 파일 서버 (배포에는 불필요)
├── package.json
├── vercel.json                # Vercel 정적 배포 설정 (outputDirectory: public)
└── CLAUDE.md                  # 상세 아키텍처/설계 문서 (Claude Code용)
```

> 세 클라이언트는 서로를 호출하지 않는 독립적인 구조입니다. 어떤 API를 쓸지는 화면 상단 버튼으로 사용자가 직접 고릅니다(기본값: AniList).

## 로컬에서 실행하기

```bash
npm install
npm start        # http://localhost:3000
```

파일 변경을 자동으로 감지해 재시작하려면:

```bash
npm run dev
```

빌드 단계나 테스트 스위트는 없습니다. `public/*.js`를 수정한 뒤에는 `node -c public/파일명.js`로 문법만 빠르게 확인하고, 브라우저에서 직접 렌더링/네트워크 요청을 확인하는 것이 유일한 검증 수단입니다.

## 배포하기

이 사이트는 완전한 정적 사이트이므로 `public/` 폴더만 있으면 어떤 정적 호스팅에도 그대로 올릴 수 있습니다.

### Vercel (권장)

1. 이 저장소를 GitHub에 올린 뒤, [Vercel](https://vercel.com)에서 "Import Project"로 저장소를 연결합니다.
2. 프레임워크는 자동 감지가 안 될 경우 "Other"를 선택하고, `vercel.json`의 `outputDirectory: "public"` 설정에 따라 빌드 명령 없이 `public/` 폴더가 그대로 배포됩니다.
3. 배포가 끝나면 발급되는 `*.vercel.app` 주소로 접속할 수 있습니다.

### 기타 정적 호스팅

- **GitHub Pages**: `public/` 폴더 안의 파일들을 저장소 루트(또는 `gh-pages` 브랜치)에 두고 Pages 설정에서 배포 브랜치를 지정합니다.
- **Netlify Drop**: [app.netlify.com/drop](https://app.netlify.com/drop)에 `public/` 폴더를 드래그 앤 드롭하면 즉시 배포됩니다.

> ⚠️ Claude의 Artifact 게시 기능으로는 배포할 수 없습니다 — Artifact 샌드박스 CSP가 `api.jikan.moe`/`kitsu.io`/`graphql.anilist.co`로의 외부 요청을 차단해 Mock 데이터만 표시됩니다. 반드시 위 방법 중 하나로 실제 정적 호스팅에 배포해야 합니다.

## 데이터 소스 관련 참고사항

- 화면 상단에서 AniList / Kitsu / Jikan 중 하나를 직접 선택할 수 있으며, 선택한 API 호출이 실패하면 해당 API의 Mock 데이터로만 대체됩니다(다른 API로 자동 전환되지 않음).
- 각 API의 세부 로직, 한계, 트러블슈팅은 [`CLAUDE.md`](./CLAUDE.md)에 자세히 정리되어 있습니다.

## 알려진 이슈: 간헐적 `ERR_CONNECTION_TIMED_OUT`

배포된 `*.vercel.app` 주소에 접속할 때 간헐적으로(특히 여러 명이 동시에 접속할 때) `ERR_CONNECTION_TIMED_OUT`이 발생한다는 리포트가 있었다. 직접 확인한 내용:

- `curl`로 응답 헤더를 확인한 결과 `Server: Vercel`, `X-Vercel-Cache: HIT`로 정적 파일이 정상적으로 서빙되고 있었고, 서버리스 함수로 오탐지되는 문제(과거 `ecb63a3` 커밋에서 수정)도 재발하지 않았다.
- 동일 URL에 30개 동시 요청을 보내도 전부 60~150ms 안에 200 OK로 응답했다 — Vercel Edge 자체의 처리 용량 문제는 아니다.
- 외부 폰트/CDN 의존성도 없어(전부 동일 출처 5개 요청) 페이지 하나를 띄우는 데 필요한 요청 자체는 이미 최소한이다.

즉 **이 저장소의 애플리케이션 코드나 Vercel 설정 결함이 원인이 아니라, 접속자 측 네트워크 경로 문제일 가능성이 높다.** 증상 패턴(간헐적, 동시 접속자가 많을 때 심함, 시크릿모드에서는 가끔 정상 접속)은 주로 다음 두 가지 중 하나에서 나타난다:

1. 회사망의 방화벽/프록시/보안 에이전트가 `*.vercel.app` 같은 공용 호스팅 서브도메인을 차단·감속하는 경우 (시크릿모드는 일부 보안 확장이 기본적으로 비활성화되어 우회되곤 한다).
2. 국내 ISP와 Vercel Edge(특히 `icn1` 리전) 사이의 피어링이 간헐적으로 불안정한, 국내에서 잘 알려진 사례.

두 원인 모두 **커스텀 도메인 연결(및 필요 시 Cloudflare 프록시) 또는 사내 IT의 방화벽 허용 목록 등록**처럼 이 저장소 밖의 인프라 작업이 필요하며, 코드만으로는 근본 해결이 불가능하다. 이번 브랜치(`fix/connection-timeout-caching`)에서는 그중 **코드로 가능한 부분만** 개선했다:

- `vercel.json`에 정적 자산(`app.js`/`style.css`/`*Client.js`)에 대해 `Cache-Control: public, max-age=31536000, immutable`을 지정해, 재방문 시 매번 발생하던 재검증(revalidate) 왕복 요청을 없앴다. 배포마다 내용이 바뀌면 `index.html`의 `?v=1` 쿼리스트링 버전을 반드시 올릴 것(안 올리면 캐시된 옛 파일이 최대 1년간 계속 서빙된다).
- `index.html`의 스크립트 태그에 `defer`를 추가해 4개 스크립트가 순차 차단 없이 병렬로 로드되도록 했다(실행 순서는 기존과 동일하게 문서 순서를 따른다).

이 변경은 재접속 시 필요한 왕복 요청 수와 페이지 로드 시간을 줄여 증상 발생 빈도를 낮추는 데는 도움이 되지만, 접속 자체가 막히는 근본 원인(위 1·2번)을 없애지는 못한다. 계속 재발하면 커스텀 도메인 연결 또는 사내 IT 문의를 진행해야 한다.
