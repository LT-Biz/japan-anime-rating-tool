---
paths:
  - "public/booksApp.js"
  - "public/webNovelApp.js"
  - "public/webnovel-ranking.js"
  - "public/multiSelect.js"
  - "scripts/build-webnovel.js"
---

# 만화·소설 순위 / 웹소설 랭킹 규칙

## 만화·소설 순위(`getBookRanking` / `booksApp.js`)

- 목적: 아직 애니화되지 않은 인기 원작(IP) 발굴. 일본 원작(`countryOfOrigin: JP`)의 `format: MANGA`/`NOVEL`을 AniList 지표로 보여준다(`AniListClient.getBookRanking(type, sortKey)`, `type`은 `'MANGA'|'NOVEL'`). 애니메이션 쪽(소스 버튼, 기준 날짜, 3개 탭)과 완전히 별개이며 AniList만 쓴다. 상단 `.mode-btn`으로 `#animeMode`/`#booksMode`를 전환한다. `app.js`의 표 셀 헬퍼와 `setupInfoPopup`/`updateSourceStatus`/`getTitleColumnWidth`를 재사용한다.
- **인기도(`popularity`)는 AniList 이용자의 목록 등록 수이지 일본 서점 판매량이 아니다.** 판매 부수/순위는 알 수 없고, 오리콘은 공개 API가 없고 전재가 금지돼 가져오지 않는다(링크만 가능).
- 순위 기준(`BOOK_SORTS`): 인기도순(`POPULARITY_DESC`), 급상승순(`TRENDING_DESC`), 평점순(`SCORE_DESC` + 최소 인기도 1만), 최근 3년 내 시작작 인기순(`startDate_greater` + `POPULARITY_DESC`). `START_DATE_DESC`는 월/일이 빈 날짜·미래 작품이 섞여 쓰지 않는다. 기준당 최대 200건(50건×4페이지), 첫 로딩 약 9초. `(종류|기준)`별로 캐시하고 실패는 캐시하지 않는다. `popularity_greater`/`startDate_greater`는 필요할 때만 변수에 넣는다(null 금지). 항상 `status_not: NOT_YET_RELEASED`.
- 애니화 상태(`resolveAdaptationState`): `relations`에서 `relationType(version: 2) === 'ADAPTATION'` + 노드 `type === 'ANIME'`의 상태를 요약(우선순위: 방영 중 > 제작 예정 > 방영 완료 > 중단, 없으면 `none` = 미애니화). **AniList에 없는 실사 드라마·영화·게임화는 반영되지 않으므로 '미애니화'가 진짜 미각색은 아니다.**
- **필터·정렬은 전부 브라우저에서 이미 받은 200건에 적용하며 AniList를 다시 호출하지 않는다**(`applyFilters`/`applySorts`/`renderView`). 서버 요청은 "조회 기준"(`bookSortSelect`)과 종류뿐이다. 필터: 애니화 상태·연재 상태 **다중 선택**(`state.adaptation`/`state.status`는 `Set`; 연재 상태 값은 `item.status` 한국어 문구와 정확히 일치: 연재 중/완결/휴재/중단), 인기도/평점/즐겨찾기/급상승 최소값(값 없는 작품은 최소값 조건에서 제외). 정렬: 1~3차 select + 방향 버튼(`state.sorts`)과 숫자 칸 머리글 클릭(1차 정렬 지정/방향 전환, 나머지 유지)이 같은 상태를 공유한다. 값이 없는 작품은 방향과 무관하게 뒤로, 모두 같으면 조회 기준 순위(`rank`)로. 애니화 정렬은 `ADAPTATION_ORDER`(미애니화→제작 예정→방영 중→방영 완료→중단)로 비교하므로 오름차순이 IP 후보 우선. 순위 번호는 필터·정렬 전 순위다. **숫자 입력 디바운스(250ms)의 타이머는 입력 칸마다 따로 둔다**(공유하면 다른 칸의 대기 입력이 취소된다).
- 탭 이름에는 출처/연동 상태가 붙는다(`updateTabLabel`: `만화 (AniList API 실시간 연동됨)`, 불러오는 중/조회 실패도 표시). 소설가가 되자·카쿠요무 탭(빌드 스냅샷)과 구분하기 위함. 아직 안 연 탭은 `(AniList API)`. **응답이 버려지는 경우(로딩 중 다른 탭으로 이동)에도 그 탭의 "불러오는 중"은 풀어 준다**(토큰 검사 전에 라벨 갱신).
- 처음 열 때 한 번만 불러온다(분당 약 30회 한도). Mock은 쓰지 않고 실패하면 에러 문구만 보여준다. 라이트노벨은 AniList에서 `type: MANGA`, `format: NOVEL`. 작가는 `staff` 상위 2명, 권수는 대부분 비어 표에 넣지 않았다.
- 탭(만화/라이트노벨/소설가가 되자/카쿠요무)이 바뀌면 `booksApp.js`가 `books:tab` 이벤트를 보내고 `webNovelApp.js`가 `#webNovelPanel`을 보이거나 숨긴다. `multiSelect.js`는 `booksApp.js`/`webNovelApp.js`보다 먼저 로드한다.

## 웹소설 랭킹(소설가가 되자 / 카쿠요무)

- 두 사이트 모두 **브라우저에서 직접 부를 수 없다**(CORS 없음) → `npm run build:webnovel`(`scripts/build-webnovel.js`)이 빌드 때 상위 300건(주간·월간)을 받아 `public/webnovel-ranking.js`(`window.WEBNOVEL_RANKING = {...}`, `<script src>`)로 저장한다. `npm run build`와 주 1회 Deploy Hook 재배포가 이 스냅샷도 갱신한다. `--soft`는 일부/전체 실패해도 빌드를 실패시키지 않고 실패한 부분은 기존 데이터를 유지한다. 이 파일에는 `?v=`/immutable 캐시를 붙이지 않는다.
- **소설가가 되자**: 공식 API(`https://api.syosetu.com/novelapi/api/`, 키 불필요). 주간 `order=weeklypoint`, 월간 `monthlypoint`, `lim=300`. 포인트는 `북마크×2 + 평가점수`(기간 포인트는 최근 7/30일 증가분). **서적화 여부 필드가 없어** 제목·키워드의 `書籍化/コミカライズ/アニメ化`로 추정(`detectMediaMix`). `end=0`이면 완결(단편은 `noveltype=2`), `isstop=1`이면 휴재. 공식 문서가 2주 안 갱신을 요청해 14일이 넘으면 화면에 "오래됨"을 표시한다. R18은 이 API에 없다.
- **카쿠요무**: 공식 API가 없어 공개 랭킹 페이지(`/rankings/all/{weekly|monthly}?work_variation=long&page=N`, 100건/페이지 × 3 = 300건)의 Next.js `__NEXT_DATA__` Apollo 상태(`ROOT_QUERY.rankedWorks` → `Work:{id}`)를 읽는다. **개인 확인용으로만 쓴다**(사적 이용 범위 밖의 복제·영리 이용 금지 조항이 있어 업무용은 KADOKAWA 문의가 필요하지만 사용자가 문의하지 않기로 함). 요청은 기간당 3회·1.5초 간격으로 최소화하고 소개문·캐치프레이즈 같은 본문은 저장하지 않는다(제목/작가/장르/태그/수치만). 기간별 포인트는 없고 순위와 누적 별점(`totalReviewPoint`)만 있다. `hasPublication`이 서적화 표시. 구조가 바뀌면(`__NEXT_DATA__`/`rankedWorks` 없음) 명확한 오류 → 기존 데이터 유지. 장르 한국어 매핑(`KAKUYOMU_GENRES`)은 알려진 값만, 모르는 값은 원문 그대로.
- 화면(`webNovelApp.js`): 기간(주간/월간), 필터(장르·상태 다중 선택, 서적화 표기 없는 작품만·검색·최소 포인트), 1~3차 정렬 + 머리글 클릭 정렬은 `booksApp.js`와 같은 방식이며 300건에 브라우저에서 적용한다. 도구줄은 JS로 만든다. 카쿠요무에는 기간 포인트/북마크/리뷰/이세계 칸과 정렬 항목이 없다. 두 사이트의 포인트는 의미가 달라(북마크×2+평가 vs 누적 별점) 직접 비교하지 말 것. 일본 서점 판매량이 아니라 투고 사이트 안의 인기다.
- 알파폴리스·에브리스타·하멜른·pixiv 소설은 공식 API가 없거나 자동 접속을 막아(Cloudflare 봇 차단, robots.txt) 지원하지 않는다.
