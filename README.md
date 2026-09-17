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
