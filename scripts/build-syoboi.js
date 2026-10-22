// Syoboi Calendar(https://cal.syoboi.jp)에서 앞으로 일주일 치 방영 편성을 받아
// public/syoboi-schedule.js (window.SYOBOI_SCHEDULE = {...}) 로 저장한다.
//
// Syoboi는 'Access-Control-Allow-Origin' 헤더를 주지 않아 브라우저에서 직접 호출할 수 없다.
// 그래서 이 스크립트를 주기적으로(예: 하루 1회) Node로 실행해 정적 파일을 만들어 두고,
// syoboiSchedule.js가 그 데이터를 일본어 제목으로 AniList/Kitsu 항목과 매칭해
// 방영일/시간/방송국을 채운다. 사용법: npm run build:syoboi
//
// JSON이 아니라 JS 파일로 쓰는 이유: 브라우저는 file:// 로 연 페이지에서 fetch()로 JSON을
// 읽지 못하지만, <script src>는 읽을 수 있다. 그래서 index.html을 파일로 직접 열어도,
// 정적 호스팅으로 올려도 똑같이 동작한다.

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://cal.syoboi.jp';
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'syoboi-schedule.js');
const LOOKAHEAD_DAYS = 8;
const TITLE_BATCH_SIZE = 40;
const ANIME_CATEGORIES = new Set(['1', '10']); // 직접 확인: 1=TV 애니메이션, 10=재방송/구작 애니메이션
const REQUEST_INTERVAL_MS = 400;
const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Syoboi 응답 오류: HTTP ${response.status} (${url})`);
  return response.text();
}

function xmlTag(block, tag) {
  const match = block.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
  return match ? match[1] : '';
}

function xmlItems(xml, itemTag) {
  const pattern = new RegExp('<' + itemTag + ' id="\\d+">([\\s\\S]*?)</' + itemTag + '>', 'g');
  return [...xml.matchAll(pattern)].map((m) => m[1]);
}

// 일본 현지(JST) 기준 날짜를 'YYYYMMDD_HHMMSS' 로 포맷한다(UTC getter에 +9시간).
function formatSyoboiTime(date) {
  const jst = new Date(date.getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${jst.getUTCFullYear()}${p(jst.getUTCMonth() + 1)}${p(jst.getUTCDate())}_${p(jst.getUTCHours())}${p(jst.getUTCMinutes())}00`;
}

// StTime('YYYY-MM-DD HH:MM:SS', JST)을 30시간제 관례(0~5시대는 전날 요일)로 요일/시각으로 바꾼다.
function resolveSlot(stTime) {
  const match = stTime.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if (!match) return null;
  const [, y, m, d, hh, mm] = match;
  const dow = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).getUTCDay();
  const hour = Number(hh);
  if (hour < 6) {
    return { day: DAY_LABELS[(dow + 6) % 7], time: `${hour + 24}:${mm}` };
  }
  return { day: DAY_LABELS[dow], time: `${hh}:${mm}` };
}

async function fetchChannels() {
  const xml = await fetchText(`${BASE_URL}/db.php?Command=ChLookup`);
  const names = new Map();
  xmlItems(xml, 'ChItem').forEach((block) => names.set(xmlTag(block, 'ChID'), xmlTag(block, 'ChName')));
  return names;
}

async function fetchPrograms(from, to) {
  const xml = await fetchText(`${BASE_URL}/db.php?Command=ProgLookup&Range=${formatSyoboiTime(from)}-${formatSyoboiTime(to)}`);
  return xmlItems(xml, 'ProgItem')
    .map((block) => ({
      tid: xmlTag(block, 'TID'),
      stTime: xmlTag(block, 'StTime'),
      chId: xmlTag(block, 'ChID'),
      deleted: xmlTag(block, 'Deleted') === '1'
    }))
    .filter((program) => !program.deleted);
}

async function fetchTitles(tids) {
  const titles = {};
  for (let i = 0; i < tids.length; i += TITLE_BATCH_SIZE) {
    if (i > 0) await sleep(REQUEST_INTERVAL_MS);
    const batch = tids.slice(i, i + TITLE_BATCH_SIZE);
    const json = JSON.parse(await fetchText(`${BASE_URL}/json.php?Req=TitleMedium&TID=${batch.join(',')}`));
    Object.assign(titles, json.Titles || {});
  }
  return titles;
}

async function main() {
  const from = new Date();
  const to = new Date(from.getTime() + LOOKAHEAD_DAYS * 24 * 3600 * 1000);

  const channelNames = await fetchChannels();
  await sleep(REQUEST_INTERVAL_MS);
  const programs = await fetchPrograms(from, to);
  await sleep(REQUEST_INTERVAL_MS);
  const titleIndex = await fetchTitles([...new Set(programs.map((p) => p.tid))]);

  const programsByTid = new Map();
  programs.forEach((program) => {
    if (!programsByTid.has(program.tid)) programsByTid.set(program.tid, []);
    programsByTid.get(program.tid).push(program);
  });

  const titles = [];
  programsByTid.forEach((list, tid) => {
    const title = titleIndex[tid];
    if (!title || !ANIME_CATEGORIES.has(title.Cat)) return;

    // 같은 방송국이 한 주에 여러 번 나오면 가장 빠른 것만 남기고, 방송국마다 하나씩 슬롯을 만든다.
    const earliestByChannel = new Map();
    list
      .slice()
      .sort((a, b) => a.stTime.localeCompare(b.stTime))
      .forEach((program) => {
        if (!earliestByChannel.has(program.chId)) earliestByChannel.set(program.chId, program);
      });

    const slots = [...earliestByChannel.values()]
      .map((program) => {
        const slot = resolveSlot(program.stTime);
        return slot ? { station: channelNames.get(program.chId) || '정보 없음', ...slot } : null;
      })
      .filter(Boolean);
    if (slots.length === 0) return;

    // 대표 슬롯: 첫 방송국(FirstCh)과 이름이 같은 방송국을 우선하고, 없으면 가장 빠른 슬롯.
    const firstChIndex = slots.findIndex((slot) => slot.station === title.FirstCh);
    const [primary] = slots.splice(Math.max(0, firstChIndex), 1);
    primary.isFirstCh = firstChIndex >= 0; // false면 FirstCh 편성이 이번 주 범위에 없어 임의 슬롯을 고른 것

    const officialLink = (title.Links || []).find((link) => link[1] === '公式');
    titles.push({
      tid,
      title: title.Title,
      titleEn: title.TitleEN || null,
      firstYear: title.FirstYear ? Number(title.FirstYear) : null,
      firstMonth: title.FirstMonth ? Number(title.FirstMonth) : null,
      officialSite: officialLink ? officialLink[0] : null,
      primary,
      others: slots
    });
  });

  const output = { generatedAt: new Date().toISOString(), titles };
  fs.writeFileSync(OUTPUT_PATH, `window.SYOBOI_SCHEDULE = ${JSON.stringify(output)};\n`);
  console.log(`[build-syoboi] ${titles.length}개 작품 편성을 ${OUTPUT_PATH} 에 저장했습니다.`);
}

main().catch((error) => {
  console.error(`[build-syoboi] 실패: ${error.message}`);
  process.exit(1);
});
