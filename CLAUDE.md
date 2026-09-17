# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

일본 애니메이션 방영 정보(요일별 편성, 신작, 검색)를 보여주는 **완전한 정적 웹사이트**("일본 애니메이션 방영 정보"). 빌드 도구·프레임워크·백엔드 API 없이 Vanilla JS/CSS로 작성되어 있고, 브라우저가 세 데이터 소스 클라이언트(`public/anilistClient.js`/`public/kitsuClient.js`/`public/jikanClient.js`)를 통해 각 API를 **직접** 호출한다. 셋 다 `Access-Control-Allow-Origin: *`를 응답하므로 별도 백엔드 프록시 없이 브라우저에서 바로 호출 가능하다(직접 curl로 확인).

**데이터 소스는 사용자가 화면 상단 버튼으로 직접 고른다** — [AniList GraphQL API](https://docs.anilist.co/) / [Kitsu API](https://kitsu.docs.apiary.io/) / [Jikan REST API v4](https://docs.api.jikan.moe/)(MyAnimeList 비공식 오픈 API) 순서로 버튼이 나열되며, 기본값(최초 진입 시)은 **AniList**다. 과거에는 "Jikan 실패 시 Kitsu로 자동 대체"하는 폴백 체인이었지만, 지금은 그 구조를 걷어내고 세 클라이언트가 완전히 독립적으로 동작한다 — 선택한 API 호출이 실패하면 그 API 자체의 Mock 데이터로만 대체되고, 다른 API를 대신 호출하지 않는다.

`server.js`는 로컬 미리보기용 정적 파일 서버일 뿐이며, 배포 시에는 `public/` 폴더만 있으면 된다(GitHub Pages, Netlify 등 아무 정적 호스팅에 그대로 올릴 수 있음). 이 프로젝트에 백엔드 API 레이어(예: `services/`, `/api/*` 라우트)를 다시 추가하지 말 것 — 과거에 있었으나 전량 클라이언트 사이드로 이전하며 제거되었다.

**중요**: Claude 자체의 Artifact 게시 기능으로는 이 앱을 배포할 수 없다 — Artifact 샌드박스의 CSP가 허용 목록에 없는 외부 도메인으로의 `fetch`/`XHR`를 전면 차단하므로(`api.jikan.moe`/`kitsu.io`/`graphql.anilist.co` 모두 허용 목록에 없음), Artifact에 게시하면 API 호출이 조용히 실패해 Mock 데이터만 보이게 된다. 반드시 GitHub Pages/Netlify Drop/Vercel 등 실제 정적 호스팅에 `public/` 폴더를 배포해야 한다.

## Commands

- 의존성 설치: `npm install`
- 로컬 미리보기: `npm start` (http://localhost:3000, 단순 정적 파일 서빙)
- 개발 모드(파일 변경 감지 자동 재시작): `npm run dev`

빌드 단계나 테스트 스위트는 없다. `public/*.js` 파일을 수정한 뒤에는 `node -c public/파일명.js`로 문법만 빠르게 확인하고, 브라우저(Claude in Chrome 등)로 실제 렌더링/네트워크 요청을 확인하는 것이 유일한 검증 수단이다.

## Architecture

- `public/anilistClient.js` — [AniList GraphQL API](https://docs.anilist.co/)(https://graphql.anilist.co, 단일 POST 엔드포인트) 클라이언트. **기본(최초) 데이터 소스**. IIFE로 감싸 `window.AniListClient`에 `getWeeklyRatings(endDate)`, `getNewReleases(endDate)`, `searchAnimeByTitle(title)`, `checkStatus()` 네 함수를 노출한다(다른 두 클라이언트와 완전히 동일한 시그니처).
- `public/kitsuClient.js` — [Kitsu API](https://kitsu.docs.apiary.io/) 클라이언트. `window.KitsuClient`에 AniList/Jikan과 동일한 시그니처를 노출한다. JSON:API 포맷(`included` 배열 + relationships 포인터)이라 스튜디오/장르/카테고리 이름을 얻으려면 `include=` 파라미터로 관계를 같이 가져와 직접 조인해야 한다(`buildIncludedIndex`/`resolveRelationshipList` 참고).
- `public/jikanClient.js` — Jikan REST API v4(MyAnimeList 비공식 오픈 API) 클라이언트. `window.JikanClient`에 동일한 시그니처를 노출한다.
- 세 클라이언트는 **서로를 호출하지 않는다** — 각자 자기 API 호출에 실패하면(요일별/신작은) 자체 Mock 데이터로, (검색은) 명확한 에러로 대체할 뿐이다. 어떤 API를 쓸지는 오직 `app.js`의 `activeSource` 상태(사용자가 상단 버튼으로 선택)가 결정한다. 세 파일은 프로젝트 관례대로 날짜/요일 변환 등 공통 유틸을 각자 중복 구현한다(공유 모듈 없음).
- `public/app.js` — DOM 렌더링과 이벤트 처리. `CLIENT_GETTERS`로 세 클라이언트 중 `activeSource`에 해당하는 것을 골라 호출하고, 그 반환값을 받아 화면을 그리기만 한다. 각 탭 제목 옆 상태 배지(`updateSourceStatus`)로 실시간 연동/Mock 대체/오류 여부를 표시하고, 상단 소스 버튼 옆 점(`updateSourceDot`)으로 각 API의 생존 여부를 표시한다.
- `public/index.html` — 3개 탭 구조: 요일별 방영 애니메이션 / 분기 신작 애니메이션 / 애니메이션 검색. `<script>` 로드 순서는 `anilistClient.js` → `kitsuClient.js` → `jikanClient.js` → `app.js`(세 클라이언트끼리는 서로 호출하지 않으므로 상호 순서 자체는 무관하지만, 화면 버튼 순서와 맞춰뒀다).
- `public/style.css` — 외부 UI 라이브러리 없는 Vanilla CSS. 컨테이너는 `width:100%`로 브라우저 폭에 동적으로 맞춘다(고정 `max-width` 없음).
- `server.js` — `express.static`으로 `public/`만 서빙하는 로컬 미리보기 서버. API 라우트 없음.

### 공통 데이터 필드

세 클라이언트 모두 요일별/신작/검색 항목에 다음 필드를 채운다(값이 없으면 `null`/빈 배열/`'정보 없음'`):

- `category` — 작품 형태(TV/극장판/OVA/ONA/스페셜/뮤직 등). 각 클라이언트에 동일한 모양의 `CATEGORY_LABELS` 맵과 `formatCategory()`가 중복 구현돼 있다(Jikan `anime.type`, Kitsu `attrs.subtype`, AniList `media.format`을 소스로 함).
- `genres` — 장르 배열.
- `themes` — 테마/소재 태그 배열(최대 5개 정도로 자름). Jikan은 `themes`+`demographics`, Kitsu는 `categories` 관계(장르보다 더 세분화된 태그), AniList는 `tags`(스포일러 태그 제외, rank 상위 5개)를 사용 — API마다 성격이 달라 완전히 대응되는 개념은 아니다.
- `coverImage` — 커버 이미지 URL(없으면 `null`). `app.js`의 `createCoverCell`/`createAnimeCard`가 40×56(표)·64×90(카드) 축소본으로 렌더링하고, 클릭하면 `openImageModal()`로 원본을 팝업(`#imageModal`)에 띄운다.

- `category`(카테고리)는 세 클라이언트 모두 값은 채우지만 **화면에는 표시하지 않는다**(요일별 표/신작 표/검색 카드에서 "카테고리" 컬럼·필드를 모두 제거함 — 사용자 요청). 새 렌더링 코드를 추가할 때 이 필드를 다시 노출하지 말 것.

`app.js`의 `appendTagListContent(container, item)`이 `genres`+`themes`를 합쳐 앞 4개만 텍스트로 보여주고, 남은 게 있으면 전체 목록을 보여주는 `+N` 버튼(`.tag-expand-btn`)을 붙인다 — 요일별 표의 "장르/테마" 컬럼(`createTagListCell`), 신작 표, 검색 카드(`createTagListDetailField`)가 모두 이 함수를 공유한다. 버튼을 누르면 `openTagListModal(item)`이 전체 장르(파란 칩)/테마(회색 칩) 목록을 화면 중앙 팝업(`#tagListModal`)에 띄운다 — 이미지 팝업과 달리 팝업 바깥(배경) 클릭이나 `×` 버튼으로만 닫히고, 팝업 내용 클릭으로는 닫히지 않는다(텍스트를 읽는 용도라 실수로 안 닫히게 함). `formatTagList(item)`은 렌더링용이 아니라 요일별 표의 열 너비 계산(`RATING_COLUMNS`)에서 "미리보기 텍스트 길이" 추정용으로만 남겨뒀다.

### `anilistClient.js` 핵심 로직과 한계

- GraphQL POST 요청 하나로 모든 쿼리를 보낸다(REST 페이지네이션과 달리 `Page(page, perPage){ pageInfo{ hasNextPage } media{...} }` 형태). 요일별은 `status: RELEASING, format: TV, sort: POPULARITY_DESC`, 신작은 `season`/`seasonYear` 필터를 쓴다.
- **Rate Limit이 낮다**(직접 확인: 응답 헤더 `X-RateLimit-Limit: 30`, 분당 약 30회). 그래서 이 클라이언트가 내보내는 모든 요청은 모듈 전역 큐(`scheduleRequest`)를 거쳐 최소 `MIN_REQUEST_INTERVAL_MS`(2.1초) 간격으로 순차 실행된다 — 요일별/신작 조회가 `Promise.all`로 동시에 호출돼도 실제 네트워크 요청은 겹치지 않는다. 이 큐 때문에 AniList를 기본 소스로 첫 로딩할 때 다른 소스보다 체감 로딩이 느릴 수 있다(정상 동작).
- **중요한 한계(직접 확인함, 코드로 보완 불가)**: AniList `Media` 타입은 '인기 순위(rank)' 필드를 주지 않는다(`popularity`는 리스트에 담은 유저 수 집계일 뿐). `assignPopularityRanks()`가 지금 가져온 배치(요일별 최대 150건, 검색 최대 10건) 안에서 popularity 내림차순으로 정렬해 순번을 매겨 근사치 "인기도 순위"를 만든다 — MAL/전체 데이터베이스 기준 순위가 아니다.
- **AniList에는 TV 방송사(방송국) 전용 필드가 없다** — `broadcastStation`은 항상 `'정보 없음'`으로 고정.
- `nextAiringEpisode.airingAt`(UTC epoch초)에 9시간을 더하면 그대로 일본 현지(JST) 방송 시각이 된다(`resolveBroadcastSlotFromAiringAt`) — 별도 타임존 변환이 필요 없다는 것을 직접 확인함. 30시간제 관례(심야 0~5시대는 전날 요일)는 다른 두 클라이언트와 동일하게 적용.
- 스튜디오는 `studios(isMain: true)`로 메인 스튜디오만 서버 쪽에서 걸러서 받는다(Kitsu/Jikan처럼 role 관계를 직접 거를 필요가 없어 더 간단함).

### `kitsuClient.js` 핵심 로직과 한계

- **중요한 데이터 한계(직접 확인함, 코드로 보완 불가)**: Kitsu의 방영 일정 필드(`nextRelease`)는 원피스·명탐정 코난·짱구처럼 계속 이어지는 상시 연재작에만 주로 채워져 있다(인기 상위 20개 현재 방영작 중 3개만 값이 있었음). 그래서 Kitsu를 선택하면 요일별 방영 탭은 상당수 작품이 `broadcastDayKorean: null`(→ `unscheduled`)로 몰린다 — 버그가 아니라 Kitsu 데이터 자체의 한계이니, "왜 요일별로 안 나뉘지"라는 리포트가 오면 이 문서를 먼저 참고할 것.
- `genres` 관계(attributes.name)와 `categories` 관계(attributes.title)는 서로 다른 속성 키를 쓴다는 것을 직접 확인함 — `extractGenres`/`extractThemes`가 각각 다른 키를 읽는 이유. `categories`가 genres보다 더 세분화된 태그(예: Pirate, Swordplay)라 '테마' 항목으로 매핑했다.
- 스튜디오/장르/카테고리 관계(`animeProductions`/`genres`/`categories`)도 최신/비주류 작품일수록 Kitsu 쪽에 비어 있는 경우가 많다(One Piece처럼 오래되고 유명한 항목은 풍부하지만, 신작은 종종 빈 배열) — `extractStudio`/`extractBroadcastStation`이 이미 "미지정(Unknown)"/"정보 없음"으로 안전하게 처리하므로 별도 조치 불필요.
- Kitsu는 `filter[startDate]` 같은 날짜 범위 서버 필터를 지원하지 않는다(직접 확인: `400 Filter not allowed`). `getNewReleases`는 `filter[status]=current`로 후보를 넓게 가져온 뒤 `getQuarterRange()`로 계산한 분기 달력 범위로 클라이언트에서 걸러낸다.
- 페이지 크기 상한이 Jikan(25)과 다르게 **20**이다(`page[limit]` 21 이상이면 400 에러) — `KITSU_PAGE_SIZE`를 그대로 유지할 것.
- 공식 사이트에 대응하는 필드가 없어 Kitsu 자신의 페이지(`https://kitsu.io/anime/{slug}`)를 대체 링크로 쓴다 — 화면 상 라벨은 "정보 보기"(Kitsu 링크는 진짜 공식 사이트가 아니라 대체 링크라 라벨을 일반화함).
- **알려진 버그(직접 확인, Kitsu 서버 쪽 문제)**: `filter[status]=current` 조합에서 특정 페이지(주로 offset=20)가 간헐적으로 앞 페이지와 완전히 동일한 결과를 돌려준다(Kitsu가 응답에 실어주는 `links.next`를 그대로 따라가도 동일 현상 재현됨 — 요청 방식 문제가 아님). `fetchKitsuAllPages`는 이런 중복 페이지를 만나도 페이지네이션을 **중단하지 않고**, 그 페이지의 이미 본 항목만 건너뛴 채 계속 다음 오프셋을 시도한다 — 중단 조건은 `meta.count` 기반의 "더 가져올 데이터가 없음"과 `maxPages` 상한 뿐이다. (과거에 "새 항목이 없는 페이지를 만나면 즉시 중단"하는 방식으로 처리했다가, 이 간헐적 중복 페이지 하나 때문에 뒤에 남은 페이지들을 통째로 못 가져와 결과가 대폭 줄어드는 회귀가 있었다 — 이 히스토리를 참고해 "중단"이 아니라 "건너뛰고 계속"으로 고정할 것.)

### `jikanClient.js` 핵심 로직과 한계

- **재시도**: 429(Rate Limit)뿐 아니라 500/502/503/504(Jikan이 MAL 연결 실패 시 반환하는 게이트웨이 오류)도 재시도 대상. 시도할수록 대기시간 증가. Jikan/MAL 쪽이 통째로 다운되는 경우(과거 실제로 여러 날 지속된 완전 장애가 있었음, Jikan GitHub 이슈 트래커에서 확인 가능)엔 재시도해도 소용없으며, 이 경우 Mock 폴백/에러 메시지로 정상적으로 degrade되는 것이 최선이다 — 재시도 횟수를 늘리는 식으로 "고치려" 하지 말 것.
- **요일별 방영 애니메이션(`getWeeklyRatings`)**: '인기 랭킹(top)'이 아니라 `/seasons/now`(현재 방영 중인 전체 TV 애니메이션)를 **페이지네이션 전체**에 걸쳐 수집한다(1페이지=25건뿐이라 전체를 안 가져오면 특정 요일이 통째로 빌 수 있음). `mal_id` 기준 중복 제거 후 `anime.airing === true`인 항목만 남기고, 30시간제 관례(`resolveBroadcastSlot`)로 심야(0~5시대) 방영작을 전날 요일로 재배정해 7개 날짜(가장 이른 날짜부터) 섹션에 나눠 담는다. 방송 요일 정보가 없는 항목은 `unscheduled`로 별도 분리(숨기지 않음). 시청률(%) 대신 MAL 지표(평점/평가 참여자 수/인기도 순위/즐겨찾기 수)만 노출 — 실시간 TV 시청률은 공개 API가 없다.
  - **원피스·블리치 같은 초장기 연재작은 의도적으로 제외 대상이다**(그 작품의 `season` 값이 훨씬 예전 시즌으로 고정돼 있어 `/seasons/now`에 안 잡힘). 한때 `/top/anime?filter=airing` 결합으로 이를 보완했었으나 요청 수가 늘어 오류가 잦아져 안정성을 위해 되돌렸다 — 이 트레이드오프를 다시 바꾸려면 이 이력을 먼저 참고할 것.
- **분기 신작(`getNewReleases`)**: 기준 종료일이 속한 시즌(`/seasons/{year}/{season}`)의 TV 애니메이션을 페이지네이션(최대 `NEW_RELEASES_MAX_PAGES`=4페이지)으로 수집해 **분기 전체를 그대로** 반환한다. 예전엔 `aired.from`이 좁은 7일 조회 기간 안에 있는 항목만 필터링했으나, 그 좁은 필터 때문에 API 호출이 성공해도 결과가 0건이 되어 Mock으로 자주 대체되는 문제가 있어 필터를 없앴다. 탭 이름은 '분기 신작'이므로 실제로는 '그 분기 전체 방영작'을 보여준다(UI에도 안내 문구 있음).
- **검색(`searchAnimeByTitle`)**: `/anime?q=` 사용, 정확히 일치하지 않아도 유사도 기반 결과를 그대로 반환(별도 유사도 계산 없음). API 실패 시 다른 기능과 달리 **Mock 데이터로 대체하지 않고** 명확한 에러 메시지를 반환한다(검색은 특정 검색어에 대한 응답이라 무관한 Mock을 보여주면 오도하게 됨) — 이 원칙은 세 클라이언트 모두 동일하다.
- **날짜 연산**: 문자열 파싱은 항상 `Date.UTC`/`getUTC*`로 처리한다(`app.js`/다른 두 클라이언트도 동일 원칙). `new Date('YYYY-MM-DD')` + 로컬 getter 조합은 방문자 브라우저 타임존에 따라 하루 밀리는 버그를 낸 적이 있음 — 새 날짜 로직 추가 시 이 패턴을 반복하지 말 것.
- **Mock 폴백**: 이 클라이언트 자체가 실패했을 때만 사용(요일별/신작). 다른 소스로 자동 전환되지 않는다. Mock 데이터의 공식 사이트/커버 이미지 링크는 실제 존재를 확인한 URL만 사용한다(가짜 도메인 금지).

## UI 규칙

- **데이터 소스 선택**(`index.html`의 `.source-panel`, `app.js`의 `CLIENT_GETTERS`/`activeSource`): AniList/Kitsu/Jikan 세 버튼 중 하나를 사용자가 직접 고른다(기본값 AniList). 버튼을 누르면 `fetchAnimeData`가 그 소스로 요일별/신작 데이터를 다시 불러온다(검색은 다음 검색 시점에 새 소스를 사용). 페이지 최초 진입 시 `checkAllSourceStatus()`가 세 API에 재시도 없이 1회씩 진단 요청을 보내 버튼 옆 점(`.source-btn-dot`)을 초록(정상)/빨강(실패)으로 표시한다 — 화면에 표시 중인 데이터는 건드리지 않는 순수 진단이며, 각 클라이언트의 `checkStatus()`가 이 역할을 한다. (과거에 있던 "Jikan API 상태 확인" 전용 패널은 이 버튼 옆 점으로 대체되며 제거됐다.) "데이터 소스" 제목 옆에도 "?" 안내 버튼(`sourceInfoBtn`/`sourceInfoPopup`)이 있다.
- 요일별 방영 탭은 정렬 기준(평점/평가 참여자 수/인기도 순위/즐겨찾기 수) + 오름차순/내림차순 토글 하나로 **모든 요일 표를 동시에** 재정렬한다(요일마다 개별 정렬 컨트롤 없음). "평점"/"인기도 순위" 컬럼 헤더도 직접 클릭해 정렬할 수 있다(`RATING_SORTABLE_HEADERS`, `handleHeaderSortClick`) — 같은 헤더를 다시 클릭하면 방향만 뒤집고, 다른 헤더를 클릭하면 그 필드의 기본 방향으로 시작하며, 상단 드롭다운(`sortFieldSelect`)과 항상 같은 `ratingSort` 상태를 공유해 서로 동기화된다.
- **커버 이미지**: 요일별 표/신작 표/검색 카드 모두 `createCoverCell`(표) 또는 인라인 `<img>`(카드)로 작은 축소본(`.cover-thumb`)을 보여주고, 클릭하면 `openImageModal(src, alt)`가 원본을 전체 화면 오버레이(`#imageModal`)에 띄운다. 오버레이 자체에 클릭 리스너 하나만 달아뒀다(`imageModal.addEventListener('click', closeImageModal)`) — 이미지가 오버레이의 자식이라 이미지를 클릭해도 이벤트가 버블링돼 같이 닫힌다(이미지 클릭/바깥 클릭 모두 닫힘 요구사항을 리스너 하나로 충족). **주의**: `.image-modal{display:flex}`와 `.hidden{display:none}`은 둘 다 단일 클래스 선택자라 명시도가 같은데, `.image-modal`이 스타일시트에서 더 나중에 정의돼 있으면 hidden 클래스를 붙여도 안 감춰지는 버그가 실제로 있었다(전체 화면이 투명하게 클릭을 가로채 다른 버튼이 전부 안 눌리는 심각한 회귀). 지금은 `.image-modal.hidden { display: none; }` 규칙으로 명시도를 높여 고정했다 — `.hidden`과 같이 쓰이는 새 컴포넌트에 자체 `display` 규칙을 추가할 때는 이 패턴(두 클래스를 모두 요구하는 override 규칙 추가)을 따를 것.
- 길게 항상 펼쳐 보여줄 필요 없는 안내 문구는 제목 옆 "?" 아이콘 버튼(`.info-btn`) + 클릭 시 뜨는 미니 팝업(`.info-popup`, `.info-wrapper`로 감싸 `position:relative`/`absolute` 앵커링)으로 접어둔다. 버튼 클릭으로 토글, 팝업 바깥 클릭으로 닫힘 — 이 토글+바깥클릭닫힘 로직은 `app.js`의 `setupInfoPopup(btn, popup)` 헬퍼 하나로 통일돼 있다(`event.stopPropagation()`으로 버튼 자체 클릭과 충돌 방지). 요일별 방영 탭의 안내(`ratingInfoBtn`/`ratingInfoPopup`)와 데이터 소스 패널의 안내(`sourceInfoBtn`/`sourceInfoPopup`)가 이 패턴의 예시이니, 다른 곳에 긴 안내문을 추가할 때는 새 "?" 버튼/팝업 엘리먼트만 만들고 `setupInfoPopup(...)`을 한 줄 추가하면 된다.
- 요일별 방영 탭의 각 날짜 표는 별도의 `<table>`로 그려지지만, 헤더/컬럼 위치가 표마다 어긋나지 않도록 전체 항목(모든 요일 + 요일 미상) 중 가장 긴 값을 기준으로 컬럼 너비를 한 번만 계산(`computeRatingColumnWidths`, canvas `measureText` 사용)해 모든 표에 동일한 `<colgroup>`으로 적용한다(`public/app.js`). 커버 이미지 컬럼처럼 텍스트가 아닌 컬럼은 `column.fixedWidth`로 고정폭을 지정해 텍스트 측정을 건너뛴다.
- **타이틀(일본어/영어) 컬럼**은 내용 길이로 폭을 재지 않는다 — 제목이 길면 표 전체가 넓어져 페이지에 불필요한 가로 스크롤이 생기던 문제가 있어서, `getTitleColumnWidth()`(일본어 20자 기준 샘플 `TITLE_COLUMN_SAMPLE`을 재서 캐시한 값 하나)를 두 컬럼(`column.titleColumn: true`)에 **동일하게** 적용한다(둘 중 하나만 바꾸면 두 칸 크기/간격이 달라 보이므로 항상 같이 바꿀 것). 실제 셀은 `createTitleCell(text, contentWidth)`이 만드는 `.title-scroll`(내부 `overflow-x:auto`, 인라인 `max-width`) 안에 담기는데, **스크롤바 자체는 화면에 보이지 않도록 숨겨뒀다**(`scrollbar-width:none`/`::-webkit-scrollbar{display:none}`) — 넘치는 텍스트는 그냥 잘려 보이고, `overflow-x:auto`는 계속 살아있어서 마우스로 텍스트를 드래그해 선택(복사)할 때 브라우저가 자동으로 옆으로 스크롤해주는 것까지는 막지 않는다. 셀 하나만 스크롤되고 표/페이지 전체 폭에는 영향을 주지 않는다(전체 텍스트는 `title` 속성 툴팁으로도 볼 수 있음). `getTitleColumnWidth()`는 요일별 표뿐 아니라 **신작 탭의 "타이틀" 컬럼에서도 그대로 재사용**한다(`renderNewReleasesTable`) — 두 탭의 타이틀 칸 크기 규칙을 항상 일치시키기 위함이므로, 한쪽만 고치지 말 것.
- **좁은 화면에서 표에 좌우 스크롤이 생겨도 No./표지/타이틀(일본어) 세 칸(`STICKY_COLUMN_COUNT`)은 화면에 고정**되고 타이틀(영어)부터는 그 뒤로 스크롤된다(`applyStickyColumns`가 `columnWidths`로 각 칸의 누적 `left` 오프셋을 계산해 `.sticky-col` 클래스 + 인라인 `left`를 적용, CSS는 `position: sticky`와 배경색/그림자만 담당). 스크롤 중에도 어떤 작품 행인지 계속 보이게 하려는 목적이며, 이 고정 컬럼 동작은 요일별 방영 탭에만 있고(**신작 탭에는 적용하지 않음** — 신작 탭은 타이틀 크기 규칙만 공유), 컬럼을 추가/재배치할 때 `RATING_COLUMNS`/`RATING_SORTABLE_HEADERS`/`createRatingRow`의 셀 순서가 어긋나면 sticky 오프셋도 같이 깨지므로 세 곳의 순서를 항상 맞출 것.
- 타이틀은 항상 일본어/영어를 별도 컬럼(또는 카드 필드)으로 분리해서 보여준다.
- 값이 없는 지표/필드는 항목 자체를 숨기지 말고 "정보 없음"으로 표시한다(과거에 지표 하나가 없다고 방영 중인 작품 전체가 목록에서 빠지는 버그가 있었음).
- 각 탭 제목 옆 배지(`ratingSourceStatus`/`newSourceStatus`/`searchSourceStatus`)로 실시간 연동(초록)/Mock 대체(주황)/오류(빨강)를 표시한다(`updateSourceStatus`, `source` 값 `'anilist'|'kitsu'|'jikan'|'mock'|'error'`) — 사용자가 지금 보는 데이터가 실시간인지, 예시인지 구분할 수 있게 하기 위함이니 새 데이터 소스를 추가해도 이 배지 갱신을 빠뜨리지 말 것.
