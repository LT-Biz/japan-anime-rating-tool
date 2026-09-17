// Jikan REST API v4(MyAnimeList 비공식 오픈 API)를 브라우저에서 직접 호출하는 클라이언트.
// 별도 백엔드 서버 없이 정적 파일만으로 배포하기 위해 브라우저에서 직접 실행된다.
// Jikan은 'Access-Control-Allow-Origin: *'를 응답해 브라우저에서 바로 호출할 수 있음을
// 확인했다(CORS 제한 없음).
//
// 이 클라이언트는 AniList/Kitsu 클라이언트와 동일한 시그니처(getWeeklyRatings/
// getNewReleases/searchAnimeByTitle/checkStatus)를 독립적으로 구현한다. 과거에는 Jikan이
// 실패하면 이 파일이 내부적으로 Kitsu를 대신 호출하는 폴백 체인이었지만, 지금은 화면 상단
// 데이터 소스 버튼(AniList/Kitsu/Jikan)으로 사용자가 직접 어떤 API를 쓸지 고르는 구조로
// 바뀌어 다른 클라이언트를 대신 호출하지 않는다(API 호출 실패 시엔 이 파일 자체의 Mock
// 데이터로만 대체).
(function () {
  'use strict';

  const JIKAN_BASE_URL = 'https://api.jikan.moe/v4';

  // Jikan Rate Limit(3req/sec, 60req/min) 대응 + MAL 게이트웨이 장애(502/503/504) 대응:
  // 재시도 대상 상태코드에 대해 시도할수록 대기 시간을 늘려가며 재시도한다.
  const REQUEST_TIMEOUT_MS = 8000;
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1000;
  const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

  // TV 방송사로 흔히 프로듀서 목록에 함께 표기되는 명칭(Jikan에 방송사 전용 필드가 없어 추론용으로 사용)
  const KNOWN_BROADCAST_STATIONS = [
    'TV Tokyo', 'Fuji TV', 'TBS', 'MBS', 'ABC', 'tvk', 'AT-X', 'BS11',
    'Tokyo MX', 'NHK', 'Nippon TV', 'Yomiuri TV', 'WOWOW'
  ];

  const DAY_INDEX_MAP = {
    Sundays: 0, Mondays: 1, Tuesdays: 2, Wednesdays: 3, Thursdays: 4, Fridays: 5, Saturdays: 6
  };
  const KOREAN_DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

  const CATEGORY_LABELS = {
    TV: 'TV', MOVIE: '극장판', OVA: 'OVA', ONA: 'ONA', SPECIAL: '스페셜', MUSIC: '뮤직', TV_SPECIAL: 'TV 스페셜'
  };

  // ---- Mock Fallback 데이터 ------------------------------------------------
  // 실시간 API 호출이 Rate Limit/네트워크 오류로 실패했을 때 화면이 비지 않도록
  // 실제 방영 편성과 유사한 형태(심야 애니메이션 포함)로 구성한 대체 데이터.

  const MOCK_WEEKLY_RATINGS = [
    { titleJapanese: 'ONE PIECE', titleEnglish: 'One Piece', score: 8.73, scoredBy: 1544384, popularityRank: 17, favorites: 254182, broadcastDayKorean: '일', broadcastTime: '09:30', broadcastStation: 'Fuji TV', officialSite: 'https://one-piece.com', category: 'TV', genres: ['Action', 'Adventure', 'Fantasy'], themes: ['Pirates', 'Super Power'], coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21-ELSYx3yMPcKM.jpg' },
    { titleJapanese: 'Re:ゼロから始める異世界生活 4th season', titleEnglish: 'Re:ZERO -Starting Life in Another World- Season 4', score: 8.4, scoredBy: 42000, popularityRank: 310, favorites: 8200, broadcastDayKorean: '수', broadcastTime: '22:00', broadcastStation: 'AT-X', officialSite: 'https://re-zero-anime.jp/tv/', category: 'TV', genres: ['Drama', 'Fantasy', 'Suspense'], themes: ['Isekai', 'Time Manipulation'], coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx189046-yaHWtS5FII46.jpg' },
    { titleJapanese: '名探偵コナン', titleEnglish: 'Case Closed', score: 8.16, scoredBy: 111000, popularityRank: 245, favorites: 21000, broadcastDayKorean: '토', broadcastTime: '18:00', broadcastStation: 'Nippon TV', officialSite: 'https://www.conan-portal.com', category: 'TV', genres: ['Adventure', 'Comedy', 'Mystery'], themes: ['Detective'], coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx235-MyYT7K3chBdO.jpg' },
    { titleJapanese: 'チェンソーマン', titleEnglish: 'Chainsaw Man', score: 8.51, scoredBy: 850000, popularityRank: 65, favorites: 68000, broadcastDayKorean: '월', broadcastTime: '25:30', broadcastStation: 'MBS', officialSite: 'https://chainsawman.dog', category: 'TV', genres: ['Action', 'Fantasy', 'Horror'], themes: ['Demons', 'Gore'], coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx127230-DdP4vAdssLoz.png' },
    { titleJapanese: '呪術廻戦', titleEnglish: 'Jujutsu Kaisen', score: 8.51, scoredBy: 980000, popularityRank: 48, favorites: 71000, broadcastDayKorean: '목', broadcastTime: '24:56', broadcastStation: 'MBS', officialSite: 'https://jujutsukaisen.jp', category: 'TV', genres: ['Action', 'Drama', 'Supernatural'], themes: ['School', 'Curses'], coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx113415-LHBAeoZDIsnF.jpg' },
    { titleJapanese: '葬送のフリーレン', titleEnglish: 'Frieren: Beyond Journey’s End', score: 9.29, scoredBy: 720000, popularityRank: 32, favorites: 95000, broadcastDayKorean: '금', broadcastTime: '24:00', broadcastStation: 'Nippon TV', officialSite: 'https://frieren-anime.jp', category: 'TV', genres: ['Adventure', 'Drama', 'Fantasy'], themes: ['Elf', 'Iyashikei'], coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx154587-qQTzQnEJJ3oB.jpg' },
    { titleJapanese: 'SPY×FAMILY', titleEnglish: 'Spy x Family', score: 8.62, scoredBy: 900000, popularityRank: 27, favorites: 88000, broadcastDayKorean: '토', broadcastTime: '23:00', broadcastStation: 'TV Tokyo', officialSite: 'https://spy-family.net', category: 'TV', genres: ['Action', 'Comedy'], themes: ['Family Life', 'Espionage'], coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx140960-Kb6R5nYQfjmP.jpg' },
    { titleJapanese: 'マッシュル-MASHLE-', titleEnglish: 'Mashle: Magic and Muscles', score: 7.4, scoredBy: 210000, popularityRank: 520, favorites: 5400, broadcastDayKorean: '화', broadcastTime: '25:25', broadcastStation: 'TV Tokyo', officialSite: 'https://mashle-pr.com', category: 'TV', genres: ['Action', 'Comedy', 'Fantasy'], themes: ['School', 'Parody'], coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx151801-XxVf22Le6C8o.png' }
  ];

  const MOCK_NEW_RELEASES = [
    { titleJapanese: 'Re:ゼロから始める異世界生活 4th season', titleEnglish: 'Re:ZERO -Starting Life in Another World- Season 4', studio: 'White Fox', firstAirDate: '2026-04-08', genres: ['Drama', 'Fantasy', 'Suspense'], officialSite: 'https://re-zero-anime.jp/tv/', category: 'TV', themes: ['Isekai', 'Time Manipulation'], coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx189046-yaHWtS5FII46.jpg' },
    { titleJapanese: 'スティール・ボール・ラン ジョジョの奇妙な冒険', titleEnglish: "Steel Ball Run: JoJo's Bizarre Adventure", studio: 'David Production', firstAirDate: '2026-03-19', genres: ['Action', 'Adventure', 'Mystery', 'Supernatural'], officialSite: 'https://jojo-portal-anime.com/sbr/', category: 'TV', themes: ['Superpowers', 'Journey'], coverImage: null },
    { titleJapanese: '無職転生III ～異世界行ったら本気だす～', titleEnglish: 'Mushoku Tensei III: Isekai Ittara Honki Dasu', studio: 'Studio Bind', firstAirDate: '2026-07-06', genres: ['Adventure', 'Drama', 'Fantasy', 'Ecchi'], officialSite: 'https://mushokutensei.jp', category: 'TV', themes: ['Isekai', 'Reincarnation'], coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx178789-hNXjKFzUq7mk.jpg' },
    { titleJapanese: '薬屋のひとりごと 第2期', titleEnglish: 'The Apothecary Diaries Season 2', studio: 'OLM, TOHO animation STUDIO', firstAirDate: '2025-01-10', genres: ['Drama', 'Mystery'], officialSite: 'https://kusuriyanohitorigoto.jp/season2/', category: 'TV', themes: ['Palace', 'Medicine'], coverImage: null }
  ];

  // ---- 공통 유틸 ------------------------------------------------------------

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function formatCategory(raw) {
    if (!raw) return '정보 없음';
    return CATEGORY_LABELS[String(raw).toUpperCase().replace(/\s+/g, '_')] || String(raw);
  }

  // 날짜 성분을 방문자 브라우저의 로컬 타임존에 영향받지 않는 UTC 기준으로 다룬다.
  // (브라우저마다 타임존이 제각각이라, 로컬 getter로 읽으면 방문자 위치에 따라
  //  날짜가 하루 밀리는 오류가 날 수 있다.)
  function formatDate(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * 일본 방송 업계의 '30시간제' 관례를 반영해 조회 구간을 계산한다.
   * 00:00~05:59에 방송되는 심야 애니메이션은 전날 편성으로 취급되므로,
   * 종료일 다음날 06:00 이전 방송분까지 놓치지 않도록 조회 마감 시각을 확장한다.
   */
  function getBroadcastWeekRange(endDate) {
    const [y, m, d] = endDate.split('-').map(Number);
    const end = new Date(Date.UTC(y, m - 1, d));

    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - 6);

    const extendedEnd = new Date(end);
    extendedEnd.setUTCDate(extendedEnd.getUTCDate() + 1);
    extendedEnd.setUTCHours(6, 0, 0, 0);

    return {
      startDate: formatDate(start),
      endDate: formatDate(end),
      extendedEndDateTime: extendedEnd
    };
  }

  /**
   * Jikan의 표준 24시간 표기(day: 'Tuesdays', time: '01:30')를 방송 업계의
   * 30시간제 관례(심야 0~5시대는 전날 24~29시로 취급)에 맞춰 '요일별 섹션 배정용
   * 요일'과 '표시용 시간'으로 분리한다. 예: 화요일 01:30 방송 → 요일 '월', 시간 '25:30'.
   * day/time 정보가 없거나 알 수 없는 요일 코드면 dayKorean은 null(요일 미상 처리).
   */
  function resolveBroadcastSlot(day, time) {
    if (!day || !time) return { dayKorean: null, timeText: null };

    const dayIndex = DAY_INDEX_MAP[day];
    const [hourStr, minuteStr] = time.split(':');
    const hour = parseInt(hourStr, 10);

    if (dayIndex === undefined || Number.isNaN(hour)) {
      return { dayKorean: null, timeText: `${day} ${time}` };
    }

    if (hour >= 0 && hour < 6) {
      const prevDayIndex = (dayIndex + 6) % 7;
      return { dayKorean: KOREAN_DAY_LABELS[prevDayIndex], timeText: `${hour + 24}:${minuteStr}` };
    }

    return { dayKorean: KOREAN_DAY_LABELS[dayIndex], timeText: `${hour}:${minuteStr}` };
  }

  /**
   * 요일별 섹션 배정과 달리, 검색 결과는 단건 상세 표시이므로 요일+시간을 하나의
   * 문자열로 합쳐서 보여준다("월 25:30" 형태). 30시간제 보정이 불가능한 경우(요일
   * 코드 불명 등)엔 Jikan이 제공하는 원문 문자열로, 그마저 없으면 '정보 없음'으로 대체.
   */
  function formatBroadcastLabel(anime) {
    const slot = resolveBroadcastSlot(anime.broadcast?.day, anime.broadcast?.time);
    if (slot.dayKorean && slot.timeText) {
      return `${slot.dayKorean} ${slot.timeText}`;
    }
    return anime.broadcast?.string || '정보 없음';
  }

  function resolveSeason(date) {
    const month = date.getUTCMonth() + 1;
    const year = date.getUTCFullYear();

    if (month <= 3) return { year, season: 'winter' };
    if (month <= 6) return { year, season: 'spring' };
    if (month <= 9) return { year, season: 'summer' };
    return { year, season: 'fall' };
  }

  function extractBroadcastStation(anime) {
    const producerNames = (anime.producers || []).map((p) => p.name);
    const matched = producerNames.find((name) =>
      KNOWN_BROADCAST_STATIONS.some((station) => name.includes(station))
    );
    return matched || '정보 없음';
  }

  // studios가 null/빈 배열이거나, 배열 안 항목에 name이 비어 있는 경우까지 안전하게 처리
  function extractStudio(anime) {
    const studioNames = Array.isArray(anime.studios)
      ? anime.studios.map((s) => s?.name).filter(Boolean)
      : [];
    return studioNames.length > 0 ? studioNames.join(', ') : '미지정(Unknown)';
  }

  function extractOfficialSite(anime) {
    const officialEntry = (anime.external || []).find((link) => link.name === 'Official Site');
    return officialEntry?.url || anime.url || null;
  }

  function extractGenres(anime) {
    return (anime.genres || []).map((g) => g.name).filter(Boolean);
  }

  // themes(작품 소재)와 demographics(대상 독자층)를 함께 '테마'로 취급한다.
  function extractThemes(anime) {
    const themeNames = (anime.themes || []).map((t) => t.name).filter(Boolean);
    const demographicNames = (anime.demographics || []).map((d) => d.name).filter(Boolean);
    return [...themeNames, ...demographicNames];
  }

  function extractCoverImage(anime) {
    return anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || null;
  }

  // popularityRank(낮을수록 인기)를 기준으로 오름차순 정렬한다. 값이 없는 항목은 뒤로 보낸다.
  function sortByPopularityRank(list) {
    return [...list].sort((a, b) => {
      if (a.popularityRank === null && b.popularityRank === null) return 0;
      if (a.popularityRank === null) return 1;
      if (b.popularityRank === null) return -1;
      return a.popularityRank - b.popularityRank;
    });
  }

  /**
   * startDate~endDate(7일) 구간의 달력 날짜 7개를 만들고, 각 날짜의 요일(30시간제 보정
   * 완료된 broadcastDayKorean 기준)에 해당하는 애니메이션만 그 날짜의 섹션에 배정한다.
   * 7일 연속 구간은 월~일 각 요일이 정확히 한 번씩만 나오므로 요일 문자열 하나당
   * 날짜 하나로 1:1 매핑된다. 방송 요일 정보가 없는 항목은 별도로 unscheduled에 모은다.
   */
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

  /**
   * Jikan API GET 요청.
   * 429(Rate Limit)뿐 아니라 500/502/503/504(MAL 쪽 게이트웨이 장애로 Jikan이
   * "MyAnimeList may be down/unavailable"를 반환하는 경우)도 재시도 대상으로 삼는다.
   * 재시도할수록 대기 시간을 늘리고, 최종 실패는 호출부에서 Mock Fallback으로
   * 전환하도록 그대로 던진다.
   */
  async function fetchJikan(path, params = {}, attempt = 0) {
    const url = new URL(`${JIKAN_BASE_URL}${path}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        return fetchJikan(path, params, attempt + 1);
      }

      if (!response.ok) {
        throw new Error(`Jikan API 응답 오류: HTTP ${response.status}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // /seasons/now는 페이지당 25건씩 나눠서 내려오고, TV 애니메이션만 필터링해도
  // 보통 100건 안팎(여러 페이지)이 나온다. 1페이지(25건)만 보면 요일 분포가 편중되어
  // 특정 요일에 방영작이 하나도 안 걸리는 경우가 생긴다. 페이지네이션 전체를 순회해
  // '현재 방영 중'인 전체 애니메이션을 모은다. Jikan Rate Limit(3req/sec)을 넘지
  // 않도록 페이지를 동시에 쏘지 않고 순차적으로 요청한다.
  const SEASON_NOW_MAX_PAGES = 12; // 비정상적으로 페이지가 많아도 과도한 호출을 막는 안전장치
  const NEW_RELEASES_MAX_PAGES = 4; // 한 분기 TV 애니메이션은 보통 25~100건 안팎이라 4페이지면 충분
  const SEASON_NOW_PAGE_INTERVAL_MS = 350;

  async function fetchAllCurrentlyAiringAnime() {
    const firstPage = await fetchJikan('/seasons/now', { filter: 'tv', page: 1 });
    const merged = [...(firstPage?.data || [])];
    const lastVisiblePage = Math.min(
      firstPage?.pagination?.last_visible_page || 1,
      SEASON_NOW_MAX_PAGES
    );

    for (let page = 2; page <= lastVisiblePage; page += 1) {
      await sleep(SEASON_NOW_PAGE_INTERVAL_MS);
      try {
        const pageData = await fetchJikan('/seasons/now', { filter: 'tv', page });
        merged.push(...(pageData?.data || []));
      } catch (error) {
        console.error(`[jikanClient] /seasons/now ${page}페이지 조회 실패(건너뜀): ${error.message}`);
      }
    }

    // 페이지를 순회하는 동안 MAL 쪽 목록 순서가 변동되면 동일 작품이 두 페이지에
    // 걸쳐 중복 수집될 수 있어, mal_id 기준으로 중복을 제거한다.
    const seenIds = new Set();
    const deduped = [];
    merged.forEach((anime) => {
      const id = anime.mal_id;
      if (id !== undefined && seenIds.has(id)) return;
      if (id !== undefined) seenIds.add(id);
      deduped.push(anime);
    });

    return deduped.filter((anime) => anime.airing);
  }

  /**
   * 현재 방영 중인 애니메이션 전체 목록을 가져온다. '인기 순위(top)' 랭킹이 아니라
   * 실제 방영 편성 데이터(/seasons/now)를 전 페이지에 걸쳐 수집하므로, 인기와
   * 무관하게 현재 방영 중인 모든 TV 애니메이션이 대상이 된다.
   */
  async function fetchAiringAnimeList() {
    const airingAnime = await fetchAllCurrentlyAiringAnime();

    if (airingAnime.length === 0) {
      throw new Error('현재 방영 중인 애니메이션 데이터를 찾을 수 없습니다.');
    }

    return airingAnime;
  }

  // ---- 공개 함수 ------------------------------------------------------------

  /**
   * 기준 종료일로부터 최근 7일간, 그 구간에 포함된 요일(월~일)별로 '현재 방영 중'인
   * 애니메이션과 MAL 지표(평점/평가 참여자 수/인기도 순위/즐겨찾기 수)를 묶어서 반환한다.
   * @param {string} endDate - 조회 기준 종료일 (YYYY-MM-DD)
   */
  async function getWeeklyRatings(endDate) {
    const { startDate, endDate: normalizedEndDate } = getBroadcastWeekRange(endDate);

    try {
      const airingAnime = await fetchAiringAnimeList();

      const items = airingAnime.map((anime) => {
        const slot = resolveBroadcastSlot(anime.broadcast?.day, anime.broadcast?.time);
        return {
          titleJapanese: anime.title_japanese || '정보 없음',
          titleEnglish: anime.title_english || anime.title || '정보 없음',
          score: typeof anime.score === 'number' ? anime.score : null,
          scoredBy: typeof anime.scored_by === 'number' ? anime.scored_by : null,
          popularityRank: typeof anime.popularity === 'number' ? anime.popularity : null,
          favorites: typeof anime.favorites === 'number' ? anime.favorites : null,
          broadcastDayKorean: slot.dayKorean,
          broadcastTime: slot.timeText,
          broadcastStation: extractBroadcastStation(anime),
          officialSite: extractOfficialSite(anime),
          category: formatCategory(anime.type),
          genres: extractGenres(anime),
          themes: extractThemes(anime),
          coverImage: extractCoverImage(anime)
        };
      });

      const { days, unscheduled } = buildWeeklyRatingDays(startDate, normalizedEndDate, items);

      return {
        source: 'jikan',
        period: { startDate, endDate: normalizedEndDate },
        days,
        unscheduled
      };
    } catch (error) {
      console.error(`[jikanClient] getWeeklyRatings API 조회 실패, Mock 데이터로 대체합니다: ${error.message}`);
      const { days, unscheduled } = buildWeeklyRatingDays(startDate, normalizedEndDate, MOCK_WEEKLY_RATINGS);
      return {
        source: 'mock',
        period: { startDate, endDate: normalizedEndDate },
        days,
        unscheduled
      };
    }
  }

  /**
   * 기준 종료일이 속한 분기(계절)에 방영 중인 TV 애니메이션 전체를 반환한다.
   *
   * 예전에는 '이번 7일 안에 방영을 시작한 신작'만 좁혀서 보여줬는데, `/seasons/{year}/{season}`
   * 응답은 방영 시작일 순으로 정렬돼 내려오지 않아서, API 호출 자체는 성공해도 그 좁은
   * 주간 필터에 걸리는 항목이 하필 하나도 없어 '해당 주차에 신작이 없음'으로 처리되며
   * Mock으로 대체되는 경우가 잦았다. 좁은 주간 필터를 없애고 분기 전체 방영작을 그대로
   * 보여주는 것으로 바꿔 이 문제를 줄인다.
   * @param {string} endDate - 조회 기준 종료일 (YYYY-MM-DD)
   */
  async function getNewReleases(endDate) {
    const { startDate, endDate: normalizedEndDate } = getBroadcastWeekRange(endDate);

    try {
      const { year, season } = resolveSeason(new Date(`${normalizedEndDate}T00:00:00Z`));

      const firstPage = await fetchJikan(`/seasons/${year}/${season}`, { filter: 'tv', page: 1 });
      const merged = [...(firstPage?.data || [])];
      const lastVisiblePage = Math.min(
        firstPage?.pagination?.last_visible_page || 1,
        NEW_RELEASES_MAX_PAGES
      );

      for (let page = 2; page <= lastVisiblePage; page += 1) {
        await sleep(SEASON_NOW_PAGE_INTERVAL_MS);
        try {
          const pageData = await fetchJikan(`/seasons/${year}/${season}`, { filter: 'tv', page });
          merged.push(...(pageData?.data || []));
        } catch (error) {
          console.error(`[jikanClient] /seasons/${year}/${season} ${page}페이지 조회 실패(건너뜀): ${error.message}`);
        }
      }

      if (merged.length === 0) {
        throw new Error('해당 분기의 방영작 데이터를 찾을 수 없습니다.');
      }

      const releases = merged.map((anime) => ({
        titleJapanese: anime.title_japanese || '정보 없음',
        titleEnglish: anime.title_english || anime.title || '정보 없음',
        studio: extractStudio(anime),
        firstAirDate: anime.aired?.from ? anime.aired.from.slice(0, 10) : '미정',
        genres: extractGenres(anime),
        officialSite: extractOfficialSite(anime),
        category: formatCategory(anime.type),
        themes: extractThemes(anime),
        coverImage: extractCoverImage(anime)
      }));

      return {
        source: 'jikan',
        period: { startDate, endDate: normalizedEndDate },
        releases
      };
    } catch (error) {
      console.error(`[jikanClient] getNewReleases API 조회 실패, Mock 데이터로 대체합니다: ${error.message}`);
      return {
        source: 'mock',
        period: { startDate, endDate: normalizedEndDate },
        releases: MOCK_NEW_RELEASES
      };
    }
  }

  const SEARCH_RESULT_LIMIT = 10;

  /**
   * 방영 일자와 무관하게, 입력한 타이틀(영어/일본어 어느 쪽이든)과 가장 유사한
   * 애니메이션을 MAL 전체 데이터베이스에서 검색한다. 일치 후보가 여러 건이면
   * 상위 결과를 모두 반환한다(최대 10건).
   * @param {string} title - 검색할 애니메이션 타이틀(영어 또는 일본어, 일부만 입력해도 됨)
   */
  async function searchAnimeByTitle(title) {
    const query = (title || '').trim();

    if (!query) {
      return { source: 'empty', query, results: [] };
    }

    try {
      const data = await fetchJikan('/anime', { q: query, limit: SEARCH_RESULT_LIMIT });
      const results = (data?.data || []).map((anime) => ({
        titleJapanese: anime.title_japanese || '정보 없음',
        titleEnglish: anime.title_english || anime.title || '정보 없음',
        score: typeof anime.score === 'number' ? anime.score : null,
        scoredBy: typeof anime.scored_by === 'number' ? anime.scored_by : null,
        popularityRank: typeof anime.popularity === 'number' ? anime.popularity : null,
        favorites: typeof anime.favorites === 'number' ? anime.favorites : null,
        firstAirDate: anime.aired?.from ? anime.aired.from.slice(0, 10) : '미정',
        broadcastTime: formatBroadcastLabel(anime),
        episodes: typeof anime.episodes === 'number' ? anime.episodes : null,
        broadcastStation: extractBroadcastStation(anime),
        officialSite: extractOfficialSite(anime),
        category: formatCategory(anime.type),
        genres: extractGenres(anime),
        themes: extractThemes(anime),
        coverImage: extractCoverImage(anime)
      }));

      return { source: 'jikan', query, results };
    } catch (error) {
      console.error(`[jikanClient] searchAnimeByTitle API 조회 실패: ${error.message}`);
      return {
        source: 'error',
        query,
        results: [],
        errorMessage: '검색 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
      };
    }
  }

  // ---- API 상태 확인 --------------------------------------------------------
  // 상단 데이터 소스 버튼 옆 상태 점(초록/빨강)을 위한 단발성 진단 요청. 재시도
  // 없이 1회만 호출해 지금 이 순간 Jikan API가 응답 가능한지 빠르게 확인한다.
  const STATUS_CHECK_TIMEOUT_MS = 6000;

  async function checkStatus() {
    const url = new URL(`${JIKAN_BASE_URL}/seasons/now`);
    url.searchParams.set('filter', 'tv');
    url.searchParams.set('page', '1');

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

  window.JikanClient = {
    getWeeklyRatings,
    getNewReleases,
    searchAnimeByTitle,
    checkStatus
  };
})();
