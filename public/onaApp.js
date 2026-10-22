// "분기 신작 애니메이션 (ONA 등)" 탭: format이 TV가 아닌 모든 작품(ONA/OVA/극장판/스페셜/뮤직/TV 숏)을
// 연도·시즌별로 보여준다. 요일별 방영 애니메이션 표와 같은 항목에서 방영일/방송 시간을 빼고 형태·시즌을 더했다.
// 데이터는 AniListClient.getNonTvSeasonal(AniList만)이며, 위의 데이터 소스 선택(AniList/Kitsu/Jikan)과 무관하다.
//
// 처음 이 탭을 열 때 오늘이 속한 시즌 하나를 불러온다(AniList 요청 한도를 아끼려고 탭을 열기 전에는 부르지 않는다).
// 연도/시즌은 여러 개를 고른 뒤 "조회"를 눌러야 적용되고(조합마다 요청하므로), 형태 필터와 정렬은 받은 목록에
// 즉시 적용된다.
//
// app.js의 공용 표 셀 헬퍼(createCell/createNumberCell/createTitleCell/createCoverCell/createTagListCell/
// createLinkCell/createScoreCell), getTitleColumnWidth, setupInfoPopup, updateSourceStatus, switchTab과
// multiSelect.js의 MultiSelect를 재사용한다.
(function () {
  'use strict';

  const SEASONS = [
    { value: 'WINTER', label: '겨울 (1~3월)', short: '겨울' },
    { value: 'SPRING', label: '봄 (4~6월)', short: '봄' },
    { value: 'SUMMER', label: '여름 (7~9월)', short: '여름' },
    { value: 'FALL', label: '가을 (10~12월)', short: '가을' }
  ];
  const SEASON_SHORT = Object.fromEntries(SEASONS.map((season) => [season.value, season.short]));
  const FORMAT_LABELS = {
    ONA: 'ONA', OVA: 'OVA', MOVIE: '극장판', SPECIAL: '스페셜', MUSIC: '뮤직', TV_SHORT: 'TV(단편)'
  };
  const YEAR_FIRST = 2000;
  const MANY_COMBOS_WARNING = 8; // 이 이상 조합을 고르면 오래 걸린다고 알려준다

  const loadBtn = document.getElementById('onaLoadBtn');
  const loadHint = document.getElementById('onaLoadHint');
  const sortSelect = document.getElementById('onaSortSelect');
  const sortDirBtn = document.getElementById('onaSortDirBtn');
  const summaryEl = document.getElementById('onaSummary');
  const loadingEl = document.getElementById('onaLoading');
  const loadingText = document.getElementById('onaLoadingText');
  const tableContainer = document.getElementById('onaTableContainer');
  const emptyEl = document.getElementById('onaEmptyMessage');
  const statusEl = document.getElementById('onaSourceStatus');
  const tabButton = document.querySelector('.tab-btn[data-tab="ona"]');

  setupInfoPopup(document.getElementById('onaInfoBtn'), document.getElementById('onaInfoPopup'));

  // 오늘이 속한 시즌(일본 방송 분기 기준: 10~12월 = 가을).
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentSeason = SEASONS[Math.floor(now.getMonth() / 3)].value;

  const SORT_FIELDS = {
    score: { label: '평점', get: (item) => item.score, defaultDir: 'desc' },
    popularityRank: { label: '인기도 순위', get: (item) => item.popularityRank, defaultDir: 'asc' },
    scoredBy: { label: '평가 참여자 수', get: (item) => item.scoredBy, defaultDir: 'desc' },
    favorites: { label: '즐겨찾기 수', get: (item) => item.favorites, defaultDir: 'desc' },
    firstAirDate: { label: '방영 시작일', get: (item) => toDateNumber(item.firstAirDate), defaultDir: 'asc' }
  };

  function toDateNumber(text) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || '');
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  }

  // 연도 목록: 내년부터 YEAR_FIRST년까지(내림차순).
  const yearOptions = [];
  for (let year = currentYear + 1; year >= YEAR_FIRST; year -= 1) yearOptions.push({ value: String(year), label: `${year}년` });

  const yearFilter = MultiSelect.create({ id: 'onaYear', options: yearOptions, allLabel: '(선택 없음)', onChange: updateLoadHint });
  const seasonFilter = MultiSelect.create({
    id: 'onaSeason',
    options: SEASONS.map((season) => ({ value: season.value, label: season.label })),
    allLabel: '(선택 없음)',
    onChange: updateLoadHint
  });
  const formatFilter = MultiSelect.create({
    id: 'onaFormat',
    options: Object.entries(FORMAT_LABELS).map(([value, label]) => ({ value, label })),
    onChange: (values) => {
      state.formats = values;
      renderView();
    }
  });
  document.getElementById('onaYearSlot').appendChild(yearFilter.element);
  document.getElementById('onaSeasonSlot').appendChild(seasonFilter.element);
  document.getElementById('onaFormatSlot').appendChild(formatFilter.element);

  // 기본 선택: 현재 월이 속한 시즌.
  yearFilter.setValues([String(currentYear)]);
  seasonFilter.setValues([currentSeason]);

  const state = {
    combos: [{ year: currentYear, season: currentSeason }], // 마지막으로 조회한 조합
    formats: new Set(), // 형태 필터(여러 개). 비어 있으면 전체
    sort: { field: 'score', dir: 'desc' },
    items: [],
    loadedOnce: false,
    token: 0
  };

  function selectedCombos() {
    const years = [...yearFilter.getValues()].map(Number).sort((a, b) => b - a);
    const seasonOrder = SEASONS.map((season) => season.value);
    const seasons = [...seasonFilter.getValues()].sort((a, b) => seasonOrder.indexOf(a) - seasonOrder.indexOf(b));
    return years.flatMap((year) => seasons.map((season) => ({ year, season })));
  }

  function updateLoadHint() {
    const combos = selectedCombos();
    if (combos.length === 0) {
      loadHint.textContent = '연도와 시즌을 하나 이상 고르세요.';
      loadBtn.disabled = true;
    } else {
      loadBtn.disabled = false;
      loadHint.textContent = combos.length >= MANY_COMBOS_WARNING
        ? `${combos.length}개 조합을 불러옵니다. AniList 요청 간격 때문에 1분 가까이 걸릴 수 있습니다.`
        : `${combos.length}개 조합(연도×시즌)을 불러옵니다. 고른 뒤 "조회"를 누르세요.`;
    }
  }

  // ---- 정렬/필터 ---------------------------------------------------------------

  function applySort(items) {
    const { field, dir } = state.sort;
    return [...items].sort((a, b) => {
      const va = SORT_FIELDS[field].get(a);
      const vb = SORT_FIELDS[field].get(b);
      const aMissing = typeof va !== 'number';
      const bMissing = typeof vb !== 'number';
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1; // 값이 없는 작품은 방향과 무관하게 뒤로
      if (bMissing) return -1;
      return dir === 'asc' ? va - vb : vb - va;
    });
  }

  function syncSortControls() {
    sortSelect.value = state.sort.field;
    sortDirBtn.textContent = state.sort.dir === 'asc' ? '↑ 오름차순' : '↓ 내림차순';
  }

  Object.entries(SORT_FIELDS).forEach(([value, field]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = field.label;
    sortSelect.appendChild(option);
  });

  sortSelect.addEventListener('change', () => {
    state.sort = { field: sortSelect.value, dir: SORT_FIELDS[sortSelect.value].defaultDir };
    syncSortControls();
    renderView();
  });
  sortDirBtn.addEventListener('click', () => {
    state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
    syncSortControls();
    renderView();
  });

  // ---- 표 ----------------------------------------------------------------------

  // 요일별 방영 표와 같은 칸에서 방영일/방송 시간을 빼고 형태·시즌을 더했다.
  const COLUMNS = [
    { label: 'No.' },
    { label: '표지' },
    { label: '타이틀 (일본어)' },
    { label: '타이틀 (영어)' },
    { label: '장르/테마' },
    { label: '형태' },
    { label: '평점', sortField: 'score' },
    { label: '평가 참여자 수', sortField: 'scoredBy' },
    { label: '인기도 순위', sortField: 'popularityRank' },
    { label: '즐겨찾기 수', sortField: 'favorites' },
    { label: '방영 시작일', sortField: 'firstAirDate' },
    { label: '시즌' },
    { label: '방송사' },
    { label: '정보 보기' }
  ];

  function createHeaderCell(column) {
    const th = document.createElement('th');
    th.textContent = column.label;
    if (!column.sortField) return th;

    th.classList.add('sortable');
    th.title = '클릭하면 이 칸으로 정렬합니다(다시 누르면 방향 전환).';
    if (state.sort.field === column.sortField) {
      th.classList.add('sorted');
      const indicator = document.createElement('span');
      indicator.className = 'sort-indicator';
      indicator.textContent = ` ${state.sort.dir === 'asc' ? '▲' : '▼'}`;
      th.appendChild(indicator);
    }
    th.addEventListener('click', () => {
      const field = column.sortField;
      state.sort = state.sort.field === field
        ? { field, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: SORT_FIELDS[field].defaultDir };
      syncSortControls();
      renderView();
    });
    return th;
  }

  function createRow(item, index, titleWidth) {
    const tr = document.createElement('tr');
    [
      createCell(index + 1),
      createCoverCell(item.coverImage, item.titleEnglish || item.titleJapanese),
      createTitleCell(item.titleJapanese, titleWidth, item.airingState),
      createTitleCell(item.titleEnglish, titleWidth),
      createTagListCell(item),
      createCell(FORMAT_LABELS[item.formatCode] || item.category),
      createScoreCell(item),
      createNumberCell(item.scoredBy),
      createCell(typeof item.popularityRank === 'number' ? `#${item.popularityRank}` : '정보 없음'),
      createNumberCell(item.favorites),
      createCell(item.firstAirDate),
      createCell(item.seasonYear && item.season ? `${item.seasonYear} ${SEASON_SHORT[item.season]}` : '정보 없음'),
      createCell(item.broadcastStation),
      createLinkCell(item.officialSite)
    ].forEach((cell) => tr.appendChild(cell));
    return tr;
  }

  function renderTable(items) {
    tableContainer.replaceChildren();
    const titleWidth = getTitleColumnWidth() - RATING_COLUMN_CELL_PADDING;

    const headerRow = document.createElement('tr');
    COLUMNS.forEach((column) => headerRow.appendChild(createHeaderCell(column)));
    const thead = document.createElement('thead');
    thead.appendChild(headerRow);
    const tbody = document.createElement('tbody');
    items.forEach((item, index) => tbody.appendChild(createRow(item, index, titleWidth)));

    const table = document.createElement('table');
    table.className = 'data-table';
    table.appendChild(thead);
    table.appendChild(tbody);
    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';
    wrapper.appendChild(table);
    tableContainer.appendChild(wrapper);
  }

  function describeCombos(combos) {
    return combos.map(({ year, season }) => `${year} ${SEASON_SHORT[season]}`).join(', ');
  }

  function renderView() {
    emptyEl.classList.add('hidden');
    const filtered = state.formats.size > 0 ? state.items.filter((item) => state.formats.has(item.formatCode)) : state.items;
    const shown = applySort(filtered);

    const formatText = state.formats.size > 0 ? ` · 형태: ${[...state.formats].map((value) => FORMAT_LABELS[value]).join(' / ')}` : '';
    summaryEl.textContent = `${describeCombos(state.combos)} · 전체 ${state.items.length}건 중 ${shown.length}건 표시${formatText}`
      + ` · 정렬: ${SORT_FIELDS[state.sort.field].label} ${state.sort.dir === 'asc' ? '↑' : '↓'}`
      + ' · 인기도 순위는 지금 불러온 작품 안에서의 순위입니다.';

    if (shown.length === 0) {
      tableContainer.replaceChildren();
      emptyEl.textContent = state.items.length === 0 ? '해당 시즌에 TV 외 작품이 없습니다.' : '조건에 맞는 작품이 없습니다. 형태 필터를 줄여 보세요.';
      emptyEl.classList.remove('hidden');
      return;
    }
    renderTable(shown);
  }

  // ---- 불러오기 ----------------------------------------------------------------

  async function load(combos) {
    if (!window.AniListClient?.getNonTvSeasonal) {
      emptyEl.textContent = 'AniList 클라이언트를 불러오지 못했습니다.';
      emptyEl.classList.remove('hidden');
      return;
    }

    state.token += 1;
    const token = state.token;
    state.loadedOnce = true;
    state.combos = combos;
    loadBtn.disabled = true;
    emptyEl.classList.add('hidden');
    summaryEl.textContent = '';
    tableContainer.replaceChildren();
    loadingEl.classList.remove('hidden');
    loadingText.textContent = `AniList에서 불러오는 중... (0/${combos.length})`;

    const result = await window.AniListClient.getNonTvSeasonal(combos, (done, total) => {
      if (token === state.token) loadingText.textContent = `AniList에서 불러오는 중... (${done}/${total})`;
    });
    if (token !== state.token) return; // 그 사이 다시 조회함

    loadingEl.classList.add('hidden');
    loadBtn.disabled = selectedCombos().length === 0;
    updateSourceStatus(statusEl, result.source);

    if (result.source === 'error') {
      state.items = [];
      emptyEl.textContent = result.errorMessage || '데이터를 불러오지 못했습니다.';
      emptyEl.classList.remove('hidden');
      return;
    }

    state.items = result.items;
    renderView();
    if (result.failed.length > 0) {
      summaryEl.textContent += ` · 일부 조합 조회 실패: ${describeCombos(result.failed)}`;
    }
  }

  loadBtn.addEventListener('click', () => {
    const combos = selectedCombos();
    if (combos.length > 0) load(combos);
  });

  // 탭을 처음 열 때만 기본 시즌(현재 월이 속한 시즌)을 자동으로 불러온다.
  tabButton.addEventListener('click', () => {
    if (!state.loadedOnce) load(state.combos);
  });

  syncSortControls();
  updateLoadHint();
})();
