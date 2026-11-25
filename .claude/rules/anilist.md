---
paths:
  - "public/anilistClient.js"
  - "public/onaApp.js"
---

# AniList 클라이언트 / ONA 탭 규칙

## `anilistClient.js` 핵심 로직과 한계

- GraphQL POST 하나로 모든 쿼리를 보낸다(`Page(page, perPage){ pageInfo{ hasNextPage } media{...} }`). 요일별은 선택한 주의 방송 일정(`airingSchedules`)에서 TV를 받고(아래 "요일별 날짜 기준"), 신작은 `season`/`seasonYear` 필터를 쓴다.
- **Rate Limit이 낮다**(응답 헤더 `X-RateLimit-Limit: 30`, 분당 약 30회). 모든 요청은 모듈 전역 큐(`scheduleRequest`/`gqlRequest`)를 거쳐 최소 `MIN_REQUEST_INTERVAL_MS`(2.1초) 간격으로 순차 실행된다. 첫 로딩이 느린 건 정상이다.
- **AniList는 값이 `null`인 필터 변수를 거부한다**(`Illegal operator and value combination`) — 필요할 때만 변수에 넣는다.
- `Media`에는 인기 순위(rank) 필드가 없다. `assignPopularityRanks()`가 지금 가져온 배치 안에서 popularity 내림차순으로 순번을 매긴 근사치다(전체 DB 기준 아님).
- AniList에는 TV 방송사 필드가 없다 — `broadcastStation`은 `'정보 없음'`(Syoboi로 보충, `kitsu-syoboi.md` 참고).
- `nextAiringEpisode.airingAt`(UTC epoch초)에 9시간을 더하면 JST 방송 시각이다(`resolveBroadcastSlotFromAiringAt`). 30시간제 관례(심야 0~5시대는 전날 요일)는 다른 클라이언트와 동일.
- 스튜디오는 `studios(isMain: true)`로 서버에서 거른다.
- `genres`/`themes`: AniList `tags`는 스포일러 태그 제외 rank 상위 5개를 themes로 쓴다.
- **필터 제외**: Hentai 장르는 서버 쪽 `genre_not_in: ["Hentai"]`(`EXCLUDED_GENRES_GQL`)로 목록 쿼리(요일별, 신작 TV, ONA 등, 만화·소설 순위)에서 뺀다. **사용자가 직접 입력하는 검색 탭은 거르지 않는다.** 중국 제작(`EXCLUDED_ORIGIN_COUNTRIES = {'CN'}`)은 제작국 제외 필터가 없어 `countryOfOrigin`을 받아 클라이언트에서 거른다. 한국(KR) 등은 제외하지 않는다. Kitsu/Jikan 목록에는 적용하지 않는다.

### 평점 변화 그래프(`getScoreHistory`)

- 요일별 표/검색 카드의 평점에 마우스를 올리면(터치는 탭) `app.js`의 `attachScoreHistory`가 팝업(`.score-history-popup`)에 꺾은선 SVG를 그린다(세로 눈금은 1점 단위 정수). 데이터는 `Page.mediaTrends`(작품당 일 1회 JST 0시 스냅샷의 `averageScore`)를 `date_greater`로 범위 조회한 것이다(`Media.trends`에는 날짜 필터가 없고 별칭 다중 조회는 필터가 무시돼 못 쓴다).
- 방영 시작일부터 7일 간격으로 "방송 시각 + 6시간" 이후 처음 나오는 스냅샷을 고른다(실제로는 방송 다음 날 0시 값). 최대 400일(페이지 8개)만 조회하고, null인 날과 2014-12 이전은 빠진다. `anilistId`가 없는 항목(Kitsu/Jikan)은 안내 문구만 뜬다. `scoreHistoryCache`로 작품당 한 번만 조회한다.

### 방영 상태 점(`item.airingState = { state, reason }`)

- 요일별 표 일본어 타이틀 앞에 초록(`airing`)/빨강(`hiatus`·`ended`)/회색(`unknown`) 점(`createAiringStateDot`, `title` 툴팁에 근거). 각 클라이언트가 `resolveAiringState`로 채운다(Mock엔 없고 점도 안 그림). 공통 기준: 다음 방송이 14일 안이면 방영 중, 더 멀면 휴방. AniList는 `nextAiringEpisode`/`status`로 판정하며 `NOT_YET_RELEASED`는 회색이다. 신작 탭/검색에는 적용하지 않는다(ONA 탭은 적용).

## 요일별 방영 목록의 날짜 기준(`getWeeklyRatings`)

- 기준 날짜를 바꾸면 **그 주(기준 날짜 포함 7일)에 실제 방송된 TV 작품**을 보여준다. `Page.airingSchedules(airingAt_greater, airingAt_lesser)`로 7일(JST) 방송 일정을 받아 `format === 'TV'`만 남기고(Hentai·중국 제외) 작품별 그 주의 첫 방송 시각으로 요일/시간을 계산한다(`nextAiringEpisode` 자리에 넣어 기존 매핑 재사용). 주별 결과는 `weeklyScheduleCache`에 캐시한다(주당 약 3요청, 최대 8페이지).
- **`status: RELEASING`만 받으면 안 된다**: 기준 날짜를 바꿔도 같은 목록이 나오고, 최종화를 방송한 작품은 `FINISHED`가 되어 그 주 목록에서 사라진다(BLEACH 禍進譚 사례). 지금은 최종화 주에도 포함되고 상태 점은 빨강("이번 주 방송 후 방영 종료")이다.
- 선택한 주가 **오늘 이후까지 걸치면** 일정이 없는 장수 방송(짱구·사자에상 등)을 위해 `RELEASING` 목록(`status: RELEASING, format: TV, sort: POPULARITY_DESC`)을 합친다(중복 제거). 완전히 지난 주에는 AniList에 일정이 등록된 작품만 나온다.
- **평점·인기도·즐겨찾기는 조회 시점의 현재 값**이다. 지난 주 상태 점은 "선택한 주에 방송됨"(초록).
- Syoboi 방송사 보충은 주 종료일이 14일 이내일 때만 한다(`SYOBOI_FRESH_DAYS`).
- **Kitsu/Jikan은 날짜 조건을 지원하지 않고 항상 "지금 방영 중" 목록**이다. 오늘이 포함되지 않은 주를 고르면 `updatePeriodDisplay`가 "이 데이터 소스는 지난 날짜를 지원하지 않아…" 안내를 붙인다. 분기 신작(TV) 탭은 기준 날짜가 속한 분기 전체를 보여준다.

## 분기 신작 (ONA 등) 탭(`getNonTvSeasonal` / `onaApp.js`)

- 기존 탭은 **"분기 신작 애니메이션 (TV 방영)"**(세 소스 모두 TV만), 요일별 탭도 TV만이다. 이 탭은 **format이 TV가 아닌 모든 작품**(ONA/OVA/극장판/스페셜/뮤직/TV 숏, AniList `format_not: TV`)이 대상이다.
- **AniList 전용**이다 — 데이터 소스 버튼과 무관하게 항상 AniList를 쓴다(탭 안내 "?"에도 적음).
- 표는 요일별 표에서 **방영일·방송 시간을 빼고 형태·시즌을 더한** 것이다(방송사, 평점 그래프 hover, 방영 상태 점, 정렬 유지). 정렬은 헤더 클릭 + 정렬 기준 select(평점/인기도 순위/참여자 수/즐겨찾기/방영 시작일), 기본은 평점 높은 순. 형태 필터는 다중 선택.
- **연도·시즌 다중 선택 + "조회" 버튼**: 조합(연도×시즌)마다 AniList를 호출하므로 "조회"를 눌러야 적용된다(8조합 이상이면 오래 걸린다고 안내). 조합별 결과는 `nonTvSeasonCache`에 캐시하고 실패는 캐시하지 않는다. 일부 조합만 실패하면 나머지는 보여주고 요약에 실패 조합을 적는다. 인기도 순위는 불러온 작품 전체 안에서의 순위.
- **처음 열 때(탭 클릭) 오늘이 속한 시즌 하나만** 자동 로드한다(요청 한도 절약). 시즌은 일본 방송 분기(겨울 1~3월/봄 4~6월/여름 7~9월/가을 10~12월, `resolveSeason`과 같은 기준). 연도 목록은 내년~2000년.
