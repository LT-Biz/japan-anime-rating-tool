---
paths:
  - "public/kitsuClient.js"
  - "public/syoboiSchedule.js"
  - "public/syoboi-schedule.js"
  - "scripts/build-syoboi.js"
  - ".github/workflows/refresh-syoboi.yml"
  - "vercel.json"
---

# Kitsu 클라이언트 / Syoboi 편성표 규칙

## `kitsuClient.js` 핵심 로직과 한계

- JSON:API 포맷(`included` 배열 + relationships 포인터)이라 스튜디오/장르/카테고리 이름은 `include=`로 같이 받아 직접 조인한다(`buildIncludedIndex`/`resolveRelationshipList`). `genres`는 `attributes.name`, `categories`는 `attributes.title`을 쓴다(`extractGenres`/`extractThemes`). `categories`가 더 세분화돼 '테마'로 매핑.
- **데이터 한계(코드로 보완 불가)**: 방영 일정 필드(`nextRelease`)는 원피스·코난·짱구 같은 상시 연재작에만 채워져 있다. 그래서 Kitsu 요일별 탭은 상당수가 `broadcastDayKorean: null`(→ `unscheduled`)로 몰린다 — 버그가 아니다. 신작은 스튜디오/장르/카테고리 관계가 비는 경우가 많다(`extractStudio`/`extractBroadcastStation`이 "미지정(Unknown)"/"정보 없음"으로 안전 처리).
- `attributes.status`는 날짜로 계산된 값이라 `filter[status]=current` 목록에도 `finished`가 섞여 나온다.
- 날짜 범위 서버 필터는 없다(`filter[startDate]` → 400). `getNewReleases`는 서버 시즌 필터(`filter[season]`+`filter[seasonYear]`+`filter[subtype]=TV`)로 분기 전체를 받는다(`status=current`+`sort=-startDate`는 일부가 통째로 누락됨). 수집 건수가 `meta.count`보다 적으면 콘솔 경고.
- **페이지 크기 `KITSU_PAGE_SIZE`는 10으로 고정**(상한은 20이지만 20이면 offset 20 구간이 중복돼 일부 누락). `WEEKLY_MAX_PAGES`/`NEW_RELEASES_MAX_PAGES`는 40/20. 되돌리지 말 것.
- `filter[status]=current` 목록은 일부 작품을 빼먹는다(예: 桃源暗鬼). 그래서 `getWeeklyRatings`는 이 목록에 **이번 분기 시즌 필터 결과 중 `status === 'current'`를 합친다**. 신작은 시즌 필터만 쓴다.
- **Kitsu 서버 버그**: 특정 페이지(주로 offset=20)가 앞 페이지와 동일한 결과를 간헐적으로 돌려준다(`links.next`를 따라가도 동일). `fetchKitsuAllPages`는 **중단하지 않고** 이미 본 항목만 건너뛴 채 다음 오프셋을 계속 시도한다. 중단 조건은 `meta.count` 기반 "더 없음"과 `maxPages` 상한뿐이다("새 항목 없으면 즉시 중단"하면 결과가 대폭 줄어드는 회귀가 있었다).
- 공식 사이트 필드가 없어 Kitsu 페이지(`https://kitsu.io/anime/{slug}`)를 대체 링크로 쓰며 라벨은 "정보 보기".
- 방영 상태 점 판정 순서: `nextRelease` → Syoboi 이번 주 편성 → `attributes.status === 'finished'` → 예상 종료일. 일정 정보가 전혀 없는 장수 방송은 '확인 불가'(회색)로 남는다.

## Syoboi 편성 병합(AniList·Kitsu 공용)

- AniList는 방송사 필드가 없고 Kitsu는 요일/시간/방송사가 거의 비어 있어 [Syoboi Calendar](https://cal.syoboi.jp)로 보충한다. Syoboi는 CORS 헤더가 없어 브라우저에서 못 부르므로 `npm run build:syoboi`(`scripts/build-syoboi.js`)가 앞으로 **14일 치**(`LOOKAHEAD_DAYS`) 편성을 받아 `public/syoboi-schedule.js`(`window.SYOBOI_SCHEDULE`)로 저장한다. 페이지 로딩 때 Syoboi를 가져오는 게 아니다. 28일 넘게 지난 파일은 클라이언트가 무시한다.
- **자동 갱신**: `vercel.json`의 `buildCommand`가 `npm run build`(= `build-syoboi.js --soft && build-webnovel.js --soft`)이므로 배포마다 새로 받는다. `--soft`는 장애/빈 응답/타임아웃에도 빌드를 실패시키지 않고 기존 파일을 쓰게 한다(결과 0건이면 덮어쓰지 않음). 주기는 `.github/workflows/refresh-syoboi.yml`이 매주 월요일 04:00 JST에 Vercel Deploy Hook(Secret `VERCEL_DEPLOY_HOOK_URL`)을 호출해 만든다(수동 실행 가능). Hook URL은 비밀값이니 코드/채팅에 쓰지 말 것. 공개 저장소는 60일간 활동이 없으면 GitHub가 스케줄 워크플로를 끄므로 갱신이 멈추면 Actions 탭에서 다시 켠다.
- 매칭/병합 로직은 공용 모듈 `public/syoboiSchedule.js`(`anilistClient.js`/`kitsuClient.js`보다 먼저 로드). 매칭은 **일본어 제목**(AniList `title.native`, Kitsu `titles.ja_jp`) 기준 3단계: ①정규화한 제목 완전 일치(`normalizeTitle`: NFKC, 기호·공백 제거, `第2期`/`Season2`/`2nd Season`/`第2クール`→`s2`, `(2005)` 제거) ②시즌 표기를 지우고 일치 ③한쪽이 다른 쪽의 접두일 때(6자 이상). 시작 연월이 24개월(③은 12개월) 넘게 다르면 다른 작품으로 버린다.
- 병합 규칙(`mergeBroadcast`): 그 API가 요일/시간을 알면 그대로 두고 **같은 요일·시간 슬롯을 가진 Syoboi 방송국**을 방송사로 채운다(없으면 첫 방송국과 일치하는 슬롯일 때만). 요일이 없으면 Syoboi 슬롯을 그대로 쓴다. 파일이 없거나 오래돼도 각 API 데이터만으로 정상 동작. 요일별 탭과 검색에만 적용(신작 탭은 방영 시각 컬럼이 없음). 방송사는 일본어 표기 그대로.
- 한계: Syoboi에 이번 주 편성이 없는 장수 방송(짱구·사자에상·도라에몽 등)과 표기가 아예 다른 작품은 매칭되지 않는다.
- **`index.html`에서 `syoboi-schedule.js`에는 `?v=`/immutable 캐시를 붙이지 않는다.**
