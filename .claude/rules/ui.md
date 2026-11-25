---
paths:
  - "public/app.js"
  - "public/style.css"
  - "public/index.html"
  - "public/tablePan.js"
---

# UI 규칙

- **표 영역(`.table-wrapper`)은 높이를 `calc(100vh - 100px)`로 제한하고 표 안에서 세로·가로로 스크롤한다**(`overflow: auto`) — 가로 스크롤바가 페이지 맨 아래가 아니라 보이는 화면 하단에 놓이게 하려는 것. 대신 머리글(`thead th`)을 `position: sticky; top: 0`으로 고정했다(고정 컬럼 머리글은 `z-index: 3`, `top: 0`). 모든 표(요일별/신작/ONA 등/만화·소설/웹소설)가 이 클래스를 공유한다.
- **표 드래그 이동**(`tablePan.js`): `.table-wrapper` 안의 셀을 잡고 끌면 좌우·상하로 이동한다(이벤트 위임). 5px 미만은 클릭으로 두고, 실제로 끈 뒤의 click은 막는다. 링크/버튼/입력/커버 이미지와 **타이틀 칸(`.title-scroll`)은 이동 대상에서 제외**(텍스트 선택·복사용). 스크롤바 자체는 건드리지 않는다.
- **데이터 소스 선택**(`.source-panel`, `CLIENT_GETTERS`/`activeSource`): AniList/Kitsu/Jikan 중 사용자가 고른다(기본 AniList). 버튼을 누르면 `fetchAnimeData`가 요일별/신작을 다시 불러오고 검색은 다음 검색부터 새 소스를 쓴다. 최초 진입 시 `checkAllSourceStatus()`가 세 API에 재시도 없이 1회씩 진단 요청을 보내 버튼 옆 점(`.source-btn-dot`)을 초록/빨강으로 표시한다(화면 데이터는 건드리지 않는 순수 진단, 각 클라이언트 `checkStatus()`). "데이터 소스" 옆에도 "?" 안내(`sourceInfoBtn`/`sourceInfoPopup`)가 있다.
- **요일별 방영 탭은 요일별로 표를 나누지 않는다** — `renderRatingDays`가 `days.flatMap((day) => day.items).concat(unscheduled)`로 전체를 **단일 표**로 그린다. 요일 구분은 "방영일" 컬럼(`broadcastDayKorean`, 한 글자, 미상은 "정보 없음")이 대신한다. 정렬 기준(평점/인기도 순위/평가 참여자 수/즐겨찾기 수/방영일) + 오름차순/내림차순 토글 하나로 표 전체를 재정렬하며 기본은 **평점 높은 순**(`ratingSort = { field: 'score', direction: 'desc' }`)이다. "평점"/"인기도 순위"/"방영일" 헤더도 직접 클릭해 정렬한다(`RATING_SORTABLE_HEADERS`, `handleHeaderSortClick`) — 같은 헤더 재클릭은 방향만 뒤집고, 다른 헤더는 그 필드의 기본 방향으로 시작하며, 상단 드롭다운(`sortFieldSelect`)과 같은 `ratingSort` 상태를 공유한다. 방영일 정렬은 `BROADCAST_DAY_ORDER`(일=0~토=6) 숫자로 비교한다(`getSortValue`).
- **컬럼**: `방영 시작일`(`firstAirDate`)이 `방영일` 앞에 있고 정렬 기준에도 포함된다. 컬럼 너비는 전체 항목 중 가장 긴 값 기준으로 한 번만 계산(`computeRatingColumnWidths`, canvas `measureText`)해 `<colgroup>`에 적용하며, 커버 이미지처럼 텍스트가 아닌 컬럼은 `column.fixedWidth`로 측정을 건너뛴다.
- **타이틀(일본어/영어) 컬럼**은 내용 길이로 폭을 재지 않는다 — `getTitleColumnWidth()`(일본어 20자 기준 샘플 `TITLE_COLUMN_SAMPLE`을 재서 캐시한 값 하나)를 두 컬럼(`column.titleColumn: true`)에 **동일하게** 적용한다(둘 중 하나만 바꾸지 말 것). 셀은 `createTitleCell(text, contentWidth)`의 `.title-scroll`(내부 `overflow-x:auto`, 인라인 `max-width`)이며 스크롤바는 숨겼다(`scrollbar-width:none`/`::-webkit-scrollbar{display:none}`) — 넘치는 텍스트는 잘려 보이고, 드래그 선택 시 자동 스크롤은 유지된다. 전체 텍스트는 `title` 속성 툴팁으로도 보인다. `getTitleColumnWidth()`는 신작 탭 "타이틀" 컬럼(`renderNewReleasesTable`)에서도 재사용하므로 한쪽만 고치지 말 것.
- **고정 컬럼**: 좁은 화면에서 No./표지/타이틀(일본어) 세 칸(`STICKY_COLUMN_COUNT`)은 화면에 고정되고 타이틀(영어)부터 스크롤된다(`applyStickyColumns`가 `columnWidths`로 누적 `left`를 계산해 `.sticky-col` + 인라인 `left` 적용, CSS는 `position: sticky`와 배경색/그림자만). **요일별 탭에만 있고 신작 탭에는 적용하지 않는다.** 컬럼을 추가/재배치할 때 `RATING_COLUMNS`/`RATING_SORTABLE_HEADERS`/`createRatingRow`의 순서를 항상 맞출 것.
- 타이틀은 항상 일본어/영어를 별도 컬럼(또는 카드 필드)으로 분리해 보여준다.
- **분기 신작(TV) 탭은 방송일(`firstAirDate`)이 빠른 순으로 기본 정렬**한다 — `renderNewReleasesTable`이 `sortReleasesByAirDate`로 항상 재정렬한다(별도 정렬 UI 없음). `firstAirDate`가 `'YYYY-MM-DD'`가 아니면(`'미정'` 등) 정규식으로 걸러 맨 뒤로 보낸다(`getAirDateSortValue`).
- **커버 이미지**: 표(`createCoverCell`, 40×56)/카드(64×90)에 축소본(`.cover-thumb`)을 보여주고 클릭하면 `openImageModal(src, alt)`가 원본을 전체 화면 오버레이(`#imageModal`)에 띄운다. 오버레이 자체에 클릭 리스너 하나만 달아(`imageModal.addEventListener('click', closeImageModal)`) 이미지/바깥 클릭 모두 닫힌다. `.image-modal.hidden { display: none; }` override 규칙으로 명시도를 올려 둔 것을 유지한다.
- **장르/테마**: `appendTagListContent(container, item)`이 `genres`+`themes`를 합쳐 앞 4개만 텍스트로 보여주고 남으면 `+N` 버튼(`.tag-expand-btn`)을 붙인다(요일별 표 `createTagListCell`, 신작 표, 검색 카드 `createTagListDetailField` 공유). 버튼은 `openTagListModal(item)`으로 전체 장르(파란 칩)/테마(회색 칩)를 팝업(`#tagListModal`)에 띄우며, **배경 클릭이나 `×`로만 닫히고 내용 클릭으로는 안 닫힌다**. `formatTagList(item)`은 열 너비 계산(`RATING_COLUMNS`)의 미리보기 길이 추정용으로만 남아 있다.
- 커버/카드: `category` 컬럼·필드는 요일별/신작/검색 어디에도 표시하지 않는다.
- **"?" 안내 팝업**: 긴 안내문은 제목 옆 `.info-btn` + 미니 팝업(`.info-popup`, `.info-wrapper`로 감싸 `relative`/`absolute` 앵커링)으로 접어 둔다. 토글 + 바깥 클릭 닫힘은 `setupInfoPopup(btn, popup)` 한 줄로 쓴다(`event.stopPropagation()` 내장). 새 안내는 "?" 버튼/팝업 엘리먼트만 만들고 이 함수를 호출한다.
- 각 탭 제목 옆 배지(`ratingSourceStatus`/`newSourceStatus`/`searchSourceStatus`)는 `updateSourceStatus`(`source` 값 `'anilist'|'kitsu'|'jikan'|'mock'|'error'`)로 갱신한다.
