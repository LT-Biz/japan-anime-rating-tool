---
paths:
  - "public/jikanClient.js"
---

# Jikan 클라이언트 규칙

- **재시도**: 429뿐 아니라 500/502/503/504(MAL 연결 실패 게이트웨이 오류)도 재시도하며 시도할수록 대기시간이 늘어난다. Jikan/MAL이 통째로 다운되는 경우(과거 여러 날 지속)엔 재시도해도 소용없고 Mock 폴백/에러 메시지로 degrade되는 게 최선이다 — 재시도 횟수를 늘려 "고치려" 하지 말 것.
- **요일별(`getWeeklyRatings`)**: 인기 랭킹(top)이 아니라 `/seasons/now`(현재 방영 중 전체 TV)를 **페이지네이션 전체**에서 수집한다(1페이지=25건뿐). `mal_id`로 중복 제거 후 `anime.airing === true`만 남기고, 30시간제 관례(`resolveBroadcastSlot`)로 심야(0~5시)는 전날 요일로 재배정한다. 요일 정보가 없으면 `unscheduled`로 분리(숨기지 않음). 시청률(%) 대신 MAL 지표(평점/참여자 수/인기도 순위/즐겨찾기)만 노출한다.
  - 원피스·블리치 같은 초장기 연재작은 `season`이 예전 시즌에 고정돼 있어 `/seasons/now`에 안 잡히는데, **의도적으로 제외**한 것이다(`/top/anime?filter=airing` 결합은 요청이 늘어 오류가 잦아 되돌림).
- **분기 신작(`getNewReleases`)**: 기준 종료일이 속한 시즌(`/seasons/{year}/{season}`)의 TV를 최대 `NEW_RELEASES_MAX_PAGES`=4페이지 수집해 **분기 전체를 그대로** 반환한다(7일 `aired.from` 필터는 결과 0건 → Mock 대체가 잦아 제거함). UI에 안내 문구가 있다.
- **검색(`searchAnimeByTitle`)**: `/anime?q=` 사용, 유사도 결과를 그대로 반환. API 실패 시 **Mock 대신 명확한 에러 메시지**를 반환한다(세 클라이언트 공통 원칙 — 무관한 Mock은 오도한다).
- 방영 상태 점: MAL 상태 + 예상 종료일(시작일+(총회차-1)주+28일)만 쓴다. `themes`는 Jikan `themes`+`demographics`.
- **Mock 폴백**은 이 클라이언트 자체가 실패했을 때만(요일별/신작), 다른 소스로 전환하지 않는다. Mock의 공식 사이트/커버 이미지 링크는 실제 존재를 확인한 URL만 쓴다(가짜 도메인 금지).
