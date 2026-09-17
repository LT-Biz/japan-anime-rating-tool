const dateInput = document.getElementById('baseDate');
const searchBtn = document.getElementById('searchBtn');
const periodDisplay = document.getElementById('periodDisplay');
const loadingIndicator = document.getElementById('loadingIndicator');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
const ratingDaysContainer = document.getElementById('ratingDaysContainer');
const ratingEmptyMessage = document.getElementById('ratingEmptyMessage');
const newTableBody = document.getElementById('newTableBody');
const newEmptyMessage = document.getElementById('newEmptyMessage');
const sortFieldSelect = document.getElementById('sortFieldSelect');
const sortDirectionBtn = document.getElementById('sortDirectionBtn');
const searchTitleInput = document.getElementById('searchTitleInput');
const searchTitleBtn = document.getElementById('searchTitleBtn');
const searchResultsContainer = document.getElementById('searchResultsContainer');
const searchEmptyMessage = document.getElementById('searchEmptyMessage');
const ratingSourceStatus = document.getElementById('ratingSourceStatus');
const newSourceStatus = document.getElementById('newSourceStatus');
const searchSourceStatus = document.getElementById('searchSourceStatus');
const sourceButtons = document.querySelectorAll('.source-btn');
const ratingInfoBtn = document.getElementById('ratingInfoBtn');
const ratingInfoPopup = document.getElementById('ratingInfoPopup');
const sourceInfoBtn = document.getElementById('sourceInfoBtn');
const sourceInfoPopup = document.getElementById('sourceInfoPopup');
const imageModal = document.getElementById('imageModal');
const imageModalImg = document.getElementById('imageModalImg');
const tagListModal = document.getElementById('tagListModal');
const tagListModalTitle = document.getElementById('tagListModalTitle');
const tagListModalBody = document.getElementById('tagListModalBody');
const tagListCloseBtn = document.getElementById('tagListCloseBtn');

// '?' 버튼을 누르면 안내 문구를 작은 팝업으로 보여준다(항상 펼쳐져 있던 긴 안내
// 문단을 필요할 때만 보이도록 접어둔 것). 팝업 바깥을 클릭하면 닫힌다. 요일별
// 방영 탭과 데이터 소스 패널 둘 다 같은 패턴을 쓰므로 공용 헬퍼로 뺐다.
function setupInfoPopup(btn, popup) {
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    popup.classList.toggle('hidden');
  });

  document.addEventListener('click', (event) => {
    if (popup.classList.contains('hidden')) return;
    if (event.target === btn || popup.contains(event.target)) return;
    popup.classList.add('hidden');
  });
}

setupInfoPopup(ratingInfoBtn, ratingInfoPopup);
setupInfoPopup(sourceInfoBtn, sourceInfoPopup);

// 장르/테마가 4개를 넘어가면 표/카드에는 앞 4개만 보이고 '+N' 버튼으로 전체
// 목록을 팝업에 띄운다. 팝업 내용을 다시 읽을 수 있어야 하므로(이미지 팝업과
// 달리) 배경(바깥) 클릭이나 닫기 버튼으로만 닫히고, 팝업 내용 클릭으로는 안
// 닫힌다.
function openTagListModal(item) {
  tagListModalTitle.textContent = item.titleEnglish || item.titleJapanese || item.title || '';
  tagListModalBody.innerHTML = '';

  (item.genres || []).forEach((genre) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.textContent = genre;
    tagListModalBody.appendChild(chip);
  });

  (item.themes || []).forEach((theme) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip tag-chip-theme';
    chip.textContent = theme;
    tagListModalBody.appendChild(chip);
  });

  if (!tagListModalBody.children.length) {
    tagListModalBody.textContent = '정보 없음';
  }

  tagListModal.classList.remove('hidden');
}

function closeTagListModal() {
  tagListModal.classList.add('hidden');
}

tagListModal.addEventListener('click', (event) => {
  if (event.target === tagListModal) closeTagListModal();
});
tagListCloseBtn.addEventListener('click', closeTagListModal);

// 커버 이미지 축소본을 누르면 원본 크기로 팝업(모달)에 띄운다. 이미지 자체를
// 누르거나 이미지 바깥(어두운 배경)을 눌러도 닫힌다 — 오버레이 한 곳에만 리스너를
// 달아두면 이미지 클릭도 자연스럽게 버블링돼 같이 처리된다.
function openImageModal(src, alt) {
  if (!src) return;
  imageModalImg.src = src;
  imageModalImg.alt = alt || '';
  imageModal.classList.remove('hidden');
}

function closeImageModal() {
  imageModal.classList.add('hidden');
  imageModalImg.src = '';
}

imageModal.addEventListener('click', closeImageModal);

// ---- 데이터 소스 선택(AniList / Kitsu / Jikan) -----------------------------
// 예전에는 Jikan이 실패하면 코드가 자동으로 Kitsu를 대신 호출하는 폴백 체인이었지만,
// 지금은 사용자가 상단 버튼으로 셋 중 하나를 직접 선택하고 그 API만 호출한다.
// 기본값은 AniList API. 선택한 API 호출이 실패하면 그 API 클라이언트 자체의 Mock
// 데이터로만 대체되며(다른 API로 자동 전환되지 않음), 배지로 실시간/예시 여부를 표시한다.
const CLIENT_GETTERS = {
  anilist: () => window.AniListClient,
  kitsu: () => window.KitsuClient,
  jikan: () => window.JikanClient
};
const SOURCE_LABELS = { anilist: 'AniList', kitsu: 'Kitsu', jikan: 'Jikan' };
const SOURCE_STATUS_DOT_IDS = { anilist: 'anilistStatusDot', kitsu: 'kitsuStatusDot', jikan: 'jikanStatusDot' };

let activeSource = 'anilist';

function getActiveClient() {
  return CLIENT_GETTERS[activeSource]?.();
}

sourceButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const source = btn.dataset.source;
    if (!source || source === activeSource) return;
    activeSource = source;
    sourceButtons.forEach((b) => b.classList.toggle('active', b.dataset.source === activeSource));
    fetchAnimeData(dateInput.value);
  });
});

function updateSourceDot(source, ok) {
  const dot = document.getElementById(SOURCE_STATUS_DOT_IDS[source]);
  if (!dot) return;
  dot.classList.remove('source-btn-dot-ok', 'source-btn-dot-fail');
  dot.classList.add(ok ? 'source-btn-dot-ok' : 'source-btn-dot-fail');
}

// 페이지 진입 시 세 API 모두에 재시도 없이 1회씩 상태를 확인해 버튼 옆 점을
// 초록(정상)/빨강(실패)으로 표시한다. 화면에 표시 중인 데이터는 건드리지 않는다.
async function checkAllSourceStatus() {
  await Promise.all(
    Object.keys(CLIENT_GETTERS).map(async (source) => {
      try {
        const client = CLIENT_GETTERS[source]();
        if (!client) throw new Error('모듈을 찾을 수 없습니다.');
        const result = await client.checkStatus();
        updateSourceDot(source, Boolean(result?.ok));
      } catch (error) {
        console.error(`[app] ${SOURCE_LABELS[source]} API 상태 확인 실패:`, error);
        updateSourceDot(source, false);
      }
    })
  );
}

// 선택한 API로 실제 실시간 데이터를 가져왔는지, 그 API가 실패해 예시(Mock)
// 데이터로 대체됐는지(또는 검색 오류)를 각 탭 제목 옆에 표시한다.
function updateSourceStatus(el, source) {
  if (!el) return;

  if (source === 'anilist' || source === 'kitsu' || source === 'jikan') {
    el.textContent = `${SOURCE_LABELS[source]} API 실시간 연동됨`;
    el.className = 'source-status source-status-live';
  } else if (source === 'mock') {
    el.textContent = 'API 조회 실패 - 예시 데이터 표시 중';
    el.className = 'source-status source-status-mock';
  } else if (source === 'error') {
    el.textContent = 'API 조회 실패';
    el.className = 'source-status source-status-error';
  } else {
    el.className = 'source-status hidden';
    return;
  }

  el.classList.remove('hidden');
}

const SORT_FIELD_LABELS = {
  score: '평점',
  scoredBy: '평가 참여자 수',
  popularityRank: '인기도 순위',
  favorites: '즐겨찾기 수',
  broadcastDayKorean: '방영일'
};

// 정렬 기준을 바꿀 때 기본으로 어느 방향에서 시작할지 결정한다.
// (평점/참여자 수/즐겨찾기 수는 큰 값이 위로 오는 게 자연스럽고, 인기도 순위는
//  MAL 관례상 숫자가 작을수록 인기가 높으므로 오름차순이 자연스럽다. 방영일은
//  일→토 순서로 읽는 게 자연스러워 오름차순을 기본으로 한다.)
const SORT_DEFAULT_DIRECTION = {
  score: 'desc',
  scoredBy: 'desc',
  popularityRank: 'asc',
  favorites: 'desc',
  broadcastDayKorean: 'asc'
};

// 서버에서 받은 요일별 원본 데이터(days: 7개 요일 섹션, unscheduled: 방송 요일 미상 항목)
// 화면에는 더 이상 요일별로 나누어 그리지 않고(renderRatingDays 참고) 하나의 표로
// 합쳐서 보여주며, 각 행의 '방영일' 칸으로 요일을 구분한다. 기본 정렬 기준은 평점
// 높은 순.
let currentWeeklyRatings = { days: [], unscheduled: [] };
let ratingSort = { field: 'score', direction: 'desc' };

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 'YYYY-MM-DD' 문자열을 'new Date(문자열)'로 바로 넘기면 UTC로 파싱되어,
// UTC보다 뒤처진 타임존(예: 미주 지역)의 브라우저에서 하루 밀리는 오류가 있었다.
// y/m/d를 직접 분해해 로컬 타임존으로 생성해 이 문제를 없앤다.
function parseDateOnly(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// 선택한 날짜를 기준으로 최근 7일간(선택일 포함)의 조회 기간을 계산해 표시
function updatePeriodDisplay(baseDateStr) {
  if (!baseDateStr) {
    periodDisplay.textContent = '';
    return;
  }

  const endDate = parseDateOnly(baseDateStr);
  const startDate = parseDateOnly(baseDateStr);
  startDate.setDate(endDate.getDate() - 6);

  const startStr = formatDate(startDate);
  const endStr = formatDate(endDate);

  periodDisplay.textContent = `조회 기간: ${startStr} ~ ${endStr} (7일간)`;
}

function switchTab(tabId) {
  tabButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === tabId);
  });
}

function setLoading(isLoading) {
  loadingIndicator.classList.toggle('hidden', !isLoading);
}

function createCell(text) {
  const td = document.createElement('td');
  td.textContent = text ?? '정보 없음';
  return td;
}

function createLinkCell(url) {
  const td = document.createElement('td');
  if (url && /^https?:\/\//.test(url)) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = '바로가기';
    td.appendChild(a);
  } else {
    td.textContent = '정보 없음';
  }
  return td;
}

// 커버 이미지 축소본 셀. 이미지를 누르면 원본 크기 팝업으로 띄운다.
function createCoverCell(coverImage, alt) {
  const td = document.createElement('td');
  if (coverImage) {
    const img = document.createElement('img');
    img.src = coverImage;
    img.alt = alt || '커버 이미지';
    img.className = 'cover-thumb';
    img.loading = 'lazy';
    img.addEventListener('click', () => openImageModal(coverImage, alt));
    td.appendChild(img);
  } else {
    td.textContent = '정보 없음';
  }
  return td;
}

// 장르(genres)와 테마(themes)를 하나의 텍스트로 합친다. 표 열 너비를 계산할 때
// 쓰는 '미리보기 텍스트' 용도로만 쓰고, 실제 화면에는 appendTagListContent가
// 그리는 '+N' 버튼 붙은 버전을 사용한다(전체 목록은 버튼을 눌러 팝업으로 본다).
function formatTagList(item) {
  const all = [...(item?.genres || []), ...(item?.themes || [])];
  if (all.length === 0) return '정보 없음';
  const shown = all.slice(0, 4);
  const remaining = all.length - shown.length;
  return remaining > 0 ? `${shown.join(', ')} 외 ${remaining}개` : shown.join(', ');
}

// 장르/테마 앞 4개 + (남은 게 있으면) 전체 목록 팝업을 여는 '+N' 버튼을 container에
// 채운다. td/dd 어느 쪽에나 재사용할 수 있도록 대상 엘리먼트만 받는다.
function appendTagListContent(container, item) {
  const all = [...(item?.genres || []), ...(item?.themes || [])];

  if (all.length === 0) {
    container.textContent = '정보 없음';
    return;
  }

  const shown = all.slice(0, 4);
  const remaining = all.length - shown.length;
  container.appendChild(document.createTextNode(shown.join(', ')));

  if (remaining > 0) {
    container.appendChild(document.createTextNode(' '));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag-expand-btn';
    btn.textContent = `+${remaining}`;
    btn.setAttribute('aria-label', '전체 장르/테마 보기');
    btn.addEventListener('click', () => openTagListModal(item));
    container.appendChild(btn);
  }
}

function createTagListCell(item) {
  const td = document.createElement('td');
  appendTagListContent(td, item);
  return td;
}

function createTagListDetailField(item) {
  const field = document.createElement('div');
  field.className = 'anime-card-field';
  const dt = document.createElement('dt');
  dt.textContent = '장르/테마';
  const dd = document.createElement('dd');
  appendTagListContent(dd, item);
  field.appendChild(dt);
  field.appendChild(dd);
  return field;
}

// 타이틀이 길면 표 전체가 가로로 넓어지던 문제가 있어, 타이틀 칸은 고정 폭
// (getTitleColumnWidth 참고)으로 둔다. 넘치는 내용은 스크롤바를 보여주지 않고
// 잘라서만 표시하되(.title-scroll의 overflow-x:auto + 스크롤바 숨김 CSS),
// 마우스로 드래그해 텍스트를 선택/복사할 때는 브라우저가 자동으로 옆으로
// 스크롤해주므로 전체 내용에 접근하는 길은 남아 있다. contentWidth를 넘기면
// 칸이 별도 <colgroup>으로 폭을 강제하지 않는 표(신작 탭)에서도 span 자체가
// 폭을 고정해 똑같이 동작한다. 전체 텍스트는 title 속성(마우스 오버)으로도 볼 수 있다.
function createTitleCell(text, contentWidth) {
  const td = document.createElement('td');
  const span = document.createElement('span');
  span.className = 'title-scroll';
  span.textContent = text || '정보 없음';
  span.title = text || '정보 없음';
  if (contentWidth) span.style.maxWidth = `${contentWidth}px`;
  td.appendChild(span);
  return td;
}

// 방송시간이 "24:00" 이상(30시간제 보정값)이면 심야 편성으로 간주
function isLateNightBroadcast(broadcastTime) {
  if (!broadcastTime) return false;
  const match = broadcastTime.match(/^(\d{1,2}):\d{2}$/);
  return Boolean(match) && parseInt(match[1], 10) >= 24;
}

function createBroadcastTimeCell(broadcastTime) {
  const td = document.createElement('td');
  td.textContent = broadcastTime || '정보 없음';

  if (isLateNightBroadcast(broadcastTime)) {
    td.appendChild(document.createTextNode(' '));
    const badge = document.createElement('span');
    badge.className = 'badge badge-late-night';
    badge.textContent = '심야';
    td.appendChild(badge);
  }

  return td;
}

// 천 단위 구분자를 적용하되, 값이 없으면 '정보 없음'으로 표시
function createNumberCell(value) {
  const td = document.createElement('td');
  td.textContent = typeof value === 'number' ? value.toLocaleString('ko-KR') : '정보 없음';
  return td;
}

// 방영일(broadcastDayKorean)은 숫자가 아니라 한 글자 요일 문자열이라, 정렬을 위해
// 일→토 순서를 나타내는 숫자로 변환해야 한다. 방송 요일 미상(null)은 다른 필드의
// 정렬 방식과 동일하게 항상 맨 뒤로 보낸다.
const BROADCAST_DAY_ORDER = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };

function getSortValue(item, field) {
  if (field === 'broadcastDayKorean') {
    const order = BROADCAST_DAY_ORDER[item.broadcastDayKorean];
    return typeof order === 'number' ? order : null;
  }
  return item[field];
}

// null 값은 정렬 방향과 무관하게 항상 목록 맨 뒤로 보낸다.
function sortItems(items, field, direction) {
  return [...items].sort((a, b) => {
    const va = getSortValue(a, field);
    const vb = getSortValue(b, field);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return direction === 'asc' ? va - vb : vb - va;
  });
}

// 요일마다 표가 따로 그려지면 <table>이 자기 안의 내용만 보고 열 너비를 정하기
// 때문에, 같은 열이라도 표마다 폭이 달라져 헤더 위치가 어긋난다. 전체 목록을
// 통틀어 각 열에서 가장 긴 내용의 실제 렌더링 폭을 미리 재서, 모든 요일 표에
// 동일한 <colgroup> 폭으로 강제 적용해 세로선을 맞춘다.
const RATING_TABLE_FONT = '14px -apple-system, "Segoe UI", "Malgun Gothic", sans-serif';
const RATING_TABLE_HEADER_FONT = '600 12px -apple-system, "Segoe UI", "Malgun Gothic", sans-serif';
const RATING_COLUMN_CELL_PADDING = 16; // .data-table td/th의 좌우 padding 합(8px*2)
const RATING_COLUMN_BUFFER = 16; // 심야 뱃지 등 텍스트만으로 못 재는 여유폭
const RATING_COVER_COLUMN_WIDTH = 64; // 표지 열은 텍스트가 아니라 이미지라 고정폭 사용

// 일본어/영어 타이틀 칸은 내용 길이로 폭을 재지 않고, 일본어 20자가 넘지 않는
// 선에서 두 칸이 완전히 같은 폭으로 고정된다(createTitleCell 참고) — 긴 제목
// 하나 때문에 표 전체가 넓어지는 문제를 없애고, 두 칸의 폭/간격이 서로 달라
// 보이지 않게 한다.
const TITLE_COLUMN_SAMPLE = 'あ'.repeat(20);

const RATING_COLUMNS = [
  { label: 'No.', getText: (item, index) => String(index + 1), minWidth: 32 },
  { label: '표지', fixedWidth: RATING_COVER_COLUMN_WIDTH },
  { label: '타이틀 (일본어)', titleColumn: true },
  { label: '타이틀 (영어)', titleColumn: true },
  { label: '장르/테마', getText: (item) => formatTagList(item), minWidth: 140 },
  { label: '평점', getText: (item) => (typeof item.score === 'number' ? item.score.toFixed(2) : '정보 없음'), minWidth: 50 },
  { label: '평가 참여자 수', getText: (item) => (typeof item.scoredBy === 'number' ? item.scoredBy.toLocaleString('ko-KR') : '정보 없음'), minWidth: 50 },
  { label: '인기도 순위', getText: (item) => (typeof item.popularityRank === 'number' ? `#${item.popularityRank}` : '정보 없음'), minWidth: 50 },
  { label: '즐겨찾기 수', getText: (item) => (typeof item.favorites === 'number' ? item.favorites.toLocaleString('ko-KR') : '정보 없음'), minWidth: 50 },
  { label: '방영일', getText: (item) => item.broadcastDayKorean || '정보 없음', minWidth: 50 },
  { label: '방송시간', getText: (item) => `${item.broadcastTime || '정보 없음'}${isLateNightBroadcast(item.broadcastTime) ? ' 심야' : ''}`, minWidth: 60 },
  { label: '방송사', getText: (item) => item.broadcastStation || '정보 없음', minWidth: 60 },
  { label: '정보 보기', getText: () => '바로가기', minWidth: 50 }
];

let ratingCanvasContext = null;

function measureTextWidth(text, font) {
  if (!ratingCanvasContext) {
    ratingCanvasContext = document.createElement('canvas').getContext('2d');
  }
  ratingCanvasContext.font = font;
  return ratingCanvasContext.measureText(text).width;
}

// 타이틀(일본어)/타이틀(영어) 칸의 공용 고정 폭(칸 좌우 padding 포함). 한 번 계산한
// 값을 캐시해, 요일별 표뿐 아니라 신작 탭 표(별도 <colgroup> 없음)에서도 같은
// 숫자를 재사용해 두 화면의 타이틀 칸 크기 규칙이 항상 일치하도록 한다.
let cachedTitleColumnWidth = null;

function getTitleColumnWidth() {
  if (cachedTitleColumnWidth === null) {
    const sampleWidth = measureTextWidth(TITLE_COLUMN_SAMPLE, RATING_TABLE_FONT);
    const headerWidthJa = measureTextWidth('타이틀 (일본어)', RATING_TABLE_HEADER_FONT);
    const headerWidthEn = measureTextWidth('타이틀 (영어)', RATING_TABLE_HEADER_FONT);
    cachedTitleColumnWidth = Math.ceil(Math.max(sampleWidth, headerWidthJa, headerWidthEn)) + RATING_COLUMN_CELL_PADDING;
  }
  return cachedTitleColumnWidth;
}

// items: 요일 구분 없이 통합한 전체 목록(가장 긴 값을 찾기 위함). 정렬 순서와는 무관.
function computeRatingColumnWidths(items) {
  return RATING_COLUMNS.map((column) => {
    if (column.fixedWidth) return column.fixedWidth;
    if (column.titleColumn) return getTitleColumnWidth();

    const headerWidth = measureTextWidth(column.label, RATING_TABLE_HEADER_FONT);
    const maxContentWidth = items.reduce((max, item) => {
      const width = measureTextWidth(column.getText(item, 0), RATING_TABLE_FONT);
      return Math.max(max, width);
    }, 0);

    const width = Math.max(headerWidth, maxContentWidth, column.minWidth) + RATING_COLUMN_CELL_PADDING + RATING_COLUMN_BUFFER;
    return Math.ceil(width);
  });
}

function createRatingColgroup(columnWidths) {
  const colgroup = document.createElement('colgroup');
  columnWidths.forEach((width) => {
    const col = document.createElement('col');
    col.style.width = `${width}px`;
    colgroup.appendChild(col);
  });
  return colgroup;
}

// 평점/인기도 순위는 헤더를 클릭해도 바로 정렬할 수 있게 한다(정렬 기준 드롭다운과
// 별개의 빠른 진입점). 같은 필드를 다시 클릭하면 방향만 뒤집고, 다른 필드를 클릭하면
// 그 필드의 기본 방향으로 시작한다 — 흔한 표 헤더 정렬 UX와 동일.
const RATING_SORTABLE_HEADERS = [
  { label: 'No.' },
  { label: '표지' },
  { label: '타이틀 (일본어)' },
  { label: '타이틀 (영어)' },
  { label: '장르/테마' },
  { label: '평점', sortField: 'score' },
  { label: '평가 참여자 수' },
  { label: '인기도 순위', sortField: 'popularityRank' },
  { label: '즐겨찾기 수' },
  { label: '방영일', sortField: 'broadcastDayKorean' },
  { label: '방송시간' },
  { label: '방송사' },
  { label: '정보 보기' }
];

function handleHeaderSortClick(field) {
  if (ratingSort.field === field) {
    ratingSort.direction = ratingSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    ratingSort = { field, direction: SORT_DEFAULT_DIRECTION[field] || 'desc' };
  }
  sortFieldSelect.value = ratingSort.field;
  updateSortDirectionButtonLabel();
  renderRatingDays(currentWeeklyRatings);
}

// 해상도가 좁아 표에 좌우 스크롤이 생겨도 No./표지/타이틀(일본어) 세 칸만큼은
// 화면에 고정해두고 나머지(타이틀(영어) 이후)만 그 뒤로 스크롤되게 한다 —
// 스크롤 중에도 어떤 작품 행인지 계속 보이도록 하기 위함. position:sticky는
// 각 칸의 왼쪽 누적 폭(offset)을 알아야 하므로 columnWidths를 그대로 받는다.
const STICKY_COLUMN_COUNT = 3; // No. / 표지 / 타이틀 (일본어)

function applyStickyColumns(cells, columnWidths) {
  let offset = 0;
  for (let i = 0; i < STICKY_COLUMN_COUNT && i < cells.length; i += 1) {
    cells[i].classList.add('sticky-col');
    if (i === STICKY_COLUMN_COUNT - 1) cells[i].classList.add('sticky-col-last');
    cells[i].style.left = `${offset}px`;
    offset += columnWidths[i];
  }
}

function createRatingHeaderRow(columnWidths) {
  const tr = document.createElement('tr');
  const cells = [];

  RATING_SORTABLE_HEADERS.forEach((column) => {
    const th = document.createElement('th');

    if (column.sortField) {
      th.classList.add('sortable-header');
      const isActive = ratingSort.field === column.sortField;
      th.textContent = column.label + (isActive ? (ratingSort.direction === 'asc' ? ' ▲' : ' ▼') : '');
      th.addEventListener('click', () => handleHeaderSortClick(column.sortField));
    } else {
      th.textContent = column.label;
    }

    cells.push(th);
    tr.appendChild(th);
  });

  applyStickyColumns(cells, columnWidths);

  return tr;
}

function createRatingRow(item, index, columnWidths) {
  const tr = document.createElement('tr');
  const titleContentWidth = getTitleColumnWidth() - RATING_COLUMN_CELL_PADDING;
  const cells = [
    createCell(index + 1),
    createCoverCell(item.coverImage, item.titleEnglish || item.titleJapanese),
    createTitleCell(item.titleJapanese, titleContentWidth),
    createTitleCell(item.titleEnglish, titleContentWidth),
    createTagListCell(item),
    createCell(typeof item.score === 'number' ? item.score.toFixed(2) : '정보 없음'),
    createNumberCell(item.scoredBy),
    createCell(typeof item.popularityRank === 'number' ? `#${item.popularityRank}` : '정보 없음'),
    createNumberCell(item.favorites),
    createCell(item.broadcastDayKorean),
    createBroadcastTimeCell(item.broadcastTime),
    createCell(item.broadcastStation),
    createLinkCell(item.officialSite)
  ];

  cells.forEach((cell) => tr.appendChild(cell));
  applyStickyColumns(cells, columnWidths);

  return tr;
}

function createRatingTable(items, columnWidths) {
  const table = document.createElement('table');
  table.className = 'data-table';
  // colgroup 폭이 요일마다 흔들리지 않고 그대로 반영되도록 이 표에만 고정 레이아웃 적용
  // (신작 탭의 .data-table은 colgroup이 없어 auto 레이아웃을 그대로 써야 하므로 전역 CSS로는 못 뺌)
  table.style.tableLayout = 'fixed';
  table.appendChild(createRatingColgroup(columnWidths));

  const thead = document.createElement('thead');
  thead.appendChild(createRatingHeaderRow(columnWidths));
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const sorted = sortItems(items, ratingSort.field, ratingSort.direction);
  sorted.forEach((item, index) => tbody.appendChild(createRatingRow(item, index, columnWidths)));
  table.appendChild(tbody);

  const wrapper = document.createElement('div');
  wrapper.className = 'table-wrapper';
  wrapper.appendChild(table);
  return wrapper;
}

// 과거에는 요일마다 별도 표(day-block)로 나누어 그렸지만, 지금은 요일별 분류를
// 폐기하고 모든 항목(요일 미상 포함)을 하나의 표로 합쳐서 보여준다. 각 행의
// '방영일' 칸(RATING_COLUMNS)이 요일 구분을 대신하며, 정렬 기준 중 하나로도
// 선택할 수 있다(handleHeaderSortClick/handleSortFieldChange).
function renderRatingDays(weeklyRatings) {
  currentWeeklyRatings = weeklyRatings || { days: [], unscheduled: [] };
  ratingDaysContainer.innerHTML = '';

  const days = currentWeeklyRatings.days || [];
  const unscheduled = currentWeeklyRatings.unscheduled || [];
  const allItems = days.flatMap((day) => day.items).concat(unscheduled);

  if (allItems.length === 0) {
    ratingEmptyMessage.textContent = '데이터가 없습니다.';
    ratingEmptyMessage.classList.remove('hidden');
    return;
  }

  ratingEmptyMessage.classList.add('hidden');

  const columnWidths = computeRatingColumnWidths(allItems);
  ratingDaysContainer.appendChild(createRatingTable(allItems, columnWidths));
}

function updateSortDirectionButtonLabel() {
  sortDirectionBtn.textContent = ratingSort.direction === 'asc' ? '오름차순 ▲' : '내림차순 ▼';
}

function handleSortFieldChange() {
  const field = sortFieldSelect.value;
  ratingSort = { field, direction: SORT_DEFAULT_DIRECTION[field] || 'desc' };
  updateSortDirectionButtonLabel();
  renderRatingDays(currentWeeklyRatings);
}

function handleSortDirectionToggle() {
  ratingSort.direction = ratingSort.direction === 'asc' ? 'desc' : 'asc';
  updateSortDirectionButtonLabel();
  renderRatingDays(currentWeeklyRatings);
}

sortFieldSelect.addEventListener('change', handleSortFieldChange);
sortDirectionBtn.addEventListener('click', handleSortDirectionToggle);
// 드롭다운 마크업의 기본 선택 항목과 무관하게, 실제 기본 정렬 기준(ratingSort)과
// 항상 일치하도록 초기값을 코드에서 맞춰준다.
sortFieldSelect.value = ratingSort.field;
updateSortDirectionButtonLabel();

// firstAirDate는 'YYYY-MM-DD' 문자열이거나(각 클라이언트 공통) 날짜를 모를 때
// '미정' 같은 문자열이다. 'YYYY-MM-DD' 형식끼리는 문자열 비교만으로도 날짜 순서와
// 일치하므로 별도 Date 파싱 없이 정렬할 수 있고, 형식에 안 맞는 값은 다른 정렬
// 기준의 null 처리와 동일하게 항상 맨 뒤로 보낸다.
function getAirDateSortValue(item) {
  const value = item?.firstAirDate;
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function sortReleasesByAirDate(releases) {
  return [...releases].sort((a, b) => {
    const da = getAirDateSortValue(a);
    const db = getAirDateSortValue(b);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da < db ? -1 : da > db ? 1 : 0;
  });
}

function renderNewReleasesTable(releases) {
  newTableBody.innerHTML = '';

  if (!releases || releases.length === 0) {
    newEmptyMessage.textContent = '데이터가 없습니다.';
    newEmptyMessage.classList.remove('hidden');
    return;
  }

  newEmptyMessage.classList.add('hidden');

  sortReleasesByAirDate(releases).forEach((item) => {
    const tr = document.createElement('tr');
    tr.appendChild(createCoverCell(item.coverImage, item.title));
    tr.appendChild(createTitleCell(item.title, getTitleColumnWidth() - RATING_COLUMN_CELL_PADDING));
    tr.appendChild(createCell(item.studio));
    tr.appendChild(createCell(item.firstAirDate));
    tr.appendChild(createTagListCell(item));
    tr.appendChild(createLinkCell(item.officialSite));
    newTableBody.appendChild(tr);
  });
}

function createDetailField(label, text) {
  const field = document.createElement('div');
  field.className = 'anime-card-field';
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = text ?? '정보 없음';
  field.appendChild(dt);
  field.appendChild(dd);
  return field;
}

function createDetailLinkField(label, url) {
  const field = document.createElement('div');
  field.className = 'anime-card-field';
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  if (url && /^https?:\/\//.test(url)) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = '바로가기';
    dd.appendChild(a);
  } else {
    dd.textContent = '정보 없음';
  }
  field.appendChild(dt);
  field.appendChild(dd);
  return field;
}

function createAnimeCard(item) {
  const card = document.createElement('article');
  card.className = 'anime-card';

  const header = document.createElement('div');
  header.className = 'anime-card-header';

  if (item.coverImage) {
    const img = document.createElement('img');
    img.src = item.coverImage;
    img.alt = item.titleEnglish || item.titleJapanese || '커버 이미지';
    img.className = 'cover-thumb cover-thumb-card';
    img.loading = 'lazy';
    img.addEventListener('click', () => openImageModal(item.coverImage, img.alt));
    header.appendChild(img);
  }

  const titleBlock = document.createElement('div');
  const titleEn = document.createElement('h3');
  titleEn.textContent = item.titleEnglish;
  const titleJa = document.createElement('p');
  titleJa.className = 'anime-card-subtitle';
  titleJa.textContent = item.titleJapanese;
  titleBlock.appendChild(titleEn);
  titleBlock.appendChild(titleJa);
  header.appendChild(titleBlock);
  card.appendChild(header);

  const grid = document.createElement('dl');
  grid.className = 'anime-card-grid';
  grid.appendChild(createTagListDetailField(item));
  grid.appendChild(createDetailField('평점', typeof item.score === 'number' ? item.score.toFixed(2) : '정보 없음'));
  grid.appendChild(createDetailField('평가 참여자 수', typeof item.scoredBy === 'number' ? item.scoredBy.toLocaleString('ko-KR') : '정보 없음'));
  grid.appendChild(createDetailField('인기도 순위', typeof item.popularityRank === 'number' ? `#${item.popularityRank}` : '정보 없음'));
  grid.appendChild(createDetailField('즐겨찾기 수', typeof item.favorites === 'number' ? item.favorites.toLocaleString('ko-KR') : '정보 없음'));
  grid.appendChild(createDetailField('최초 방영일', item.firstAirDate));
  grid.appendChild(createDetailField('방영 시간', item.broadcastTime));
  grid.appendChild(createDetailField('총 화수', typeof item.episodes === 'number' ? `${item.episodes}화` : '정보 없음'));
  grid.appendChild(createDetailField('방송사', item.broadcastStation));
  grid.appendChild(createDetailLinkField('정보 보기', item.officialSite));
  card.appendChild(grid);

  return card;
}

function renderSearchResults(data) {
  searchResultsContainer.innerHTML = '';
  updateSourceStatus(searchSourceStatus, data?.source);

  if (!data || data.source === 'error') {
    searchEmptyMessage.textContent = data?.errorMessage || '검색 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
    searchEmptyMessage.classList.remove('hidden');
    return;
  }

  if (!data.results || data.results.length === 0) {
    searchEmptyMessage.textContent = '일치하는 애니메이션을 찾을 수 없습니다.';
    searchEmptyMessage.classList.remove('hidden');
    return;
  }

  searchEmptyMessage.classList.add('hidden');
  data.results.forEach((item) => searchResultsContainer.appendChild(createAnimeCard(item)));
}

async function handleSearchTitle() {
  const title = searchTitleInput.value.trim();

  if (!title) {
    searchResultsContainer.innerHTML = '';
    searchEmptyMessage.textContent = '검색할 타이틀을 입력해주세요.';
    searchEmptyMessage.classList.remove('hidden');
    return;
  }

  setLoading(true);

  try {
    const client = getActiveClient();
    if (!client) throw new Error(`${activeSource} 클라이언트를 찾을 수 없습니다.`);
    const data = await client.searchAnimeByTitle(title);
    renderSearchResults(data);
  } catch (error) {
    console.error('[app] 애니메이션 검색 실패:', error);
    renderSearchResults({ source: 'error' });
  } finally {
    setLoading(false);
  }
}

searchTitleBtn.addEventListener('click', handleSearchTitle);
searchTitleInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') handleSearchTitle();
});

function showFetchError() {
  currentWeeklyRatings = { days: [], unscheduled: [] };
  ratingDaysContainer.innerHTML = '';
  newTableBody.innerHTML = '';
  ratingEmptyMessage.textContent = '데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
  newEmptyMessage.textContent = '데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
  ratingEmptyMessage.classList.remove('hidden');
  newEmptyMessage.classList.remove('hidden');
  updateSourceStatus(ratingSourceStatus, 'error');
  updateSourceStatus(newSourceStatus, 'error');
}

async function fetchAnimeData(endDateStr) {
  if (!endDateStr) return;

  setLoading(true);

  try {
    const client = getActiveClient();
    if (!client) throw new Error(`${activeSource} 클라이언트를 찾을 수 없습니다.`);

    const [weeklyRatings, newReleases] = await Promise.all([
      client.getWeeklyRatings(endDateStr),
      client.getNewReleases(endDateStr)
    ]);

    renderRatingDays(weeklyRatings);
    renderNewReleasesTable(newReleases?.releases);
    updateSourceStatus(ratingSourceStatus, weeklyRatings?.source);
    updateSourceStatus(newSourceStatus, newReleases?.source);
  } catch (error) {
    console.error('[app] 애니메이션 데이터 조회 실패:', error);
    showFetchError();
  } finally {
    setLoading(false);
  }
}

function handleDateQuery() {
  const endDateStr = dateInput.value;
  updatePeriodDisplay(endDateStr);
  fetchAnimeData(endDateStr);
}

dateInput.addEventListener('change', handleDateQuery);
searchBtn.addEventListener('click', handleDateQuery);

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// 초기값: 오늘 날짜로 기본 세팅 후 자동 조회 + 세 API 상태 확인(기본 소스: AniList)
const today = formatDate(new Date());
dateInput.value = today;
updatePeriodDisplay(today);
checkAllSourceStatus();
fetchAnimeData(today);
