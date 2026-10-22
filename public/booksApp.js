// "일본 만화·소설 순위 정보" 화면. 애니메이션 방영 정보와 별개의 화면으로, 아직 애니화되지 않은 인기 원작을
// 찾는 IP 발굴용이다. 데이터는 AniListClient.getBookRanking(AniList 지표: 인기도/급상승/평점)만 쓴다.
// 주의: 이 순위의 인기도는 AniList 이용자의 목록 등록 수이지 일본 서점 판매량이 아니다.
//
// 서버(AniList)에서는 "조회 기준"으로 상위 200건만 받아오고, 그 200건을 다시 거르고(필터) 정렬하는 것은
// 전부 이 파일에서 브라우저가 한다 — 필터/정렬을 바꿔도 AniList를 다시 호출하지 않는다.
//
// app.js가 먼저 로드되며, 그쪽의 공용 표 셀 헬퍼(createCoverCell/createTitleCell/createCell/
// createNumberCell/createLinkCell/createTagListCell), getTitleColumnWidth, setupInfoPopup,
// updateSourceStatus를 그대로 재사용한다.
(function () {
  'use strict';

  const BOOK_TYPE_LABELS = { MANGA: '만화', NOVEL: '라이트노벨' };
  const ADAPTATION_LABELS = {
    none: '미애니화',
    airing: '애니 방영 중',
    planned: '애니 제작 예정',
    finished: '애니 방영 완료',
    cancelled: '애니 중단'
  };
  // 애니화 칸을 정렬할 때의 순서: 오름차순이면 미애니화(IP 후보)가 맨 위로 온다.
  const ADAPTATION_ORDER = { none: 0, planned: 1, airing: 2, finished: 3, cancelled: 4 };

  // 정렬/필터에 쓰는 숫자 칸. get: 값을 꺼내는 함수, defaultDir: 헤더를 처음 눌렀을 때의 방향.
  const SORT_FIELDS = {
    popularity: { label: '인기도', get: (item) => item.popularity, defaultDir: 'desc' },
    score: { label: '평점', get: (item) => item.score, defaultDir: 'desc' },
    favorites: { label: '즐겨찾기', get: (item) => item.favorites, defaultDir: 'desc' },
    trending: { label: '급상승', get: (item) => item.trending, defaultDir: 'desc' },
    adaptation: { label: '애니화', get: (item) => ADAPTATION_ORDER[item.adaptation.state] ?? null, defaultDir: 'asc' }
  };
  const MAX_SORT_LEVELS = 3;

  const modeButtons = document.querySelectorAll('.mode-btn');
  const animeMode = document.getElementById('animeMode');
  const booksMode = document.getElementById('booksMode');
  const bookTypeButtons = document.querySelectorAll('.book-type-btn');
  const bookTitle = document.getElementById('bookTitle');
  const bookSourceStatus = document.getElementById('bookSourceStatus');
  const bookSortSelect = document.getElementById('bookSortSelect');
  const bookAdaptationFilter = document.getElementById('bookAdaptationFilter');
  const bookMinInputs = {
    popularity: document.getElementById('bookMinPopularity'),
    score: document.getElementById('bookMinScore'),
    favorites: document.getElementById('bookMinFavorites'),
    trending: document.getElementById('bookMinTrending')
  };
  const bookFilterResetBtn = document.getElementById('bookFilterResetBtn');
  const bookSortResetBtn = document.getElementById('bookSortResetBtn');
  const bookSummary = document.getElementById('bookSummary');
  const bookLoading = document.getElementById('bookLoading');
  const bookTableContainer = document.getElementById('bookTableContainer');
  const bookEmptyMessage = document.getElementById('bookEmptyMessage');
  const sortLevelSelects = [...document.querySelectorAll('.book-sort-field')];
  const sortLevelDirButtons = [...document.querySelectorAll('.book-sort-dir')];

  setupInfoPopup(document.getElementById('bookInfoBtn'), document.getElementById('bookInfoPopup'));

  const state = {
    type: 'MANGA',
    sort: 'popularity', // 서버에 요청하는 조회 기준(상위 200건을 고르는 기준)
    adaptation: 'all', // 애니화 필터: 'all' 또는 resolveAdaptationState의 state
    min: { popularity: null, score: null, favorites: null, trending: null },
    sorts: [] // [{ field, dir }] 1차→2차→3차 정렬. 비어 있으면 조회 기준 순서(순위) 그대로
  };
  // (종류|조회 기준)별로 한 번 받은 결과를 재사용한다. AniList는 요청 간격 제한 때문에 한 번 받는 데
  // 약 9초 걸려서, 같은 조건으로 돌아왔을 때 다시 받지 않게 한다. 실패한 결과는 캐시하지 않는다.
  const cache = new Map();
  let renderToken = 0;
  let booksLoadedOnce = false;
  let currentItems = [];

  function loadRanking() {
    const key = `${state.type}|${state.sort}`;
    if (!cache.has(key)) {
      if (!window.AniListClient?.getBookRanking) {
        return Promise.resolve({ source: 'error', items: [], errorMessage: 'AniList 클라이언트를 불러오지 못했습니다.' });
      }
      const promise = window.AniListClient.getBookRanking(state.type, state.sort);
      promise.then((result) => {
        if (result.source === 'error') cache.delete(key);
      });
      cache.set(key, promise);
    }
    return cache.get(key);
  }

  // ---- 필터/정렬 -------------------------------------------------------------

  function applyFilters(items) {
    return items.filter((item) => {
      if (state.adaptation !== 'all' && item.adaptation.state !== state.adaptation) return false;
      return Object.entries(state.min).every(([field, min]) => {
        if (min === null) return true;
        const value = SORT_FIELDS[field].get(item);
        return typeof value === 'number' && value >= min; // 값이 없는 작품은 최소값 조건을 통과하지 못한다
      });
    });
  }

  // 1차→2차→3차 순서로 비교한다. 값이 없는(null) 작품은 방향과 무관하게 항상 뒤로 보낸다.
  function applySorts(items) {
    if (state.sorts.length === 0) return items;
    return [...items].sort((a, b) => {
      for (const { field, dir } of state.sorts) {
        const va = SORT_FIELDS[field].get(a);
        const vb = SORT_FIELDS[field].get(b);
        const aMissing = typeof va !== 'number';
        const bMissing = typeof vb !== 'number';
        if (aMissing && bMissing) continue;
        if (aMissing) return 1;
        if (bMissing) return -1;
        if (va !== vb) return dir === 'asc' ? va - vb : vb - va;
      }
      return a.rank - b.rank; // 전부 같으면 조회 기준 순위대로
    });
  }

  function describeSorts() {
    if (state.sorts.length === 0) return '조회 기준 순위 순';
    return state.sorts.map(({ field, dir }) => `${SORT_FIELDS[field].label} ${dir === 'asc' ? '↑' : '↓'}`).join(' → ');
  }

  function describeFilters() {
    const parts = [];
    if (state.adaptation !== 'all') parts.push(ADAPTATION_LABELS[state.adaptation]);
    Object.entries(state.min).forEach(([field, min]) => {
      if (min !== null) parts.push(`${SORT_FIELDS[field].label} ≥ ${min.toLocaleString('ko-KR')}`);
    });
    return parts.join(', ');
  }

  // 정렬 칸(1~3차 select/방향 버튼)을 state.sorts와 맞춘다.
  function syncSortControls() {
    sortLevelSelects.forEach((select, level) => {
      select.value = state.sorts[level]?.field || '';
    });
    sortLevelDirButtons.forEach((button, level) => {
      const sort = state.sorts[level];
      button.disabled = !sort;
      button.textContent = sort?.dir === 'asc' ? '↑ 오름차순' : '↓ 내림차순';
    });
  }

  // 정렬 칸을 바꿀 때: 같은 칸을 비우면 그 아래 단계도 함께 줄이고, 같은 칸을 두 번 고르지 못하게 한다.
  function readSortControls() {
    const next = [];
    sortLevelSelects.forEach((select, level) => {
      const field = select.value;
      if (!field || next.some((sort) => sort.field === field)) return;
      const previous = state.sorts[level];
      next.push({ field, dir: previous && previous.field === field ? previous.dir : SORT_FIELDS[field].defaultDir });
    });
    state.sorts = next.slice(0, MAX_SORT_LEVELS);
  }

  // 표 머리글 클릭: 이미 1차 정렬인 칸이면 방향만 뒤집고, 아니면 그 칸을 1차 정렬로 바꾼다(2·3차는 유지하되
  // 중복은 뺀다). 숫자 칸만 정렬할 수 있다.
  function handleHeaderSort(field) {
    const current = state.sorts[0];
    if (current && current.field === field) {
      state.sorts = [{ field, dir: current.dir === 'asc' ? 'desc' : 'asc' }, ...state.sorts.slice(1)];
    } else {
      const rest = state.sorts.filter((sort) => sort.field !== field);
      state.sorts = [{ field, dir: SORT_FIELDS[field].defaultDir }, ...rest].slice(0, MAX_SORT_LEVELS);
    }
    syncSortControls();
    renderView();
  }

  // ---- 표 ----------------------------------------------------------------------

  function createAdaptationCell(adaptation) {
    const td = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `adapt-badge adapt-badge-${adaptation.state}`;
    badge.textContent = ADAPTATION_LABELS[adaptation.state] || '정보 없음';
    if (adaptation.animeCount > 0) badge.title = `AniList에 등록된 애니메이션 ${adaptation.animeCount}건`;
    else badge.title = 'AniList에 연결된 애니메이션이 없음(실사 드라마·영화·게임 등은 반영되지 않음)';
    td.appendChild(badge);
    return td;
  }

  // sortField가 있는 칸은 머리글을 눌러 정렬할 수 있다.
  const BOOK_COLUMNS = [
    { label: '순위' },
    { label: '표지' },
    { label: '타이틀 (일본어)' },
    { label: '타이틀 (영어)' },
    { label: '작가' },
    { label: '인기도', sortField: 'popularity' },
    { label: '평점', sortField: 'score' },
    { label: '즐겨찾기', sortField: 'favorites' },
    { label: '급상승', sortField: 'trending' },
    { label: '연재 상태' },
    { label: '연재 시작' },
    { label: '애니화', sortField: 'adaptation' },
    { label: '장르/테마' },
    { label: '정보 보기' }
  ];

  function createBookHeaderCell(column) {
    const th = document.createElement('th');
    th.textContent = column.label;
    if (!column.sortField) return th;

    th.classList.add('sortable');
    th.title = '클릭하면 이 칸으로 정렬합니다(다시 누르면 방향 전환). 2·3차 정렬은 위의 정렬 칸에서 고릅니다.';
    const level = state.sorts.findIndex((sort) => sort.field === column.sortField);
    if (level >= 0) {
      th.classList.add('sorted');
      const indicator = document.createElement('span');
      indicator.className = 'sort-indicator';
      indicator.textContent = ` ${state.sorts[level].dir === 'asc' ? '▲' : '▼'}${state.sorts.length > 1 ? level + 1 : ''}`;
      th.appendChild(indicator);
    }
    th.addEventListener('click', () => handleBookHeaderClick(column.sortField));
    return th;
  }

  function handleBookHeaderClick(field) {
    handleHeaderSort(field);
  }

  function createBookRow(item, titleContentWidth) {
    const tr = document.createElement('tr');
    [
      createCell(`#${item.rank}`),
      createCoverCell(item.coverImage, item.titleEnglish || item.titleJapanese),
      createTitleCell(item.titleJapanese, titleContentWidth),
      createTitleCell(item.titleEnglish, titleContentWidth),
      createCell(item.authors.length > 0 ? item.authors.join(' / ') : '정보 없음'),
      createNumberCell(item.popularity),
      createCell(typeof item.score === 'number' ? item.score.toFixed(2) : '정보 없음'),
      createNumberCell(item.favorites),
      createNumberCell(item.trending),
      createCell(item.status),
      createCell(item.startDate),
      createAdaptationCell(item.adaptation),
      createTagListCell(item),
      createLinkCell(item.officialSite)
    ].forEach((cell) => tr.appendChild(cell));
    return tr;
  }

  function renderTable(items) {
    bookTableContainer.replaceChildren();
    if (items.length === 0) return;

    const titleContentWidth = getTitleColumnWidth() - RATING_COLUMN_CELL_PADDING;
    const table = document.createElement('table');
    table.className = 'data-table';

    const headerRow = document.createElement('tr');
    BOOK_COLUMNS.forEach((column) => headerRow.appendChild(createBookHeaderCell(column)));
    const thead = document.createElement('thead');
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    items.forEach((item) => tbody.appendChild(createBookRow(item, titleContentWidth)));
    table.appendChild(tbody);

    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';
    wrapper.appendChild(table);
    bookTableContainer.appendChild(wrapper);
  }

  // 이미 받아 둔 목록(currentItems)에 필터와 정렬을 적용해 다시 그린다(네트워크 요청 없음).
  function renderView() {
    bookEmptyMessage.classList.add('hidden');
    const filtered = applyFilters(currentItems);
    const shown = applySorts(filtered);

    const filterText = describeFilters();
    bookSummary.textContent = `AniList 상위 ${currentItems.length}건 중 ${shown.length}건 표시`
      + (filterText ? ` · 필터: ${filterText}` : '')
      + ` · 정렬: ${describeSorts()} · 순위 번호는 조회 기준(필터·정렬 전) 순위입니다.`;

    if (shown.length === 0) {
      bookTableContainer.replaceChildren();
      bookEmptyMessage.textContent = '조건에 맞는 작품이 없습니다. 필터를 줄여 보세요.';
      bookEmptyMessage.classList.remove('hidden');
      return;
    }
    renderTable(shown);
  }

  async function refresh() {
    renderToken += 1;
    const token = renderToken;

    bookTitle.textContent = `일본 ${BOOK_TYPE_LABELS[state.type]} 순위`;
    bookEmptyMessage.classList.add('hidden');
    bookSummary.textContent = '';
    bookTableContainer.replaceChildren();
    bookLoading.classList.remove('hidden');

    const result = await loadRanking();
    if (token !== renderToken) return; // 그 사이 다른 조건으로 바뀜

    bookLoading.classList.add('hidden');
    updateSourceStatus(bookSourceStatus, result.source);

    if (result.source === 'error') {
      currentItems = [];
      bookEmptyMessage.textContent = result.errorMessage || '데이터를 불러오지 못했습니다.';
      bookEmptyMessage.classList.remove('hidden');
      return;
    }

    currentItems = result.items;
    renderView();
  }

  // ---- 화면 전환/이벤트 ----------------------------------------------------------

  function setMode(mode) {
    modeButtons.forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
    animeMode.classList.toggle('hidden', mode !== 'anime');
    booksMode.classList.toggle('hidden', mode !== 'books');

    // AniList 요청 한도(분당 약 30회)를 아끼려고, 만화·소설 화면은 처음 열 때 한 번만 불러온다.
    if (mode === 'books' && !booksLoadedOnce) {
      booksLoadedOnce = true;
      refresh();
    }
  }

  modeButtons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));

  bookTypeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.bookType === state.type) return;
      state.type = button.dataset.bookType;
      bookTypeButtons.forEach((b) => b.classList.toggle('active', b === button));
      refresh();
    });
  });

  bookSortSelect.addEventListener('change', () => {
    state.sort = bookSortSelect.value;
    refresh();
  });

  sortLevelSelects.forEach((select) => {
    select.addEventListener('change', () => {
      readSortControls();
      syncSortControls();
      renderView();
    });
  });

  sortLevelDirButtons.forEach((button, level) => {
    button.addEventListener('click', () => {
      const sort = state.sorts[level];
      if (!sort) return;
      sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
      syncSortControls();
      renderView();
    });
  });

  bookSortResetBtn.addEventListener('click', () => {
    state.sorts = [];
    syncSortControls();
    renderView();
  });

  bookAdaptationFilter.addEventListener('change', () => {
    state.adaptation = bookAdaptationFilter.value;
    renderView();
  });

  // 숫자 입력은 타이핑 중에 표가 계속 다시 그려지지 않게 잠깐 기다렸다가 적용한다.
  // 타이머는 입력 칸마다 따로 둔다(하나를 공유하면 다른 칸의 대기 중인 입력이 취소된다).
  Object.entries(bookMinInputs).forEach(([field, input]) => {
    let minInputTimer = null;
    input.addEventListener('input', () => {
      clearTimeout(minInputTimer);
      minInputTimer = setTimeout(() => {
        const value = input.value.trim() === '' ? null : Number(input.value);
        state.min[field] = Number.isFinite(value) ? value : null;
        renderView();
      }, 250);
    });
  });

  bookFilterResetBtn.addEventListener('click', () => {
    state.adaptation = 'all';
    bookAdaptationFilter.value = 'all';
    Object.keys(state.min).forEach((field) => {
      state.min[field] = null;
      bookMinInputs[field].value = '';
    });
    renderView();
  });

  syncSortControls();
})();
