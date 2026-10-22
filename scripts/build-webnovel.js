// 웹소설 인기 랭킹(소설가가 되자 / 카쿠요무)의 주간·월간 상위 300건을 받아 public/webnovel-ranking.js
// (window.WEBNOVEL_RANKING = {...})로 저장한다. 두 사이트 모두 CORS를 허용하지 않아 브라우저에서 직접 부를
// 수 없으므로, Syoboi 편성표와 같은 방식으로 빌드 때 받아 정적 파일로 둔다(사용법: npm run build:webnovel).
//
// - 소설가가 되자: 공식 API(https://dev.syosetu.com/man/api/, 키 불필요). 주간/월간 포인트 순으로 300건.
//   공식 문서가 "결과를 캐시하되 길어도 2주 안에 갱신"하라고 요청한다.
// - 카쿠요무: 공식 API가 없어서 공개 랭킹 페이지(/rankings/all/{weekly|monthly})가 Next.js로 페이지 안에
//   심어 둔 데이터(__NEXT_DATA__의 Apollo 상태)를 읽는다. 한 페이지에 100건이라 3페이지가 300건이다.
//   개인 확인용이며, 요청 수를 최소로 하고(기간당 3회, 1.5초 간격) 작품 소개문 같은 본문은 저장하지 않는다.
//   사이트 구조가 바뀌면 깨질 수 있다.
//
// --soft: Vercel 배포 빌드용. 일부/전체 수집이 실패해도 빌드를 실패시키지 않고, 실패한 부분은 저장소의
// 기존 데이터를 그대로 둔다.

const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'webnovel-ranking.js');
const OUTPUT_PREFIX = 'window.WEBNOVEL_RANKING = ';
const TOP_N = 300;
const REQUEST_TIMEOUT_MS = 30000;
const KAKUYOMU_PAGE_SIZE = 100;
const KAKUYOMU_INTERVAL_MS = 1500;
const USER_AGENT = 'japan-anime-rating-tool (personal use; weekly ranking snapshot)';

const softMode = process.argv.includes('--soft');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- 공통 ----------------------------------------------------------------------

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} (${url})`);
  return response.text();
}

// 'YYYY-MM-DDTHH:MM:SSZ'(UTC) → 일본 시간(JST) 'YYYY-MM-DD'
function isoToJstDate(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 제목/키워드에 적힌 미디어믹스 표기. 소설가가 되자 API에는 서적화 여부 필드가 없어 글자로 추정한다.
function detectMediaMix(text) {
  const labels = [];
  if (/書籍化/.test(text)) labels.push('서적화');
  if (/コミカライズ/.test(text)) labels.push('코미컬라이즈');
  if (/アニメ化/.test(text)) labels.push('애니화');
  return labels;
}

function readExisting() {
  try {
    const text = fs.readFileSync(OUTPUT_PATH, 'utf8').trim();
    if (!text.startsWith(OUTPUT_PREFIX)) return null;
    return JSON.parse(text.slice(OUTPUT_PREFIX.length).replace(/;$/, ''));
  } catch {
    return null;
  }
}

// ---- 소설가가 되자 -----------------------------------------------------------------

const NAROU_GENRES = {
  101: '이세계〔연애〕', 102: '현실세계〔연애〕', 201: '하이 판타지', 202: '로우 판타지',
  301: '순문학', 302: '휴먼 드라마', 303: '역사', 304: '추리', 305: '호러', 306: '액션', 307: '코미디',
  401: 'VR 게임', 402: '우주', 403: '공상과학', 404: '패닉', 9901: '동화', 9902: '시', 9903: '에세이',
  9904: '리플레이', 9999: '기타', 9801: '논장르'
};

function mapNarouItem(raw, rank, periodPointKey) {
  const keywords = String(raw.keyword || '').split(/\s+/).filter(Boolean);
  let status = raw.end === 0 ? '완결' : '연재 중';
  if (raw.noveltype === 2) status = '단편';
  else if (raw.isstop === 1) status = '휴재';

  return {
    rank,
    id: raw.ncode,
    title: raw.title,
    author: raw.writer,
    url: `https://ncode.syosetu.com/${String(raw.ncode).toLowerCase()}/`,
    genre: NAROU_GENRES[raw.genre] || `장르 ${raw.genre}`,
    tags: keywords.slice(0, 8),
    status,
    episodes: typeof raw.general_all_no === 'number' ? raw.general_all_no : null,
    length: typeof raw.length === 'number' ? raw.length : null,
    firstDate: String(raw.general_firstup || '').slice(0, 10) || null,
    lastDate: String(raw.general_lastup || '').slice(0, 10) || null,
    periodPoint: typeof raw[periodPointKey] === 'number' ? raw[periodPointKey] : null,
    totalPoint: typeof raw.global_point === 'number' ? raw.global_point : null,
    bookmarks: typeof raw.fav_novel_cnt === 'number' ? raw.fav_novel_cnt : null,
    reviews: typeof raw.review_cnt === 'number' ? raw.review_cnt : null,
    ratings: typeof raw.all_hyoka_cnt === 'number' ? raw.all_hyoka_cnt : null,
    isekai: raw.istensei === 1 ? '전생' : raw.istenni === 1 ? '전이' : null,
    mediaMix: detectMediaMix(`${raw.title} ${raw.keyword}`)
  };
}

async function fetchNarou(order, periodPointKey) {
  const fields = 't-n-w-g-k-gf-gl-nt-e-ga-l-i-gp-dp-wp-mp-qp-f-r-a-ah-its-iti';
  const url = `https://api.syosetu.com/novelapi/api/?out=json&gzip=0&order=${order}&lim=${TOP_N}&of=${fields}`;
  const data = JSON.parse(await fetchText(url));
  const works = data.slice(1); // 첫 항목은 {allcount}
  if (works.length === 0 || !works[0].ncode) throw new Error('소설가가 되자 API 응답이 비어 있거나 형식이 다릅니다.');
  return works.map((raw, index) => mapNarouItem(raw, index + 1, periodPointKey));
}

// ---- 카쿠요무 -----------------------------------------------------------------------

// 카쿠요무 genre enum → 한국어. 알 수 없는 값은 원문 그대로 보여준다.
const KAKUYOMU_GENRES = {
  FANTASY: '이세계 판타지', ACTION: '현대 판타지', SF: 'SF', LOVE_STORY: '연애', ROMANCE: '러브코메디',
  DRAMA: '현대 드라마', HORROR: '호러', MYSTERY: '미스터리', NONFICTION: '에세이·논픽션',
  HISTORY: '역사·시대·전기', CRITICISM: '창작론·평론', OTHER: '시·동화·기타'
};

function extractKakuyomuApollo(html) {
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error('카쿠요무 페이지에서 __NEXT_DATA__를 찾지 못했습니다(사이트 구조 변경 가능성).');
  const apollo = JSON.parse(match[1])?.props?.pageProps?.__APOLLO_STATE__;
  if (!apollo) throw new Error('카쿠요무 페이지에서 Apollo 상태를 찾지 못했습니다(사이트 구조 변경 가능성).');
  return apollo;
}

function mapKakuyomuItem(work, author, rank) {
  const mediaMix = work.hasPublication ? ['서적화'] : [];
  let status = work.serialStatus === 'COMPLETED' ? '완결' : '연재 중';
  if (work.serialStatus === 'SUSPENDED' || work.serialStatus === 'HIATUS') status = '휴재';

  return {
    rank,
    id: work.id,
    title: work.title,
    author: author?.activityName || author?.name || '정보 없음',
    url: `https://kakuyomu.jp/works/${work.id}`,
    genre: KAKUYOMU_GENRES[work.genre] || work.genre || '정보 없음',
    tags: (work.tagLabels || []).slice(0, 8),
    status,
    episodes: typeof work.publicEpisodeCount === 'number' ? work.publicEpisodeCount : null,
    length: typeof work.totalCharacterCount === 'number' ? work.totalCharacterCount : null,
    firstDate: isoToJstDate(work.publishedAt),
    lastDate: isoToJstDate(work.lastEpisodePublishedAt),
    periodPoint: null, // 카쿠요무는 기간별 포인트를 주지 않는다(순위만 있음)
    totalPoint: typeof work.totalReviewPoint === 'number' ? work.totalReviewPoint : null, // 누적 별점
    bookmarks: null,
    reviews: null,
    ratings: null,
    isekai: null,
    mediaMix
  };
}

async function fetchKakuyomu(period) {
  const items = [];
  const pages = Math.ceil(TOP_N / KAKUYOMU_PAGE_SIZE);
  for (let page = 1; page <= pages; page += 1) {
    if (page > 1) await sleep(KAKUYOMU_INTERVAL_MS);
    const url = `https://kakuyomu.jp/rankings/all/${period}?work_variation=long&page=${page}`;
    const apollo = extractKakuyomuApollo(await fetchText(url));

    const rankedKey = Object.keys(apollo.ROOT_QUERY || {}).find((key) => key.startsWith('rankedWorks('));
    const nodes = rankedKey ? apollo.ROOT_QUERY[rankedKey]?.nodes : null;
    if (!Array.isArray(nodes) || nodes.length === 0) throw new Error(`카쿠요무 ${period} ${page}페이지의 랭킹 목록이 비어 있습니다.`);

    nodes.forEach((node) => {
      const work = apollo[node.__ref];
      if (!work || !work.title) return;
      const author = work.author?.__ref ? apollo[work.author.__ref] : null;
      items.push(mapKakuyomuItem(work, author, items.length + 1));
    });
    if (items.length >= TOP_N) break;
  }
  const ids = new Set(items.map((item) => item.id));
  if (ids.size !== items.length) throw new Error('카쿠요무 랭킹에 중복 작품이 있습니다(페이지네이션 이상).');
  return items.slice(0, TOP_N);
}

// ---- 실행 ---------------------------------------------------------------------------

async function main() {
  const existing = readExisting();
  const result = {
    generatedAt: new Date().toISOString(),
    narou: { weekly: existing?.narou?.weekly || null, monthly: existing?.narou?.monthly || null },
    kakuyomu: { weekly: existing?.kakuyomu?.weekly || null, monthly: existing?.kakuyomu?.monthly || null }
  };

  const jobs = [
    ['narou', 'weekly', () => fetchNarou('weeklypoint', 'weekly_point')],
    ['narou', 'monthly', () => fetchNarou('monthlypoint', 'monthly_point')],
    ['kakuyomu', 'weekly', () => fetchKakuyomu('weekly')],
    ['kakuyomu', 'monthly', () => fetchKakuyomu('monthly')]
  ];

  let succeeded = 0;
  for (const [site, period, run] of jobs) {
    try {
      result[site][period] = await run();
      succeeded += 1;
      console.log(`[build-webnovel] ${site} ${period}: ${result[site][period].length}건`);
    } catch (error) {
      console.warn(`[build-webnovel] ${site} ${period} 실패(기존 데이터 유지): ${error.message}`);
    }
    await sleep(500);
  }

  if (succeeded === 0) throw new Error('모든 랭킹 수집에 실패했습니다.');
  fs.writeFileSync(OUTPUT_PATH, `${OUTPUT_PREFIX}${JSON.stringify(result)};\n`);
  console.log(`[build-webnovel] ${succeeded}/${jobs.length}개 랭킹을 ${OUTPUT_PATH} 에 저장했습니다.`);
  if (succeeded < jobs.length && !softMode) process.exitCode = 1;
}

main().catch((error) => {
  if (softMode) {
    console.warn(`[build-webnovel] 갱신 실패, 기존 데이터를 그대로 사용합니다: ${error.message}`);
    return;
  }
  console.error(`[build-webnovel] 실패: ${error.message}`);
  process.exit(1);
});
