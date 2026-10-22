// AniList GraphQL API(https://graphql.anilist.co)를 브라우저에서 직접 호출하는 클라이언트.
// AniList는 'Access-Control-Allow-Origin: *'를 응답해 브라우저에서 바로 호출할 수 있음을
// 확인했다(CORS 제한 없음). 이 앱의 기본(최초) 데이터 소스다.
//
// 중요한 한계(직접 확인함, 코드로 보완 불가):
// - AniList는 Jikan의 popularity(순위)와 달리 popularity를 '집계 카운트(리스트에 담은
//   유저 수)'로만 제공하고 순위(rank) 자체는 주지 않는다. 이 클라이언트는 한 번에 가져온
//   배치(요일별 최대 150건, 검색 결과 최대 10건) 안에서 popularity 내림차순으로 정렬해
//   순번을 매겨 '인기도 순위'처럼 보여준다 — MAL 전체 데이터베이스 기준 순위가 아니라
//   이 배치 안에서의 상대적 순위라는 근사치임을 감안할 것.
// - AniList Media 타입에는 TV 방송사(방송국) 전용 필드가 없어 broadcastStation은 항상
//   '정보 없음'으로 표시된다.
// - Rate Limit이 낮다(현재 분당 30회 수준, 응답 헤더 X-RateLimit-Limit으로 직접 확인).
//   이 클라이언트의 모든 요청은 모듈 전역 큐를 통해 최소 간격을 두고 순차 실행된다
//   (동시에 여러 함수가 호출돼도 실제 네트워크 요청은 겹치지 않음).
(function () {
  'use strict';

  const ANILIST_URL = 'https://graphql.anilist.co';

  const REQUEST_TIMEOUT_MS = 8000;
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1500;
  const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

  // AniList Rate Limit(현재 분당 약 30회) 대응: 이 클라이언트가 보내는 모든 요청은
  // 아래 큐를 거쳐 최소 이 간격 이상을 두고 순차 실행된다.
  const MIN_REQUEST_INTERVAL_MS = 2100;

  const PAGE_SIZE = 50;
  const WEEKLY_MAX_PAGES = 3;
  const NEW_RELEASES_MAX_PAGES = 3;
  const SEARCH_RESULT_LIMIT = 10;
  const STATUS_CHECK_TIMEOUT_MS = 6000;

  const KOREAN_DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

  const CATEGORY_LABELS = {
    TV: 'TV', TV_SHORT: 'TV(단편)', MOVIE: '극장판', SPECIAL: '스페셜',
    OVA: 'OVA', ONA: 'ONA', MUSIC: '뮤직'
  };

  // ---- Mock Fallback 데이터 --------------------------------------------------

  const MOCK_WEEKLY_RATINGS = [
    { titleJapanese: 'ONE PIECE', titleEnglish: 'One Piece', score: 8.7, scoredBy: 291635, popularityRank: 1, favorites: 109092, broadcastDayKorean: '일', broadcastTime: '09:30', broadcastStation: '정보 없음', officialSite: 'https://anilist.co/anime/21', category: 'TV', genres: ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy'], themes: ['Pirates', 'Travel', 'Shounen', 'Ensemble Cast', 'Super Power'], coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21-ELSYx3yMPcKM.jpg' },
    { titleJapanese: 'Re:ゼロから始める異世界生活 4th season', titleEnglish: 'Re:ZERO -Starting Life in Another World- Season 4', score: 9.0, scoredBy: 27479, popularityRank: 3, favorites: 7459, broadcastDayKorean: '수', broadcastTime: '22:00', broadcastStation: '정보 없음', officialSite: 'https://anilist.co/anime/189046', category: 'TV', genres: ['Action', 'Adventure', 'Drama', 'Fantasy', 'Psychological', 'Romance', 'Thriller'], themes: ['Isekai', 'Memory Manipulation', 'Time Loop', 'Male Protagonist'], coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx189046-yaHWtS5FII46.jpg' },
    { titleJapanese: '名探偵コナン', titleEnglish: 'Case Closed', score: 7.9, scoredBy: 44000, popularityRank: 12, favorites: 21000, broadcastDayKorean: '토', broadcastTime: '18:00', broadcastStation: '정보 없음', officialSite: 'https://anilist.co/anime/235', category: 'TV', genres: ['Adventure', 'Comedy', 'Mystery'], themes: ['Detective'], coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx235-MyYT7K3chBdO.jpg' },
    { titleJapanese: 'チェンソーマン', titleEnglish: 'Chainsaw Man', score: 8.4, scoredBy: 320000, popularityRank: 6, favorites: 68000, broadcastDayKorean: '월', broadcastTime: '25:30', broadcastStation: '정보 없음', officialSite: 'https://anilist.co/anime/127230', category: 'TV', genres: ['Action', 'Fantasy', 'Horror'], themes: ['Demons', 'Gore', 'Male Protagonist'], coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx127230-DdP4vAdssLoz.png' },
    { titleJapanese: '呪術廻戦', titleEnglish: 'Jujutsu Kaisen', score: 8.5, scoredBy: 400000, popularityRank: 4, favorites: 71000, broadcastDayKorean: '목', broadcastTime: '24:56', broadcastStation: '정보 없음', officialSite: 'https://anilist.co/anime/113415', category: 'TV', genres: ['Action', 'Drama', 'Supernatural'], themes: ['Shounen', 'School', 'Curses'], coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx113415-LHBAeoZDIsnF.jpg' },
    { titleJapanese: 'SPY×FAMILY', titleEnglish: 'Spy x Family', score: 8.5, scoredBy: 380000, popularityRank: 5, favorites: 88000, broadcastDayKorean: '토', broadcastTime: '23:00', broadcastStation: '정보 없음', officialSite: 'https://anilist.co/anime/140960', category: 'TV', genres: ['Action', 'Comedy'], themes: ['Family Life', 'Espionage'], coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx140960-Kb6R5nYQfjmP.jpg' },
    { titleJapanese: 'マッシュル-MASHLE-', titleEnglish: 'Mashle: Magic and Muscles', score: 7.2, scoredBy: 90000, popularityRank: 30, favorites: 5400, broadcastDayKorean: '화', broadcastTime: '25:25', broadcastStation: '정보 없음', officialSite: 'https://anilist.co/anime/151801', category: 'TV', genres: ['Action', 'Comedy', 'Fantasy'], themes: ['School', 'Parody'], coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx151801-XxVf22Le6C8o.png' }
  ];

  const MOCK_NEW_RELEASES = [
    { titleJapanese: 'Re:ゼロから始める異世界生活 4th season', titleEnglish: 'Re:ZERO -Starting Life in Another World- Season 4', studio: 'White Fox', firstAirDate: '2026-04-08', genres: ['Drama', 'Fantasy', 'Psychological'], officialSite: 'https://anilist.co/anime/189046', category: 'TV', themes: ['Isekai', 'Time Loop'], coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx189046-yaHWtS5FII46.jpg' },
    { titleJapanese: '無職転生III ～異世界行ったら本気だす～', titleEnglish: 'Mushoku Tensei III: Isekai Ittara Honki Dasu', studio: 'Studio Bind', firstAirDate: '2026-07-06', genres: ['Adventure', 'Drama', 'Fantasy', 'Ecchi'], officialSite: 'https://anilist.co/anime/178789', category: 'TV', themes: ['Isekai', 'Reincarnation'], coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx178789-hNXjKFzUq7mk.jpg' },
    { titleJapanese: '転生したらスライムだった件 第4期', titleEnglish: 'That Time I Got Reincarnated as a Slime Season 4', studio: '8bit', firstAirDate: '2025-04-05', genres: ['Action', 'Adventure', 'Comedy', 'Fantasy'], officialSite: 'https://anilist.co/anime/182205', category: 'TV', themes: ['Isekai', 'Kingdom Management'], coverImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx182205-q2AeO1owuQbO.jpg' }
  ];

  // ---- 공통 유틸 ------------------------------------------------------------

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
    if (month <= 3) return { year, season: 'WINTER' };
    if (month <= 6) return { year, season: 'SPRING' };
    if (month <= 9) return { year, season: 'SUMMER' };
    return { year, season: 'FALL' };
  }

  /**
   * AniList의 nextAiringEpisode.airingAt은 UTC 기준 Unix epoch(초)다. 여기에 9시간을
   * 더하면 일본 현지(JST) 방송 시각이 된다(별도 타임존 변환 라이브러리 불필요).
   * 방송 업계의 30시간제 관례에 맞춰 심야(0~5시대)는 전날 요일로 재배정한다.
   */
  function resolveBroadcastSlotFromAiringAt(airingAt) {
    if (typeof airingAt !== 'number') return { dayKorean: null, timeText: null };

    const jst = new Date(airingAt * 1000 + 9 * 60 * 60 * 1000);
    const dow = jst.getUTCDay();
    const hour = jst.getUTCHours();
    const minute = String(jst.getUTCMinutes()).padStart(2, '0');

    if (hour >= 0 && hour < 6) {
      const prevDow = (dow + 6) % 7;
      return { dayKorean: KOREAN_DAY_LABELS[prevDow], timeText: `${hour + 24}:${minute}` };
    }

    return { dayKorean: KOREAN_DAY_LABELS[dow], timeText: `${hour}:${minute}` };
  }

  function formatBroadcastLabel(airingAt) {
    const slot = resolveBroadcastSlotFromAiringAt(airingAt);
    if (slot.dayKorean && slot.timeText) return `${slot.dayKorean} ${slot.timeText}`;
    return '정보 없음';
  }

  function sortByPopularityRank(list) {
    return [...list].sort((a, b) => {
      if (a.popularityRank === null && b.popularityRank === null) return 0;
      if (a.popularityRank === null) return 1;
      if (b.popularityRank === null) return -1;
      return a.popularityRank - b.popularityRank;
    });
  }

  // AniList는 '인기 순위(rank)' 필드가 없어(popularity는 집계 카운트일 뿐), 지금 가져온
  // 배치 안에서 popularity 내림차순으로 정렬해 순번을 매겨 근사치 순위를 만든다.
  function assignPopularityRanks(items) {
    const sorted = [...items].sort((a, b) => (b._rawPopularity || 0) - (a._rawPopularity || 0));
    const rankMap = new Map();
    sorted.forEach((item, index) => rankMap.set(item, index + 1));
    return items.map((item) => {
      const { _rawPopularity, ...rest } = item;
      return { ...rest, popularityRank: rankMap.get(item) };
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

  function extractThemes(tags) {
    return (tags || [])
      .filter((tag) => tag && !tag.isMediaSpoiler)
      .slice(0, 5)
      .map((tag) => tag.name)
      .filter(Boolean);
  }

  function extractStudio(studios) {
    const names = (studios?.nodes || []).map((n) => n?.name).filter(Boolean);
    return names.length > 0 ? names.join(', ') : '미지정(Unknown)';
  }

  function formatFirstAirDate(startDate) {
    if (!startDate?.year) return '미정';
    const y = startDate.year;
    const m = String(startDate.month || 1).padStart(2, '0');
    const d = String(startDate.day || 1).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function parseScore(averageScore) {
    return typeof averageScore === 'number' ? Math.round((averageScore / 10) * 100) / 100 : null;
  }

  function parseScoredBy(stats) {
    const distribution = stats?.scoreDistribution;
    if (!Array.isArray(distribution) || distribution.length === 0) return null;
    return distribution.reduce((sum, entry) => sum + (Number(entry?.amount) || 0), 0);
  }

  // ---- 방영 상태 판정 ----------------------------------------------------------
  // 요일별 표의 일본어 타이틀 앞 색 점(초록=방영 중, 빨강=휴방/종료, 회색=확인 불가)에 쓰는 값.
  // 실제 방송 일정을 주는 API가 없으므로 "다음 방송 예정일"과 "예상 종료일"로 추정한다.
  const AIRING_SOON_DAYS = 14; // 이 안에 다음 방송이 있으면 방영 중으로 본다
  const OVERDUE_GRACE_DAYS = 28; // 시작일+(회차-1)주가 이만큼 지나도 방영 중으로 남아 있으면 종료로 추정

  function daysFromNow(ms) {
    return (ms - Date.now()) / (24 * 60 * 60 * 1000);
  }

  // 시작일(YYYY-MM-DD)부터 매주 1화씩 방송했다고 가정한 예상 종료일이, 휴방 여유(28일)까지 지났는지.
  function hasPassedExpectedEnd(startDate, episodeCount) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(startDate || '');
    if (!match || typeof episodeCount !== 'number' || episodeCount < 1) return false;
    const expectedEndMs = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + (episodeCount - 1) * 7);
    return daysFromNow(expectedEndMs) < -OVERDUE_GRACE_DAYS;
  }

  function describeNextBroadcast(nextMs) {
    const days = daysFromNow(nextMs);
    if (days > AIRING_SOON_DAYS) {
      return { state: 'hiatus', reason: `휴방 중으로 보임 — 다음 방송이 약 ${Math.round(days)}일 뒤` };
    }
    return { state: 'airing', reason: '방영 중 — 다음 방송이 곧 예정됨' };
  }

  function resolveAiringState(media, syoboiEntry) {
    const airingAt = media.nextAiringEpisode?.airingAt;
    if (typeof airingAt === 'number') return describeNextBroadcast(airingAt * 1000);

    if (syoboiEntry?.primary) return { state: 'airing', reason: '방영 중 — Syoboi에 이번 주 방송 편성이 있음' };
    if (media.status === 'HIATUS') return { state: 'hiatus', reason: 'AniList 상태: 휴방 중' };
    if (media.status === 'FINISHED' || media.status === 'CANCELLED') return { state: 'ended', reason: 'AniList 상태: 방영 종료' };
    if (hasPassedExpectedEnd(formatFirstAirDate(media.startDate), media.episodes)) {
      return { state: 'ended', reason: '예상 종료일(시작일 + 총 회차 주 수)이 지나 방영 종료로 추정' };
    }
    return { state: 'unknown', reason: '방영 중으로 등록돼 있으나 다음 방송 일정과 Syoboi 편성이 모두 없어 실제 방영 여부를 확인할 수 없음' };
  }

  // ---- Syoboi 편성 병합 -------------------------------------------------------
  // AniList에는 TV 방송사 필드가 없어 broadcastStation이 비므로, 공용 모듈 syoboiSchedule.js가 읽는
  // 정적 편성표(public/syoboi-schedule.js)를 일본어 제목(title.native)으로 매칭해 보충한다.
  function loadSyoboiIndex() {
    return window.SyoboiSchedule ? window.SyoboiSchedule.loadIndex() : Promise.resolve(null);
  }

  function findSyoboiEntry(syoboiIndex, media) {
    if (!window.SyoboiSchedule) return null;
    const title = media.title || {};
    return window.SyoboiSchedule.findEntry(syoboiIndex, {
      titles: [title.native, title.romaji, title.english].filter(Boolean),
      startDate: formatFirstAirDate(media.startDate)
    });
  }

  // AniList의 nextAiringEpisode는 특정 회차의 실제 방영 시각이라 값이 있으면 요일/시간은 그쪽을 우선한다.
  function resolveBroadcastInfo(media, syoboiEntry) {
    const slot = resolveBroadcastSlotFromAiringAt(media.nextAiringEpisode?.airingAt);
    const base = { dayKorean: slot.dayKorean, timeText: slot.timeText, station: '정보 없음' };
    return window.SyoboiSchedule ? window.SyoboiSchedule.mergeBroadcast(base, syoboiEntry) : base;
  }

  function pickTitle(title) {
    return {
      titleJapanese: title?.native || title?.romaji || '정보 없음',
      titleEnglish: title?.english || title?.romaji || '정보 없음'
    };
  }

  function mapToWeeklyItem(media, syoboiIndex) {
    const { titleJapanese, titleEnglish } = pickTitle(media.title);
    const syoboiEntry = findSyoboiEntry(syoboiIndex, media);
    const broadcast = resolveBroadcastInfo(media, syoboiEntry);

    return {
      titleJapanese,
      titleEnglish,
      score: parseScore(media.averageScore),
      scoredBy: parseScoredBy(media.stats),
      favorites: typeof media.favourites === 'number' ? media.favourites : null,
      anilistId: media.id,
      firstAirDate: formatFirstAirDate(media.startDate),
      airingState: resolveAiringState(media, syoboiEntry),
      broadcastDayKorean: broadcast.dayKorean,
      broadcastTime: broadcast.timeText,
      broadcastStation: broadcast.station,
      officialSite: media.siteUrl || null,
      category: formatCategory(media.format),
      genres: media.genres || [],
      themes: extractThemes(media.tags),
      coverImage: media.coverImage?.large || null,
      _rawPopularity: typeof media.popularity === 'number' ? media.popularity : 0
    };
  }

  function mapToReleaseItem(media) {
    const { titleJapanese, titleEnglish } = pickTitle(media.title);

    return {
      titleJapanese,
      titleEnglish,
      studio: extractStudio(media.studios),
      firstAirDate: formatFirstAirDate(media.startDate),
      genres: media.genres || [],
      officialSite: media.siteUrl || null,
      category: formatCategory(media.format),
      themes: extractThemes(media.tags),
      coverImage: media.coverImage?.large || null
    };
  }

  function mapToSearchItem(media, syoboiIndex) {
    const { titleJapanese, titleEnglish } = pickTitle(media.title);
    const broadcast = resolveBroadcastInfo(media, findSyoboiEntry(syoboiIndex, media));

    return {
      titleJapanese,
      titleEnglish,
      score: parseScore(media.averageScore),
      scoredBy: parseScoredBy(media.stats),
      favorites: typeof media.favourites === 'number' ? media.favourites : null,
      anilistId: media.id,
      firstAirDate: formatFirstAirDate(media.startDate),
      broadcastTime: broadcast.dayKorean && broadcast.timeText ? `${broadcast.dayKorean} ${broadcast.timeText}` : '정보 없음',
      episodes: typeof media.episodes === 'number' ? media.episodes : null,
      broadcastStation: broadcast.station,
      officialSite: media.siteUrl || null,
      category: formatCategory(media.format),
      genres: media.genres || [],
      themes: extractThemes(media.tags),
      coverImage: media.coverImage?.large || null,
      _rawPopularity: typeof media.popularity === 'number' ? media.popularity : 0
    };
  }

  // ---- 요청 큐 & GraphQL 호출 ------------------------------------------------
  // AniList Rate Limit(분당 약 30회)을 넘기지 않도록, 이 모듈에서 나가는 모든 요청은
  // 이 큐를 거쳐 순차적으로, 최소 MIN_REQUEST_INTERVAL_MS 간격을 두고 실행된다.
  // 요일별/신작 조회가 동시에(Promise.all) 호출돼도 실제 네트워크 요청은 겹치지 않는다.
  let requestChain = Promise.resolve();
  let lastRequestAt = 0;

  function scheduleRequest(task) {
    const run = requestChain.then(async () => {
      const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
      if (wait > 0) await sleep(wait);
      lastRequestAt = Date.now();
      return task();
    });
    requestChain = run.catch(() => {});
    return run;
  }

  async function gqlRequestOnce(query, variables) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(ANILIST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal
      });

      return { response, body: await response.json().catch(() => null) };
    } finally {
      clearTimeout(timer);
    }
  }

  async function gqlRequest(query, variables = {}, attempt = 0) {
    return scheduleRequest(async () => {
      const { response, body } = await gqlRequestOnce(query, variables);

      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        return gqlRequest(query, variables, attempt + 1);
      }

      if (!response.ok || body?.errors) {
        const message = body?.errors?.[0]?.message || `AniList API 응답 오류: HTTP ${response.status}`;
        throw new Error(message);
      }

      return body.data;
    });
  }

  const WEEKLY_QUERY = `
    query($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        media(status: RELEASING, type: ANIME, format: TV, sort: POPULARITY_DESC) {
          id
          status
          episodes
          startDate { year month day }
          title { romaji english native }
          format
          genres
          tags { name isMediaSpoiler }
          coverImage { large }
          averageScore
          favourites
          popularity
          stats { scoreDistribution { amount } }
          nextAiringEpisode { airingAt }
          siteUrl
        }
      }
    }
  `;

  const NEW_RELEASES_QUERY = `
    query($page: Int, $perPage: Int, $season: MediaSeason, $seasonYear: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        media(season: $season, seasonYear: $seasonYear, type: ANIME, format: TV) {
          title { romaji english }
          format
          genres
          tags { name isMediaSpoiler }
          coverImage { large }
          startDate { year month day }
          studios(isMain: true) { nodes { name } }
          siteUrl
        }
      }
    }
  `;

  const SEARCH_QUERY = `
    query($q: String, $perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        media(search: $q, type: ANIME) {
          id
          title { romaji english native }
          format
          genres
          tags { name isMediaSpoiler }
          coverImage { large }
          averageScore
          favourites
          popularity
          stats { scoreDistribution { amount } }
          startDate { year month day }
          episodes
          nextAiringEpisode { airingAt }
          siteUrl
        }
      }
    }
  `;

  const STATUS_QUERY = `query { Page(page: 1, perPage: 1) { media(type: ANIME) { id } } }`;

  async function fetchAllPages(query, baseVariables, maxPages) {
    const collected = [];

    for (let page = 1; page <= maxPages; page += 1) {
      const data = await gqlRequest(query, { ...baseVariables, page, perPage: PAGE_SIZE });
      const media = data?.Page?.media || [];
      collected.push(...media);

      if (!data?.Page?.pageInfo?.hasNextPage) break;
    }

    return collected;
  }

  // ---- 공개 함수 ------------------------------------------------------------
  // 세 함수 모두 API 호출에 실패하면(요일별/신작은) Mock 데이터로, (검색은) 명확한
  // 에러로 대체한다. 다른 소스(Jikan/Kitsu)를 대신 호출하지 않는다 — 어떤 API를 쓸지는
  // 화면 상단 소스 선택 버튼으로 사용자가 직접 고른다.

  // ---- 만화/라이트노벨 순위(IP 발굴용) -------------------------------------------
  // 일본 원작 만화(format MANGA)와 라이트노벨(format NOVEL)을 AniList 지표(인기도/급상승/평점/최근
  // 연재 시작)로 보여준다. 애니화 여부는 relations 중 relationType === 'ADAPTATION'이면서 노드가
  // ANIME인 항목으로 판정한다(없으면 '미애니화' = IP 발굴 후보). 주의: popularity는 AniList 이용자의
  // 목록 등록 수라 일본 서점 판매량이 아니다. 판매 부수/순위는 이 API로 알 수 없다.
  const BOOK_PAGE_SIZE = 50;
  const BOOK_MAX_PAGES = 4; // 정렬 기준 하나당 최대 200건(요청 4번, 큐 간격 때문에 약 9초)
  const BOOK_SORTS = {
    popularity: { sort: 'POPULARITY_DESC' },
    trending: { sort: 'TRENDING_DESC' },
    // 평점순은 이용자가 몇 명 안 되는 작품이 상위를 채우지 않게 최소 인기도를 둔다.
    score: { sort: 'SCORE_DESC', minPopularity: 10000 },
    // 최근 3년 안에 시작한 작품만 인기순으로. (START_DATE_DESC 정렬은 월/일이 빈 날짜와 미래 작품이
    // 섞여 순서가 엉망이라(직접 확인) 쓰지 않고, 시작일 필터 + 인기순으로 "요즘 뜨는 신작"을 본다.)
    recent: { sort: 'POPULARITY_DESC', recentYears: 3 }
  };
  const BOOK_STATUS_LABELS = {
    FINISHED: '완결', RELEASING: '연재 중', NOT_YET_RELEASED: '발표 전', CANCELLED: '중단', HIATUS: '휴재'
  };

  const BOOK_QUERY = `
    query($page: Int, $perPage: Int, $format: MediaFormat, $sort: [MediaSort], $minPopularity: Int, $startAfter: FuzzyDateInt) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        media(type: MANGA, countryOfOrigin: JP, format: $format, sort: $sort, status_not: NOT_YET_RELEASED, popularity_greater: $minPopularity, startDate_greater: $startAfter) {
          id
          title { romaji english native }
          format
          status
          volumes
          chapters
          startDate { year month day }
          averageScore
          popularity
          trending
          favourites
          genres
          tags { name isMediaSpoiler }
          coverImage { large }
          siteUrl
          staff(perPage: 3, sort: RELEVANCE) { edges { node { name { native full } } } }
          relations { edges { relationType(version: 2) node { type status } } }
        }
      }
    }
  `;

  // ANIME 각색 작품들의 상태를 대표 상태 하나로 요약한다: 방영 중 > 제작 예정 > 방영 완료 > 중단 > 없음.
  function resolveAdaptationState(relations) {
    const animeNodes = (relations?.edges || [])
      .filter((edge) => edge.relationType === 'ADAPTATION' && edge.node?.type === 'ANIME')
      .map((edge) => edge.node);
    if (animeNodes.length === 0) return { state: 'none', animeCount: 0 };

    const has = (status) => animeNodes.some((node) => node.status === status);
    let state = 'finished';
    if (has('RELEASING')) state = 'airing';
    else if (has('NOT_YET_RELEASED')) state = 'planned';
    else if (has('FINISHED')) state = 'finished';
    else if (has('CANCELLED')) state = 'cancelled';
    return { state, animeCount: animeNodes.length };
  }

  function extractAuthors(staff) {
    const names = (staff?.edges || []).map((edge) => edge.node?.name?.native || edge.node?.name?.full).filter(Boolean);
    return [...new Set(names)].slice(0, 2);
  }

  function mapToBookItem(media, rank) {
    const { titleJapanese, titleEnglish } = pickTitle(media.title);
    return {
      anilistId: media.id,
      rank,
      titleJapanese,
      titleEnglish,
      authors: extractAuthors(media.staff),
      score: parseScore(media.averageScore),
      popularity: typeof media.popularity === 'number' ? media.popularity : null,
      trending: typeof media.trending === 'number' ? media.trending : null,
      favorites: typeof media.favourites === 'number' ? media.favourites : null,
      volumes: typeof media.volumes === 'number' ? media.volumes : null,
      status: BOOK_STATUS_LABELS[media.status] || '정보 없음',
      startDate: formatFirstAirDate(media.startDate),
      adaptation: resolveAdaptationState(media.relations),
      officialSite: media.siteUrl || null,
      genres: media.genres || [],
      themes: extractThemes(media.tags),
      coverImage: media.coverImage?.large || null
    };
  }

  // type: 'MANGA' | 'NOVEL', sortKey: BOOK_SORTS의 키. 실패하면 Mock 없이 에러로 돌려준다(순위는
  // 가짜 데이터를 보여주면 오도하므로).
  async function getBookRanking(type, sortKey) {
    const sortConfig = BOOK_SORTS[sortKey] || BOOK_SORTS.popularity;
    // AniList는 null 필터 값을 받지 않으므로(Illegal operator and value combination) 필요할 때만 넣는다.
    const variables = { format: type === 'NOVEL' ? 'NOVEL' : 'MANGA', sort: [sortConfig.sort] };
    if (sortConfig.minPopularity) variables.minPopularity = sortConfig.minPopularity;
    if (sortConfig.recentYears) variables.startAfter = (new Date().getUTCFullYear() - sortConfig.recentYears) * 10000;

    try {
      const items = [];
      for (let page = 1; page <= BOOK_MAX_PAGES; page += 1) {
        const data = await gqlRequest(BOOK_QUERY, { ...variables, page, perPage: BOOK_PAGE_SIZE });
        (data?.Page?.media || []).forEach((media) => items.push(mapToBookItem(media, items.length + 1)));
        if (!data?.Page?.pageInfo?.hasNextPage) break;
      }
      if (items.length === 0) throw new Error('조건에 맞는 작품이 없습니다.');
      return { source: 'anilist', type, sort: sortKey, items };
    } catch (error) {
      console.error(`[anilistClient] getBookRanking 조회 실패: ${error.message}`);
      return { source: 'error', type, sort: sortKey, items: [], errorMessage: `AniList 조회 실패: ${error.message}` };
    }
  }

  // ---- 평점 변화 이력 ----------------------------------------------------------
  // AniList의 MediaTrend(Page.mediaTrends)는 작품별로 '하루에 한 번'(일본 시간 0시 기준)
  // 찍힌 averageScore 스냅샷을 준다(직접 확인). 시/분 단위 이력은 없으므로, "방송 시각 + 6시간"
  // 이후 처음 찍힌 하루 단위 스냅샷을 그 회차의 평점으로 쓴다. 즉 실제로는 방송 다음 날 0시
  // 스냅샷이 선택된다. 데이터는 2014-12 이후부터만 존재하고, 값이 null인 날은 그래프에서 뺀다.
  const SCORE_HISTORY_AFTER_BROADCAST_HOURS = 6;
  const SCORE_HISTORY_PAGE_SIZE = 50;
  const SCORE_HISTORY_MAX_PAGES = 8;
  const SCORE_HISTORY_MAX_DAYS = SCORE_HISTORY_PAGE_SIZE * SCORE_HISTORY_MAX_PAGES; // 한 번에 가져올 최대 기간
  const DAY_MS = 24 * 60 * 60 * 1000;
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

  const SCORE_HISTORY_QUERY = `
    query($mediaId: Int, $dateGreater: Int, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        mediaTrends(mediaId: $mediaId, sort: DATE, date_greater: $dateGreater) {
          date
          averageScore
        }
      }
    }
  `;

  // firstAirDate: 'YYYY-MM-DD'(일본 방영 시작일), broadcastTime: '25:30' 같은 30시간제 'HH:MM'.
  // 방영 시작일부터 7일 간격으로 "방송 시각 + 6시간"인 시점(JST)을 만들어 현재까지만 돌려준다.
  function buildWeeklySampleTimes(firstAirDate, broadcastTime, nowMs) {
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(firstAirDate || '');
    if (!dateMatch) return [];

    const [, y, m, d] = dateMatch.map(Number);
    const timeMatch = /(\d{1,2}):(\d{2})/.exec(broadcastTime || ''); // '25:30' 또는 검색 결과의 '금 25:30' 둘 다 허용
    const hours = timeMatch ? Number(timeMatch[1]) : 0;
    const minutes = timeMatch ? Number(timeMatch[2]) : 0;

    const samples = [];
    for (let week = 0; week < 520; week += 1) {
      // Date.UTC에 JST 기준 날짜/시각을 그대로 넣고 9시간을 빼면 실제 UTC 시각이 된다.
      const airedAtMs = Date.UTC(y, m - 1, d + week * 7, hours, minutes) - JST_OFFSET_MS;
      const sampleMs = airedAtMs + SCORE_HISTORY_AFTER_BROADCAST_HOURS * 60 * 60 * 1000;
      if (sampleMs > nowMs) break;
      samples.push({ week: week + 1, airedAtMs, sampleMs });
    }
    return samples;
  }

  function formatJstDate(ms) {
    return formatDate(new Date(ms + JST_OFFSET_MS));
  }

  async function getScoreHistory(mediaId, firstAirDate, broadcastTime) {
    if (!mediaId) throw new Error('AniList 작품 ID가 없어 평점 이력을 조회할 수 없습니다.');

    const nowMs = Date.now();
    const allSamples = buildWeeklySampleTimes(firstAirDate, broadcastTime, nowMs);
    if (allSamples.length === 0) {
      throw new Error('방영 시작일 정보가 없거나 아직 방영 전이라 평점 이력을 만들 수 없습니다.');
    }

    // 한 번에 가져올 수 있는 기간(SCORE_HISTORY_MAX_DAYS)보다 오래된 장기 방영작은 최근 구간만 쓴다.
    const earliestMs = nowMs - SCORE_HISTORY_MAX_DAYS * DAY_MS;
    const samples = allSamples.filter((sample) => sample.sampleMs >= earliestMs);
    const truncated = samples.length < allSamples.length;
    if (samples.length === 0) throw new Error('조회 가능한 기간에 해당하는 방송 회차가 없습니다.');

    const dateGreater = Math.floor((samples[0].sampleMs - DAY_MS) / 1000);
    const trends = [];
    for (let page = 1; page <= SCORE_HISTORY_MAX_PAGES; page += 1) {
      const data = await gqlRequest(SCORE_HISTORY_QUERY, {
        mediaId,
        dateGreater,
        page,
        perPage: SCORE_HISTORY_PAGE_SIZE
      });
      trends.push(...(data?.Page?.mediaTrends || []));
      if (!data?.Page?.pageInfo?.hasNextPage) break;
    }

    // 하루 단위 스냅샷(date, epoch초) 중 각 방송 시점 이후 처음 것을 고른다.
    const points = [];
    samples.forEach((sample) => {
      const snapshot = trends.find((trend) => trend.date * 1000 >= sample.sampleMs);
      if (!snapshot || typeof snapshot.averageScore !== 'number') return;
      points.push({
        week: sample.week,
        airedDate: formatJstDate(sample.airedAtMs),
        snapshotDate: formatJstDate(snapshot.date * 1000),
        score: snapshot.averageScore
      });
    });

    return { points, truncated, totalWeeks: allSamples.length };
  }

  async function getWeeklyRatings(endDate) {
    const { startDate, endDate: normalizedEndDate } = getBroadcastWeekRange(endDate);

    try {
      const mediaList = await fetchAllPages(WEEKLY_QUERY, {}, WEEKLY_MAX_PAGES);

      if (mediaList.length === 0) {
        throw new Error('AniList에서 현재 방영 중인 애니메이션 데이터를 찾을 수 없습니다.');
      }

      const syoboiIndex = await loadSyoboiIndex();
      const items = assignPopularityRanks(mediaList.map((media) => mapToWeeklyItem(media, syoboiIndex)));
      const { days, unscheduled } = buildWeeklyRatingDays(startDate, normalizedEndDate, items);

      return { source: 'anilist', period: { startDate, endDate: normalizedEndDate }, days, unscheduled };
    } catch (error) {
      console.error(`[anilistClient] getWeeklyRatings API 조회 실패, Mock 데이터로 대체합니다: ${error.message}`);
      const { days, unscheduled } = buildWeeklyRatingDays(startDate, normalizedEndDate, MOCK_WEEKLY_RATINGS);
      return { source: 'mock', period: { startDate, endDate: normalizedEndDate }, days, unscheduled };
    }
  }

  async function getNewReleases(endDate) {
    const { startDate, endDate: normalizedEndDate } = getBroadcastWeekRange(endDate);

    try {
      const { year, season } = resolveSeason(new Date(`${normalizedEndDate}T00:00:00Z`));
      const mediaList = await fetchAllPages(NEW_RELEASES_QUERY, { season, seasonYear: year }, NEW_RELEASES_MAX_PAGES);

      if (mediaList.length === 0) {
        throw new Error('AniList에서 해당 분기의 방영작 데이터를 찾을 수 없습니다.');
      }

      const releases = mediaList.map(mapToReleaseItem);
      return { source: 'anilist', period: { startDate, endDate: normalizedEndDate }, releases };
    } catch (error) {
      console.error(`[anilistClient] getNewReleases API 조회 실패, Mock 데이터로 대체합니다: ${error.message}`);
      return { source: 'mock', period: { startDate, endDate: normalizedEndDate }, releases: MOCK_NEW_RELEASES };
    }
  }

  async function searchAnimeByTitle(title) {
    const query = (title || '').trim();
    if (!query) return { source: 'empty', query, results: [] };

    try {
      const data = await gqlRequest(SEARCH_QUERY, { q: query, perPage: SEARCH_RESULT_LIMIT });
      const mediaList = data?.Page?.media || [];
      const syoboiIndex = await loadSyoboiIndex();
      const results = assignPopularityRanks(mediaList.map((media) => mapToSearchItem(media, syoboiIndex)));

      return { source: 'anilist', query, results };
    } catch (error) {
      console.error(`[anilistClient] searchAnimeByTitle API 조회 실패: ${error.message}`);
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
   * 재시도 없이 1회만 호출하며, 이 클라이언트의 공용 요청 큐를 그대로 거친다.
   */
  async function checkStatus() {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STATUS_CHECK_TIMEOUT_MS);

    try {
      const { response, body } = await scheduleRequest(() =>
        fetch(ANILIST_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query: STATUS_QUERY }),
          signal: controller.signal
        }).then(async (res) => ({ response: res, body: await res.json().catch(() => null) }))
      );

      const ok = response.ok && !body?.errors;
      return { ok, status: response.status, elapsedMs: Date.now() - startedAt };
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

  window.AniListClient = {
    getWeeklyRatings,
    getNewReleases,
    searchAnimeByTitle,
    checkStatus,
    getScoreHistory,
    getBookRanking
  };
})();
