// Kitsu API(https://kitsu.io/api/edge)를 브라우저에서 직접 호출하는 클라이언트.
// Kitsu는 'Access-Control-Allow-Origin: *'를 응답해 브라우저에서 바로 호출할 수 있음을
// 확인했다.
//
// 이 클라이언트는 AniList/Jikan 클라이언트와 동일한 시그니처(getWeeklyRatings/
// getNewReleases/searchAnimeByTitle/checkStatus)를 독립적으로 구현한다. 과거에는 Jikan이
// 실패했을 때만 이 파일이 호출되는 2차 폴백이었지만, 지금은 화면 상단 데이터 소스 버튼
// (AniList/Kitsu/Jikan)으로 사용자가 직접 어떤 API를 쓸지 고르는 구조로 바뀌어 다른
// 클라이언트를 대신 호출하지 않는다(API 호출 실패 시엔 이 파일 자체의 Mock 데이터로만 대체).
//
// 중요한 데이터 한계(직접 확인함, 코드로 보완 불가): Kitsu의 방영 일정 필드(nextRelease)는
// 원피스·명탐정 코난처럼 계속 이어지는 상시 연재작에만 주로 채워져 있고, 시즌제로 방영하는
// 대부분의 작품은 비어 있다(직접 확인: 인기 상위 20개 현재 방영작 중 3개만 값이 있었음).
// 그래서 요일별 방영 탭에서 상당수 작품이 '방송 요일 정보 없음'(unscheduled)으로 몰릴 수
// 있다 — 버그가 아니라 Kitsu 데이터 자체의 한계다.
(function () {
  'use strict';

  const KITSU_BASE_URL = 'https://kitsu.io/api/edge';

  const REQUEST_TIMEOUT_MS = 8000;
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1000;
  const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

  // TV 방송사로 흔히 프로듀서/라이선서 목록에 함께 표기되는 명칭
  const KNOWN_BROADCAST_STATIONS = [
    'TV Tokyo', 'Fuji TV', 'TBS', 'MBS', 'ABC', 'tvk', 'AT-X', 'BS11',
    'Tokyo MX', 'NHK', 'Nippon TV', 'Yomiuri TV', 'WOWOW'
  ];

  const KOREAN_DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

  const CATEGORY_LABELS = {
    TV: 'TV', MOVIE: '극장판', OVA: 'OVA', ONA: 'ONA', SPECIAL: '스페셜', MUSIC: '뮤직'
  };

  const KITSU_PAGE_SIZE = 20; // Kitsu page[limit] 최대값(그 이상 요청하면 400 에러)
  const PAGE_INTERVAL_MS = 350;
  const WEEKLY_MAX_PAGES = 12;
  const NEW_RELEASES_MAX_PAGES = 12;
  const SEARCH_RESULT_LIMIT = 10;
  const STATUS_CHECK_TIMEOUT_MS = 6000;

  // ---- Mock Fallback 데이터 --------------------------------------------------

  const MOCK_WEEKLY_RATINGS = [
    { titleJapanese: 'ONE PIECE', titleEnglish: 'One Piece', score: 8.7, scoredBy: 291635, popularityRank: 1, favorites: 109092, broadcastDayKorean: '일', broadcastTime: '09:30', broadcastStation: 'Fuji TV', officialSite: 'https://kitsu.io/anime/one-piece', category: 'TV', genres: ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy'], themes: ['Pirate', 'Slavery', 'Fantasy World', 'Adventure', 'Swordplay'], coverImage: 'https://media.kitsu.app/anime/poster_images/12/large.jpg' },
    { titleJapanese: '名探偵コナン', titleEnglish: 'Case Closed', score: 7.9, scoredBy: 44000, popularityRank: 12, favorites: 21000, broadcastDayKorean: '토', broadcastTime: '18:00', broadcastStation: 'Nippon TV', officialSite: 'https://kitsu.io/anime/detective-conan', category: 'TV', genres: ['Adventure', 'Comedy', 'Mystery'], themes: ['Detective', 'Crime'], coverImage: null },
    { titleJapanese: '葬送のフリーレン', titleEnglish: 'Frieren: Beyond Journey’s End', score: 9.1, scoredBy: 180000, popularityRank: 5, favorites: 95000, broadcastDayKorean: '금', broadcastTime: '24:00', broadcastStation: 'Nippon TV', officialSite: 'https://kitsu.io/anime/frieren-beyond-journeys-end', category: 'TV', genres: ['Adventure', 'Drama', 'Fantasy'], themes: ['Elf', 'Journey'], coverImage: null }
  ];

  const MOCK_NEW_RELEASES = [
    { titleJapanese: 'Re:ゼロから始める異世界生活 4th season', titleEnglish: 'Re:ZERO -Starting Life in Another World- Season 4', studio: 'White Fox', firstAirDate: '2026-04-08', genres: ['Drama', 'Fantasy', 'Suspense'], officialSite: 'https://kitsu.io/anime/re-zero-starting-life-in-another-world-season-4', category: 'TV', themes: ['Isekai', 'Time Manipulation'], coverImage: null },
    { titleJapanese: '無職転生III ～異世界行ったら本気だす～', titleEnglish: 'Mushoku Tensei III: Isekai Ittara Honki Dasu', studio: 'Studio Bind', firstAirDate: '2026-07-06', genres: ['Adventure', 'Drama', 'Fantasy', 'Ecchi'], officialSite: 'https://kitsu.io/anime/mushoku-tensei-iii', category: 'TV', themes: ['Isekai', 'Reincarnation'], coverImage: null }
  ];

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function formatCategory(raw) {
    if (!raw) return '정보 없음';
    return CATEGORY_LABELS[String(raw).toUpperCase()] || String(raw);
  }

  function formatDate(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getBroadcastWeekRange(endDate) {
    const [y, m, d] = endDate.split('-').map(Number);
    const end = new Date(Date.UTC(y, m - 1, d));
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - 6);
    return { startDate: formatDate(start), endDate: formatDate(end) };
  }

  function resolveSeason(date) {
    const month = date.getUTCMonth() + 1;
    const year = date.getUTCFullYear();
    if (month <= 3) return { year, season: 'winter' };
    if (month <= 6) return { year, season: 'spring' };
    if (month <= 9) return { year, season: 'summer' };
    return { year, season: 'fall' };
  }

  // 기준 날짜가 속한 분기(계절)의 달력상 시작일~종료일을 계산한다. Kitsu는
  // filter[startDate] 범위 필터를 지원하지 않아(직접 확인: 400 Filter not allowed)
  // 후보를 넓게 가져온 뒤 이 범위로 클라이언트에서 걸러낸다.
  function getQuarterRange(dateStr) {
    const [y] = dateStr.split('-').map(Number);
    const { season } = resolveSeason(new Date(`${dateStr}T00:00:00Z`));
    const ranges = {
      winter: [`${y}-01-01`, `${y}-03-31`],
      spring: [`${y}-04-01`, `${y}-06-30`],
      summer: [`${y}-07-01`, `${y}-09-30`],
      fall: [`${y}-10-01`, `${y}-12-31`]
    };
    const [start, end] = ranges[season];
    return { startDate: start, endDate: end };
  }

  /**
   * Jikan의 broadcast.day/time과 달리 Kitsu는 다음 방영 시각(nextRelease)을
   * 타임존 오프셋이 포함된 ISO 문자열로 준다(예: "2026-09-20T09:30:00.000+09:00").
   * 오프셋이 이미 +09:00(JST)로 박혀 있으므로, 문자열의 날짜/시각 부분을 그대로
   * 일본 현지 시각으로 읽으면 된다(타임존 변환 계산이 필요 없음). 30시간제 관례에
   * 맞춰 심야(0~5시대)는 전날 요일로 재배정한다.
   */
  function resolveBroadcastSlotFromNextRelease(nextRelease) {
    if (!nextRelease) return { dayKorean: null, timeText: null };

    const match = nextRelease.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!match) return { dayKorean: null, timeText: null };

    const [, y, m, d, hh, mm] = match;
    const dow = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).getUTCDay();
    const hour = Number(hh);

    if (hour >= 0 && hour < 6) {
      const prevDow = (dow + 6) % 7;
      return { dayKorean: KOREAN_DAY_LABELS[prevDow], timeText: `${hour + 24}:${mm}` };
    }

    return { dayKorean: KOREAN_DAY_LABELS[dow], timeText: `${hh}:${mm}` };
  }

  function formatBroadcastLabel(nextRelease) {
    const slot = resolveBroadcastSlotFromNextRelease(nextRelease);
    if (slot.dayKorean && slot.timeText) {
      return `${slot.dayKorean} ${slot.timeText}`;
    }
    return '정보 없음';
  }

  // popularityRank(낮을수록 인기) 기준 오름차순 정렬. 값이 없는 항목은 뒤로.
  function sortByPopularityRank(list) {
    return [...list].sort((a, b) => {
      if (a.popularityRank === null && b.popularityRank === null) return 0;
      if (a.popularityRank === null) return 1;
      if (b.popularityRank === null) return -1;
      return a.popularityRank - b.popularityRank;
    });
  }

  function buildWeeklyRatingDays(startDate, endDate, items) {
    const dates = [];
    let cursor = new Date(`${startDate}T00:00:00Z`);
    const endCursor = new Date(`${endDate}T00:00:00Z`);

    while (cursor.getTime() <= endCursor.getTime()) {
      dates.push(formatDate(cursor));
      cursor = new Date(cursor.getTime());
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const days = dates.map((dateStr) => {
      const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
      const dayOfWeek = KOREAN_DAY_LABELS[dow];
      const dayItems = sortByPopularityRank(items.filter((item) => item.broadcastDayKorean === dayOfWeek));
      return { date: dateStr, dayOfWeek, items: dayItems };
    });

    const unscheduled = sortByPopularityRank(items.filter((item) => !item.broadcastDayKorean));

    return { days, unscheduled };
  }

  async function fetchKitsu(path, params = {}, attempt = 0) {
    const url = new URL(`${KITSU_BASE_URL}${path}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        return fetchKitsu(path, params, attempt + 1);
      }

      if (!response.ok) {
        throw new Error(`Kitsu API 응답 오류: HTTP ${response.status}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // anime.id 기준으로 중복을 제거한다(mal_id 기준으로 Jikan 쪽에서 하던 것과 동일한
  // 이유 — 페이지네이션 도중 같은 항목이 중복 수집될 수 있음).
  function dedupeById(list) {
    const seenIds = new Set();
    const deduped = [];
    list.forEach((resource) => {
      if (seenIds.has(resource.id)) return;
      seenIds.add(resource.id);
      deduped.push(resource);
    });
    return deduped;
  }

  // Kitsu는 offset 기반 페이지네이션이며, 페이지마다 딸려오는 included(관계로 연결된
  // 스튜디오/장르/카테고리 등)를 하나로 모아야 각 anime의 relationships 포인터를 끝까지
  // 풀 수 있다.
  //
  // 주의: 가끔 특정 페이지(주로 두 번째 페이지)가 앞 페이지와 완전히 동일한 결과를
  // 돌려주는 경우가 관찰됐다(Kitsu 쪽의 간헐적인 문제로 보임 — 오프셋 자체가 항상
  // 무시되는 건 아니고, 이후 페이지들은 정상적으로 새 데이터를 준다는 것도 직접
  // 확인함). 그래서 "새 데이터가 없는 페이지를 만나면 페이지네이션 전체를 중단"하는
  // 방식은 실제로는 아직 남아있는 뒤쪽 페이지들까지 통째로 못 가져오게 만들어 결과가
  // 크게 줄어드는 원인이 됐다. 지금은 중복된 페이지는 그냥 건너뛰고(추가할 새 항목이
  // 없을 뿐) offset은 계속 증가시켜 다음 페이지를 계속 시도한다 — 중단 조건은
  // meta.count 기반의 "더 가져올 데이터가 없음"과 maxPages 상한 뿐이다.
  async function fetchKitsuAllPages(path, params, maxPages) {
    const collectedData = [];
    const collectedIncluded = [];
    const seenIds = new Set();
    let offset = 0;

    for (let page = 0; page < maxPages; page += 1) {
      if (page > 0) await sleep(PAGE_INTERVAL_MS);

      const response = await fetchKitsu(path, { ...params, 'page[limit]': KITSU_PAGE_SIZE, 'page[offset]': offset });
      const pageData = response?.data || [];
      const newItems = pageData.filter((resource) => !seenIds.has(resource.id));

      newItems.forEach((resource) => seenIds.add(resource.id));
      collectedData.push(...newItems);
      collectedIncluded.push(...(response?.included || []));

      const total = response?.meta?.count ?? offset + pageData.length;
      offset += KITSU_PAGE_SIZE;
      if (offset >= total) break;
    }

    return { data: dedupeById(collectedData), included: collectedIncluded };
  }

  // JSON:API의 included 배열을 'type:id' 키로 바로 찾을 수 있게 인덱싱한다.
  function buildIncludedIndex(included) {
    const index = new Map();
    (included || []).forEach((resource) => {
      index.set(`${resource.type}:${resource.id}`, resource);
    });
    return index;
  }

  function resolveRelationshipList(resource, relationshipName, includedIndex) {
    const pointers = resource.relationships?.[relationshipName]?.data;
    if (!Array.isArray(pointers)) return [];
    return pointers
      .map((pointer) => includedIndex.get(`${pointer.type}:${pointer.id}`))
      .filter(Boolean);
  }

  function resolveRelationshipOne(resource, relationshipName, includedIndex) {
    const pointer = resource.relationships?.[relationshipName]?.data;
    if (!pointer) return null;
    return includedIndex.get(`${pointer.type}:${pointer.id}`) || null;
  }

  // anime -> animeProductions(역할별) -> producer(실제 회사명)까지 관계를 두 단계 풀어
  // role이 roles 배열에 속하는 회사명 목록을 반환한다(studio/producer/licensor 등).
  function extractProducerNames(anime, includedIndex, roles) {
    const productions = resolveRelationshipList(anime, 'animeProductions', includedIndex);
    const matched = productions.filter((production) => roles.includes(production.attributes?.role));
    return matched
      .map((production) => resolveRelationshipOne(production, 'producer', includedIndex))
      .map((producer) => producer?.attributes?.name)
      .filter(Boolean);
  }

  function extractStudio(anime, includedIndex) {
    const studioNames = extractProducerNames(anime, includedIndex, ['studio']);
    if (studioNames.length > 0) return studioNames.join(', ');
    const producerNames = extractProducerNames(anime, includedIndex, ['producer']);
    return producerNames.length > 0 ? producerNames.join(', ') : '미지정(Unknown)';
  }

  function extractBroadcastStation(anime, includedIndex) {
    const allNames = extractProducerNames(anime, includedIndex, ['producer', 'licensor', 'studio']);
    const matched = allNames.find((name) => KNOWN_BROADCAST_STATIONS.some((station) => name.includes(station)));
    return matched || '정보 없음';
  }

  function extractGenres(anime, includedIndex) {
    return resolveRelationshipList(anime, 'genres', includedIndex)
      .map((genre) => genre.attributes?.name)
      .filter(Boolean);
  }

  // Kitsu의 'categories' 관계는 genres보다 더 세분화된 태그(예: Pirate, Swordplay,
  // Isekai)라 '테마' 항목으로 취급한다(직접 확인: genres 관계의 attributes.name과
  // 달리 categories 관계는 attributes.title에 이름이 담겨 있음). 너무 많은 경우가
  // 흔해 상위 5개만 사용한다.
  function extractThemes(anime, includedIndex) {
    return resolveRelationshipList(anime, 'categories', includedIndex)
      .map((category) => category.attributes?.title)
      .filter(Boolean)
      .slice(0, 5);
  }

  // Kitsu의 averageRating은 0~100 스케일이라, MAL(0~10 스케일) 기준 화면과 맞추기
  // 위해 10으로 나눈다.
  function parseScore(attrs) {
    const rating = parseFloat(attrs.averageRating);
    return Number.isFinite(rating) ? Math.round((rating / 10) * 100) / 100 : null;
  }

  // ratingFrequencies는 '점수별 평가자 수' 히스토그램이라, 전체 합이 MAL의
  // scored_by(평가 참여자 수)에 대응한다.
  function parseScoredBy(attrs) {
    const freq = attrs.ratingFrequencies || {};
    const values = Object.values(freq).map(Number).filter(Number.isFinite);
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0);
  }

  function officialSiteFor(attrs) {
    return attrs.slug ? `https://kitsu.io/anime/${attrs.slug}` : null;
  }

  function extractCoverImage(attrs) {
    return attrs.posterImage?.large || attrs.posterImage?.medium || attrs.posterImage?.original || null;
  }

  function extractTitles(attrs) {
    const titles = attrs.titles || {};
    return {
      titleJapanese: titles.ja_jp || titles.en_jp || attrs.canonicalTitle || '정보 없음',
      titleEnglish: titles.en || attrs.canonicalTitle || '정보 없음'
    };
  }

  function mapToWeeklyItem(anime, includedIndex) {
    const attrs = anime.attributes;
    const { titleJapanese, titleEnglish } = extractTitles(attrs);
    const slot = resolveBroadcastSlotFromNextRelease(attrs.nextRelease);

    return {
      titleJapanese,
      titleEnglish,
      score: parseScore(attrs),
      scoredBy: parseScoredBy(attrs),
      popularityRank: typeof attrs.popularityRank === 'number' ? attrs.popularityRank : null,
      favorites: typeof attrs.favoritesCount === 'number' ? attrs.favoritesCount : null,
      broadcastDayKorean: slot.dayKorean,
      broadcastTime: slot.timeText,
      broadcastStation: extractBroadcastStation(anime, includedIndex),
      officialSite: officialSiteFor(attrs),
      category: formatCategory(attrs.subtype),
      genres: extractGenres(anime, includedIndex),
      themes: extractThemes(anime, includedIndex),
      coverImage: extractCoverImage(attrs)
    };
  }

  function mapToReleaseItem(anime, includedIndex) {
    const attrs = anime.attributes;
    const { titleJapanese, titleEnglish } = extractTitles(attrs);

    return {
      titleJapanese,
      titleEnglish,
      studio: extractStudio(anime, includedIndex),
      firstAirDate: attrs.startDate || '미정',
      genres: extractGenres(anime, includedIndex),
      officialSite: officialSiteFor(attrs),
      category: formatCategory(attrs.subtype),
      themes: extractThemes(anime, includedIndex),
      coverImage: extractCoverImage(attrs)
    };
  }

  function mapToSearchItem(anime, includedIndex) {
    const attrs = anime.attributes;
    const { titleJapanese, titleEnglish } = extractTitles(attrs);

    return {
      titleJapanese,
      titleEnglish,
      score: parseScore(attrs),
      scoredBy: parseScoredBy(attrs),
      popularityRank: typeof attrs.popularityRank === 'number' ? attrs.popularityRank : null,
      favorites: typeof attrs.favoritesCount === 'number' ? attrs.favoritesCount : null,
      firstAirDate: attrs.startDate || '미정',
      broadcastTime: formatBroadcastLabel(attrs.nextRelease),
      episodes: typeof attrs.episodeCount === 'number' ? attrs.episodeCount : null,
      broadcastStation: extractBroadcastStation(anime, includedIndex),
      officialSite: officialSiteFor(attrs),
      category: formatCategory(attrs.subtype),
      genres: extractGenres(anime, includedIndex),
      themes: extractThemes(anime, includedIndex),
      coverImage: extractCoverImage(attrs)
    };
  }

  // ---- 공개 함수 ------------------------------------------------------------
  // 세 함수 모두 API 호출에 실패하면(요일별/신작은) Mock 데이터로, (검색은) 명확한
  // 에러로 대체한다. 다른 소스(AniList/Jikan)를 대신 호출하지 않는다.

  async function getWeeklyRatings(endDate) {
    const { startDate, endDate: normalizedEndDate } = getBroadcastWeekRange(endDate);

    try {
      const { data, included } = await fetchKitsuAllPages(
        '/anime',
        { 'filter[status]': 'current', 'filter[subtype]': 'TV', include: 'animeProductions.producer,genres,categories' },
        WEEKLY_MAX_PAGES
      );

      if (data.length === 0) {
        throw new Error('Kitsu에서 현재 방영 중인 애니메이션 데이터를 찾을 수 없습니다.');
      }

      const includedIndex = buildIncludedIndex(included);
      const items = data.map((anime) => mapToWeeklyItem(anime, includedIndex));
      const { days, unscheduled } = buildWeeklyRatingDays(startDate, normalizedEndDate, items);

      return { source: 'kitsu', period: { startDate, endDate: normalizedEndDate }, days, unscheduled };
    } catch (error) {
      console.error(`[kitsuClient] getWeeklyRatings API 조회 실패, Mock 데이터로 대체합니다: ${error.message}`);
      const { days, unscheduled } = buildWeeklyRatingDays(startDate, normalizedEndDate, MOCK_WEEKLY_RATINGS);
      return { source: 'mock', period: { startDate, endDate: normalizedEndDate }, days, unscheduled };
    }
  }

  async function getNewReleases(endDate) {
    const { startDate, endDate: normalizedEndDate } = getBroadcastWeekRange(endDate);
    const { startDate: quarterStart, endDate: quarterEnd } = getQuarterRange(normalizedEndDate);

    try {
      const { data, included } = await fetchKitsuAllPages(
        '/anime',
        { 'filter[status]': 'current', 'filter[subtype]': 'TV', include: 'animeProductions.producer,genres,categories', sort: '-startDate' },
        NEW_RELEASES_MAX_PAGES
      );

      if (data.length === 0) {
        throw new Error('Kitsu에서 방영작 데이터를 찾을 수 없습니다.');
      }

      const includedIndex = buildIncludedIndex(included);
      const releases = data
        .filter((anime) => {
          const start = anime.attributes.startDate;
          return start && start >= quarterStart && start <= quarterEnd;
        })
        .map((anime) => mapToReleaseItem(anime, includedIndex));

      if (releases.length === 0) {
        throw new Error('Kitsu에서 해당 분기에 시작한 방영작을 찾지 못했습니다.');
      }

      return { source: 'kitsu', period: { startDate, endDate: normalizedEndDate }, releases };
    } catch (error) {
      console.error(`[kitsuClient] getNewReleases API 조회 실패, Mock 데이터로 대체합니다: ${error.message}`);
      return { source: 'mock', period: { startDate, endDate: normalizedEndDate }, releases: MOCK_NEW_RELEASES };
    }
  }

  async function searchAnimeByTitle(title) {
    const query = (title || '').trim();
    if (!query) return { source: 'empty', query, results: [] };

    try {
      const data = await fetchKitsu('/anime', {
        'filter[text]': query,
        'page[limit]': SEARCH_RESULT_LIMIT,
        include: 'animeProductions.producer,genres,categories'
      });

      const includedIndex = buildIncludedIndex(data?.included);
      const results = (data?.data || []).map((anime) => mapToSearchItem(anime, includedIndex));

      return { source: 'kitsu', query, results };
    } catch (error) {
      console.error(`[kitsuClient] searchAnimeByTitle API 조회 실패: ${error.message}`);
      return {
        source: 'error',
        query,
        results: [],
        errorMessage: '검색 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
      };
    }
  }

  /**
   * 상단 데이터 소스 버튼 옆 상태 점(초록/빨강)을 위한 단발성 진단 요청.
   * 재시도 없이 1회만 호출한다.
   */
  async function checkStatus() {
    const url = new URL(`${KITSU_BASE_URL}/anime`);
    url.searchParams.set('filter[status]', 'current');
    url.searchParams.set('filter[subtype]', 'TV');
    url.searchParams.set('page[limit]', '1');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STATUS_CHECK_TIMEOUT_MS);
    const startedAt = Date.now();

    try {
      const response = await fetch(url, { signal: controller.signal });
      return { ok: response.ok, status: response.status, elapsedMs: Date.now() - startedAt };
    } catch (error) {
      return {
        ok: false,
        status: null,
        error: error.name === 'AbortError' ? '응답 시간 초과' : error.message,
        elapsedMs: Date.now() - startedAt
      };
    } finally {
      clearTimeout(timer);
    }
  }

  window.KitsuClient = {
    getWeeklyRatings,
    getNewReleases,
    searchAnimeByTitle,
    checkStatus
  };
})();
