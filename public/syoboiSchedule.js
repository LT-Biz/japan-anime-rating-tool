// Syoboi Calendar(https://cal.syoboi.jp) 편성표를 일본어 제목으로 매칭해 방영 요일/시간/방송국을
// 보충하는 공용 모듈. AniList/Kitsu 클라이언트가 함께 쓴다(Jikan은 방송국을 자체적으로 채워 불필요).
//
// Syoboi는 CORS를 허용하지 않아 브라우저에서 직접 호출할 수 없다. 그래서 scripts/build-syoboi.js
// (npm run build:syoboi)가 미리 만들어 둔 정적 파일 public/syoboi-schedule.js 가 <script>로 로드되며
// 만든 전역 window.SYOBOI_SCHEDULE 을 읽는다(fetch가 아니라 script 태그라서 file:// 로 열어도 동작).
// 이 모듈은 API 클라이언트가 아니라 데이터 유틸이므로, "세 API 클라이언트는 서로를 호출하지 않는다"는
// 규칙과 무관하다(어떤 API 클라이언트도 다른 클라이언트를 호출하지 않는다).
(function () {
  'use strict';

  const MAX_AGE_MS = 28 * 24 * 60 * 60 * 1000; // 이보다 오래된 편성표는 신뢰하지 않음
  const MAX_GAP_MONTHS_EXACT = 24; // 제목이 같을 때 허용하는 시작 연월 차이
  const MAX_GAP_MONTHS_PREFIX = 12; // 접두 일치(부제 차이 등)일 때는 더 엄격하게
  const MIN_PREFIX_LENGTH = 6; // 접두 일치로 인정할 최소 제목 길이(너무 짧은 제목의 오매칭 방지)

  const KANJI_DIGITS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const toSeasonNumber = (raw) => KANJI_DIGITS[raw] || raw;

  // 전각/반각, 공백, 기호(～・! 등)를 제거해 "桃源暗鬼～日光・華厳の滝編～"와 "桃源暗鬼 日光・華厳の滝編"처럼
  // 표기만 다른 제목이 같은 키가 되게 한다. 시즌 표기("第2期"/"第二期"/"Season2"/"2nd Season"/
  // "第2クール")는 "s2"로 통일하되, stripSeason이면 아예 지워서 "시즌 표기만 다른" 경우도 잡는다.
  // 제목 끝의 연도 표기("ドラえもん (2005)")는 Syoboi 쪽엔 없으므로 지운다.
  function normalizeTitle(text, stripSeason = false) {
    const seasonToken = (n) => (stripSeason ? '' : `s${toSeasonNumber(n)}`);
    return String(text || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\(\d{4}\)/g, '')
      .replace(/第?\s*([0-9一二三四五六七八九十]+)\s*(?:期|季|シーズン|クール)/g, (_, n) => seasonToken(n))
      .replace(/(\d+)(?:st|nd|rd|th)\s*(?:season|cour)/g, (_, n) => seasonToken(n))
      .replace(/(?:season|シーズン)\s*(\d+)/g, (_, n) => seasonToken(n))
      .replace(/[^\p{L}\p{N}]/gu, '');
  }

  function addToMap(map, key, entry) {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  }

  function buildIndex(schedule) {
    const generatedAt = Date.parse(schedule?.generatedAt);
    if (!Array.isArray(schedule?.titles) || !Number.isFinite(generatedAt) || Date.now() - generatedAt > MAX_AGE_MS) {
      return null;
    }

    const exact = new Map();
    const stripped = new Map();
    const prefixCandidates = [];
    schedule.titles.forEach((entry) => {
      [entry.title, entry.titleEn].forEach((title) => {
        addToMap(exact, normalizeTitle(title), entry);
        const strippedKey = normalizeTitle(title, true);
        addToMap(stripped, strippedKey, entry);
        if (strippedKey.length >= MIN_PREFIX_LENGTH) prefixCandidates.push({ key: strippedKey, entry });
      });
    });
    return { exact, stripped, prefixCandidates };
  }

  // 정적 파일이 없거나 형식이 깨져 있어도 각 API 자체 데이터로 그대로 동작해야 하므로 실패는 null.
  // 클라이언트들이 await 하는 형태를 유지하려고 Promise로 돌려준다.
  let indexPromise = null;
  function loadIndex() {
    if (!indexPromise) {
      indexPromise = Promise.resolve().then(() => {
        if (!window.SYOBOI_SCHEDULE) {
          console.warn('[syoboiSchedule] syoboi-schedule.js가 로드되지 않아 방송국 보충 없이 계속합니다.');
          return null;
        }
        return buildIndex(window.SYOBOI_SCHEDULE);
      });
    }
    return indexPromise;
  }

  function monthsOf(year, month) {
    return year * 12 + month;
  }

  // titles: 일본어/로마자/영어 제목 후보들, startDate: 'YYYY-MM-DD'(모르면 null/'미정').
  // 1) 정규화한 제목이 완전히 같고 2) 시즌 표기를 지우고 같고 3) 한쪽이 다른 쪽의 접두일 때 순서대로
  // 시도한다. 후보가 여럿이면 시작 연월이 가장 가까운 것을 고르고, 허용 범위를 넘으면 다른 작품으로 본다.
  function findEntry(index, { titles, startDate }) {
    if (!index) return null;

    const startMatch = /^(\d{4})-(\d{2})/.exec(startDate || '');
    const startMonths = startMatch ? monthsOf(Number(startMatch[1]), Number(startMatch[2])) : null;

    const pickClosest = (candidates, maxGap) => {
      if (candidates.size === 0) return null;
      if (startMonths === null) return candidates.size === 1 ? [...candidates.values()][0] : null;

      let best = null;
      let bestGap = Infinity;
      candidates.forEach((entry) => {
        if (!entry.firstYear) return;
        const gap = Math.abs(monthsOf(entry.firstYear, entry.firstMonth || 1) - startMonths);
        if (gap < bestGap) {
          best = entry;
          bestGap = gap;
        }
      });
      return bestGap <= maxGap ? best : null;
    };

    const collect = (lookup, strip) => {
      const candidates = new Map();
      titles.forEach((title) => {
        (lookup.get(normalizeTitle(title, strip)) || []).forEach((entry) => candidates.set(entry.tid, entry));
      });
      return candidates;
    };

    const exactMatch = pickClosest(collect(index.exact, false), MAX_GAP_MONTHS_EXACT);
    if (exactMatch) return exactMatch;

    const strippedMatch = pickClosest(collect(index.stripped, true), MAX_GAP_MONTHS_EXACT);
    if (strippedMatch) return strippedMatch;

    // 접두 일치는 시작 연월이 있을 때만 쓴다(없으면 오매칭 위험이 너무 큼).
    if (startMonths === null) return null;
    const prefixMatches = new Map();
    titles.forEach((title) => {
      const key = normalizeTitle(title, true);
      if (key.length < MIN_PREFIX_LENGTH) return;
      index.prefixCandidates.forEach((candidate) => {
        if (candidate.key.startsWith(key) || key.startsWith(candidate.key)) prefixMatches.set(candidate.entry.tid, candidate.entry);
      });
    });
    return pickClosest(prefixMatches, MAX_GAP_MONTHS_PREFIX);
  }

  // base: 각 API가 이미 알고 있는 { dayKorean, timeText, station }. 그 API의 값이 있으면 요일/시간은
  // 그대로 두고(특정 회차의 실제 방영 시각이라 더 정확), 방송국은 Syoboi의 첫 방송국과 일치하는 슬롯일
  // 때만 채운다(아니면 재방송 채널일 수 있어 오히려 오해를 부름). base에 요일이 없으면 Syoboi 슬롯을 쓴다.
  const padTime = (time) => String(time || '').replace(/^(\d):/, '0$1:');

  function mergeBroadcast(base, entry) {
    const primary = entry?.primary;
    if (!primary) return base;
    if (base.dayKorean) {
      // 그 API가 알려준 요일/시간과 정확히 같은 슬롯을 가진 방송국이 있으면 그 방송국이 가장 확실하다.
      const sameSlot = [primary, ...(entry.others || [])].find(
        (slot) => slot.day === base.dayKorean && padTime(slot.time) === padTime(base.timeText)
      );
      if (sameSlot) return { ...base, station: sameSlot.station };
      return { ...base, station: primary.isFirstCh ? primary.station : base.station };
    }
    return { dayKorean: primary.day, timeText: primary.time, station: primary.station };
  }

  window.SyoboiSchedule = { loadIndex, findEntry, mergeBroadcast, normalizeTitle };
})();
