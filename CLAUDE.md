# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

세부 규칙은 `.claude/rules/`에 파일별로 나뉘어 있고, 해당 경로의 파일을 읽을 때 자동으로 로드된다(anilist / kitsu-syoboi / jikan / books-webnovel / ui). 이 문서에는 항상 지켜야 할 것만 둔다.

## Overview

일본 애니메이션 방영 정보(요일별 편성, 신작, 검색)와 일본 만화·라이트노벨·웹소설 순위(IP 발굴용)를 보여주는 **완전한 정적 웹사이트**. 빌드 도구·프레임워크·백엔드 API 없이 Vanilla JS/CSS로 작성되어 있고, 브라우저가 세 데이터 소스 클라이언트(`public/anilistClient.js`/`kitsuClient.js`/`jikanClient.js`)로 각 API를 **직접** 호출한다(셋 다 `Access-Control-Allow-Origin: *`).

**데이터 소스는 사용자가 화면 상단 버튼으로 직접 고른다**(AniList → Kitsu → Jikan 순, 기본값 **AniList**). 세 클라이언트는 완전히 독립적이다 — 선택한 API가 실패하면 그 API 자체의 Mock으로만 대체하고 다른 API를 대신 호출하지 않는다.

`server.js`는 로컬 미리보기용 정적 서버일 뿐이며 배포에는 `public/`만 있으면 된다.

## 항상 지킬 규칙

- **백엔드 API 레이어(`services/`, `/api/*` 라우트)를 다시 추가하지 말 것** — 전량 클라이언트 사이드로 이전하며 제거됐다.
- **Claude Artifact 게시로는 배포할 수 없다** — Artifact 샌드박스 CSP가 `api.jikan.moe`/`kitsu.io`/`graphql.anilist.co` 호출을 차단해 Mock만 보인다. GitHub Pages/Netlify/Vercel 등 실제 정적 호스팅에 `public/`를 배포한다.
- **JS/CSS는 `vercel.json`에서 immutable 장기 캐시**다. `public/*.js`/`style.css`를 고치면 `index.html`의 `?v=` 쿼리를 올려야 사용자에게 반영된다. 단, **데이터 파일(`syoboi-schedule.js`, `webnovel-ranking.js`)에는 `?v=`/immutable 캐시를 붙이지 않는다**(매일 바뀜).
- 세 클라이언트는 **서로를 호출하지 않는다**. 공통 유틸(날짜/요일 변환 등)은 각자 중복 구현하는 것이 프로젝트 관례다(예외: 데이터 유틸 `syoboiSchedule.js`).
- 날짜 문자열 파싱은 항상 `Date.UTC`/`getUTC*`로 한다(`new Date('YYYY-MM-DD')` + 로컬 getter는 타임존에 따라 하루 밀린다).
- 정적 데이터 스냅샷(Syoboi, 웹소설)은 JSON+`fetch`가 아니라 **`window.X = {...}`를 대입하는 JS 파일 + `<script src>`**다(`file://`에서 fetch가 막힘). 되돌리지 말 것.
- **`category`(카테고리)는 값은 채우되 화면에는 표시하지 않는다**(사용자 요청). 새 렌더링에서 다시 노출하지 말 것.
- 값이 없는 지표/필드는 항목을 숨기지 말고 "정보 없음"으로 표시한다.
- 각 탭 제목 옆 상태 배지(`updateSourceStatus`: 실시간 초록/Mock 주황/오류 빨강)를 새 소스·탭에서도 빠뜨리지 말 것.
- 요일별 표의 `RATING_COLUMNS` / `RATING_SORTABLE_HEADERS` / `createRatingRow` **세 곳의 셀 순서를 항상 맞출 것**(어긋나면 정렬·고정 컬럼 오프셋이 깨진다).
- `.hidden`과 함께 쓰는 컴포넌트에 자체 `display` 규칙을 추가할 때는 `.컴포넌트.hidden { display: none; }` override 규칙을 함께 추가한다(안 하면 투명 오버레이가 클릭을 가로채는 회귀가 있었다).
- 비밀값(Vercel Deploy Hook URL `VERCEL_DEPLOY_HOOK_URL`, API 키)은 코드/채팅에 쓰지 말고 GitHub Secrets에만 둔다.
- 오리콘 등 데이터 전재가 금지된 곳은 가져오지 않는다(링크만 가능). 카쿠요무는 개인 확인용으로만 쓴다.
- Git: 기존 작업은 별도 브랜치에서 하고, 푸시/master 병합은 사용자가 명시적으로 요청할 때만 한다(master 푸시 = Vercel 프로덕션 배포).

## Commands

- 의존성 설치: `npm install`
- 로컬 미리보기: `npm start` (http://localhost:3000), 개발 모드: `npm run dev`
- 배포 빌드: `npm run build` (= Syoboi 편성표 + 웹소설 스냅샷 갱신, `--soft`라 실패해도 빌드는 성공)
- 수동 갱신: `npm run build:syoboi`, `npm run build:webnovel`

테스트 스위트는 없다. `public/*.js`를 고친 뒤 `node -c public/파일명.js`로 문법만 확인하고, 브라우저(Claude in Chrome 등)로 실제 렌더링/네트워크 요청을 확인하는 것이 유일한 검증 수단이다.

## Architecture (파일 한 줄 요약)

- `public/index.html` — 3개 탭(요일별 / 분기 신작 TV / 분기 신작 ONA 등 / 검색) + 상단 모드 전환(애니메이션 / 만화·소설 순위). `<script>` 순서: `syoboiSchedule.js` → `anilistClient.js` → `kitsuClient.js` → `jikanClient.js` → `app.js`; `multiSelect.js`는 `booksApp.js`/`webNovelApp.js`/`onaApp.js`보다 먼저, `booksApp.js`는 `app.js` 뒤.
- `public/anilistClient.js` / `kitsuClient.js` / `jikanClient.js` — 각 API 클라이언트. `window.AniListClient`/`KitsuClient`/`JikanClient`가 `getWeeklyRatings(endDate)`, `getNewReleases(endDate)`, `searchAnimeByTitle(title)`, `checkStatus()`를 **동일 시그니처**로 노출한다.
- `public/app.js` — DOM 렌더링/이벤트. `CLIENT_GETTERS`로 `activeSource`에 해당하는 클라이언트를 골라 호출하고 결과를 그리기만 한다. 상단 소스 버튼 옆 점(`updateSourceDot`)은 각 API 생존 여부 진단.
- `public/onaApp.js` — 분기 신작 (ONA 등) 탭. `public/booksApp.js` — 만화·소설 순위 화면(AniList 전용). `public/webNovelApp.js` — 웹소설 랭킹 화면.
- `public/multiSelect.js` — 다중 선택 필터 공용 모듈(`window.MultiSelect.create({ id, options, onChange })`). 아무것도 안 고르면 전체, 한 필터 안에서는 OR, 서로 다른 필터끼리는 AND. `setOptions`는 `onChange`를 부르지 않는다(호출한 쪽이 `getValues()`로 맞춘다).
- `public/syoboiSchedule.js` — Syoboi 편성표 매칭/병합 공용 모듈. `public/tablePan.js` — 표 드래그 이동.
- `scripts/build-syoboi.js` → `public/syoboi-schedule.js`, `scripts/build-webnovel.js` → `public/webnovel-ranking.js` — 오프라인 스냅샷 생성 스크립트와 산출물. `.github/workflows/refresh-syoboi.yml`이 매주 월요일 04:00 JST에 Vercel Deploy Hook을 호출해 재배포(→ 스냅샷 갱신)한다.
- `public/style.css` — 외부 UI 라이브러리 없는 Vanilla CSS. 컨테이너는 `width:100%`.
- `server.js` — `express.static`으로 `public/`만 서빙. API 라우트 없음.

### 공통 데이터 필드

세 클라이언트 모두 요일별/신작/검색 항목에 `category`, `genres`, `themes`(최대 5개), `coverImage`, `airingState`, `firstAirDate` 등을 채운다(값이 없으면 `null`/빈 배열/`'정보 없음'`). 소스별 매핑 차이는 각 `rules/*.md` 참고.
