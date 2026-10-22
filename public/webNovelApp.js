// "소설가가 되자"와 "카쿠요무"의 주간/월간 인기 랭킹 상위 300건을 보여주는 웹소설 화면.
// 데이터는 빌드 때 scripts/build-webnovel.js가 만들어 둔 정적 파일(public/webnovel-ranking.js,
// window.WEBNOVEL_RANKING)이며, 두 사이트 모두 브라우저에서 직접 부를 수 없어서 스냅샷으로 둔다.
// 필터와 정렬은 전부 브라우저에서 이미 가진 300건에 적용한다.
//
// booksApp.js가 탭 전환 때 'books:tab' 이벤트(detail.tab = 'NAROU' | 'KAKUYOMU' | 'MANGA' | 'NOVEL')를
// 보내면, 이 파일이 웹소설 탭일 때만 패널을 보여주고 그렇지 않으면 숨긴다.
// app.js의 공용 표 셀 헬퍼(createCell/createNumberCell/createTitleCell/createLinkCell),
// getTitleColumnWidth, setupInfoPopup을 재사용한다.
(function () {
  'use strict';

  const SITE_LABELS = { NAROU: '소설가가 되자', KAKUYOMU: '카쿠요무' };
  const SITE_KEYS = { NAROU: 'narou', KAKUYOMU: 'kakuyomu' };
  const PERIOD_LABELS = { weekly: '주간', monthly: '월간' };
  const STALE_AFTER_DAYS = 14; // 소설가가 되자 API 문서가 요청하는 캐시 갱신 한도(길어도 2주)
  const MAX_SORT_LEVELS = 3;

  const panel = document.getElementById('webNovelPanel');
  const titleEl = document.getElementById('webNovelTitle');
  const freshnessEl = document.getElementById('webNovelFreshness');
  const toolbarEl = document.getElementById('webNovelToolbar');
  const summaryEl = document.getElementById('webNovelSummary');
  const tableContainer = document.getElementById('webNovelTableContainer');
  const emptyEl = document.getElementById('webNovelEmptyMessage');
  const toolbarRows = {};

  setupInfoPopup(document.getElementById('webNovelInfoBtn'), document.getElementById('webNovelInfoPopup'));

  const toDateNumber = (text) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || '');
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  };

  // 정렬 가능한 칸. sites: 이 칸이 있는 사이트(카쿠요무는 기간 포인트/북마크/리뷰가 없다).
  const SORT_FIELDS = {
    periodPoint: { label: () => `${PERIOD_LABELS[state.period]} 포인트`, get: (i) => i.periodPoint, sites: ['NAROU'], defaultDir: 'desc' },
    totalPoint: { label: () => (state.site === 'NAROU' ? '누적 포인트' : '누적 별점'), get: (i) => i.totalPoint, sites: ['NAROU', 'KAKUYOMU'], defaultDir: 'desc' },
    bookmarks: { label: () => '북마크', get: (i) => i.bookmarks, sites: ['NAROU'], defaultDir: 'desc' },
    reviews: { label: () => '리뷰', get: (i) => i.reviews, sites: ['NAROU'], defaultDir: 'desc' },
    episodes: { label: () => '화수', get: (i) => i.episodes, sites: ['NAROU', 'KAKUYOMU'], defaultDir: 'desc' },
    length: { label: () => '글자 수', get: (i) => i.length, sites: ['NAROU', 'KAKUYOMU'], defaultDir: 'desc' },
    firstDate: { label: () => '연재 시작', get: (i) => toDateNumber(i.firstDate), sites: ['NAROU', 'KAKUYOMU'], defaultDir: 'desc' },
    lastDate: { label: () => '최종 갱신', get: (i) => toDateNumber(i.lastDate), sites: ['NAROU', 'KAKUYOMU'], defaultDir: 'desc' }
  };

  // 표 칸. sortField가 있으면 머리글을 눌러 정렬할 수 있다. sites가 없으면 두 사이트 공통.
  const COLUMNS = [
    { label: '순위', cell: (i) => createCell(`#${i.rank}`) },
    { label: '타이틀', cell: (i, w) => createTitleCell(i.title, w) },
    { label: '작가', cell: (i) => createCell(i.author) },
    { label: '장르', cell: (i) => createCell(i.genre) },
    { label: '태그', cell: (i) => createTagsCell(i.tags) },
    { label: '상태', cell: (i) => createCell(i.status) },
    { label: '화수', sortField: 'episodes', cell: (i) => createNumberCell(i.episodes) },
    { label: '글자 수', sortField: 'length', cell: (i) => createNumberCell(i.length) },
    { label: '연재 시작', sortField: 'firstDate', cell: (i) => createCell(i.firstDate || '정보 없음') },
    { label: '최종 갱신', sortField: 'lastDate', cell: (i) => createCell(i.lastDate || '정보 없음') },
    { label: () => `${PERIOD_LABELS[state.period]} 포인트`, sortField: 'periodPoint', sites: ['NAROU'], cell: (i) => createNumberCell(i.periodPoint) },
    { label: () => (state.site === 'NAROU' ? '누적 포인트' : '누적 별점'), sortField: 'totalPoint', cell: (i) => createNumberCell(i.totalPoint) },
    { label: '북마크', sortField: 'bookmarks', sites: ['NAROU'], cell: (i) => createNumberCell(i.bookmarks) },
    { label: '리뷰', sortField: 'reviews', sites: ['NAROU'], cell: (i) => createNumberCell(i.reviews) },
    { label: '이세계', sites: ['NAROU'], cell: (i) => createCell(i.isekai || '-') },
    { label: '서적화·미디어믹스', cell: (i) => createMediaMixCell(i) },
    { label: '정보 보기', cell: (i) => createLinkCell(i.url) }
  ];

  const state = {
    site: 'NAROU',
    period: 'weekly',
    genre: new Set(), // 장르 필터(여러 개 선택). 비어 있으면 전체
    status: new Set(), // 상태 필터(여러 개 선택). 비어 있으면 전체
    mediaMix: 'all', // 'all' | 'none'(표기가 없는 작품만 = 아직 서적화 등 안 된 후보) | 'has'
    query: '',
    min: { periodPoint: null, totalPoint: null },
    sorts: [] // [{ field, dir }]
  };

  function createTagsCell(tags) {
    const td = document.createElement('td');
    const shown = (tags || []).slice(0, 4);
    td.textContent = shown.length > 0 ? shown.join(', ') : '정보 없음';
    if ((tags || []).length > shown.length) {
      td.textContent += ` +${tags.length - shown.length}`;
      td.title = tags.join(', ');
    }
    return td;
  }

  function createMediaMixCell(item) {
    const td = document.createElement('td');
    if (item.mediaMix.length === 0) {
      td.textContent = '표기 없음';
      td.title = state.site === 'NAROU'
        ? '제목·키워드에 서적화/코미컬라이즈/애니화 표기가 없음(API에 서적화 필드가 없어 글자로 추정)'
        : '카쿠요무에 서적화 이력이 없음';
      return td;
    }
    td.textContent = item.mediaMix.join(', ');
    td.className = 'webnovel-mixed';
    return td;
  }

  function currentRanking() {
    const data = window.WEBNOVEL_RANKING;
    return data?.[SITE_KEYS[state.site]]?.[state.period] || null;
  }

  // ---- 필터/정렬 -------------------------------------------------------------

  const normalize = (text) => String(text || '').normalize('NFKC').toLowerCase();

  function applyFilters(items) {
    const query = normalize(state.query).trim();
    return items.filter((item) => {
      if (state.genre.size > 0 && !state.genre.has(item.genre)) return false;
      if (state.status.size > 0 && !state.status.has(item.status)) return false;
      if (state.mediaMix === 'none' && item.mediaMix.length > 0) return false;
      if (state.mediaMix === 'has' && item.mediaMix.length === 0) return false;
      if (query && !normalize(`${item.title} ${item.author} ${item.tags.join(' ')}`).includes(query)) return false;
      return Object.entries(state.min).every(([field, min]) => {
        if (min === null) return true;
        const value = SORT_FIELDS[field].get(item);
        return typeof value === 'number' && value >= min;
      });
    });
  }

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
      return a.rank - b.rank;
    });
  }

  const sortFieldsForSite = () => Object.keys(SORT_FIELDS).filter((field) => SORT_FIELDS[field].sites.includes(state.site));

  function describeSorts() {
    if (state.sorts.length === 0) return '사이트 순위 순';
    return state.sorts.map(({ field, dir }) => `${SORT_FIELDS[field].label()} ${dir === 'asc' ? '↑' : '↓'}`).join(' → ');
  }

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

  // ---- 도구줄(JS로 만든다) --------------------------------------------------------

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
      if (key === 'className') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node[key] = value;
    });
    children.forEach((child) => node.appendChild(child));
    return node;
  }

  function makeSelect(id, options, onChange) {
    const select = el('select', { id });
    options.forEach(([value, label]) => select.appendChild(el('option', { value, text: label })));
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  function makeNumberInput(id, placeholder, onValue) {
    const input = el('input', { type: 'number', id, min: '0', placeholder, className: 'book-min-input' });
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const value = input.value.trim() === '' ? null : Number(input.value);
        onValue(Number.isFinite(value) ? value : null);
      }, 250);
    });
    return input;
  }

  function buildToolbar() {
    // 1행: 기간 + 도움말
    toolbarRows.period = makeSelect('webNovelPeriod', [['weekly', '주간 랭킹'], ['monthly', '월간 랭킹']], (value) => {
      state.period = value;
      state.genre = new Set(); // 기간이 바뀌면 장르 목록도 달라진다
      rebuildGenreOptions();
      renderView();
    });
    const row1 = el('div', { className: 'book-toolbar' }, [
      el('label', { text: '기간', htmlFor: 'webNovelPeriod' }),
      toolbarRows.period,
      el('span', { className: 'book-toolbar-note', text: '사이트가 공개한 상위 300건 안에서 필터·정렬합니다.' })
    ]);

    // 2행: 필터
    toolbarRows.genre = MultiSelect.create({
      id: 'webNovelGenre',
      onChange: (values) => {
        state.genre = values;
        renderView();
      }
    });
    toolbarRows.status = MultiSelect.create({
      id: 'webNovelStatus',
      options: ['연재 중', '완결', '단편', '휴재'].map((value) => ({ value, label: value })),
      onChange: (values) => {
        state.status = values;
        renderView();
      }
    });
    toolbarRows.mediaMix = makeSelect('webNovelMediaMix', [['all', '전체'], ['none', '서적화·미디어믹스 표기 없는 작품만'], ['has', '표기 있는 작품만']], (value) => {
      state.mediaMix = value;
      renderView();
    });
    toolbarRows.query = el('input', { type: 'search', id: 'webNovelQuery', placeholder: '제목·작가·태그 검색', className: 'book-min-input webnovel-query' });
    let queryTimer = null;
    toolbarRows.query.addEventListener('input', () => {
      clearTimeout(queryTimer);
      queryTimer = setTimeout(() => {
        state.query = toolbarRows.query.value;
        renderView();
      }, 250);
    });
    toolbarRows.minPeriod = makeNumberInput('webNovelMinPeriod', '예: 5000', (value) => {
      state.min.periodPoint = value;
      renderView();
    });
    toolbarRows.minTotal = makeNumberInput('webNovelMinTotal', '예: 10000', (value) => {
      state.min.totalPoint = value;
      renderView();
    });
    toolbarRows.periodLabel = el('label', { htmlFor: 'webNovelMinPeriod', text: '주간 포인트 ≥' });
    toolbarRows.totalLabel = el('label', { htmlFor: 'webNovelMinTotal', text: '누적 ≥' });
    toolbarRows.periodGroup = el('span', { className: 'webnovel-inline-group' }, [toolbarRows.periodLabel, toolbarRows.minPeriod]);
    const resetFilter = el('button', { type: 'button', className: 'book-small-btn', text: '필터 초기화' });
    resetFilter.addEventListener('click', resetFilters);
    const row2 = el('div', { className: 'book-toolbar' }, [
      el('span', { className: 'book-toolbar-title', text: '필터' }),
      el('span', { text: '장르' }), toolbarRows.genre.element,
      el('span', { text: '상태' }), toolbarRows.status.element,
      el('label', { text: '서적화', htmlFor: 'webNovelMediaMix' }), toolbarRows.mediaMix,
      toolbarRows.query,
      toolbarRows.periodGroup,
      toolbarRows.totalLabel, toolbarRows.minTotal,
      resetFilter
    ]);

    // 3행: 1~3차 정렬
    toolbarRows.sortSelects = [];
    toolbarRows.sortDirs = [];
    const row3 = el('div', { className: 'book-toolbar' }, [el('span', { className: 'book-toolbar-title', text: '정렬' })]);
    for (let level = 0; level < MAX_SORT_LEVELS; level += 1) {
      const select = el('select', { id: `webNovelSort${level + 1}` });
      select.addEventListener('change', () => {
        readSortControls();
        syncSortControls();
        renderView();
      });
      const dirButton = el('button', { type: 'button', className: 'book-small-btn', disabled: true, text: '↓ 내림차순' });
      dirButton.addEventListener('click', () => {
        const sort = state.sorts[level];
        if (!sort) return;
        sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
        syncSortControls();
        renderView();
      });
      toolbarRows.sortSelects.push(select);
      toolbarRows.sortDirs.push(dirButton);
      row3.appendChild(el('label', { text: `${level + 1}차`, htmlFor: select.id }));
      row3.appendChild(select);
      row3.appendChild(dirButton);
    }
    const resetSort = el('button', { type: 'button', className: 'book-small-btn', text: '정렬 초기화' });
    resetSort.addEventListener('click', () => {
      state.sorts = [];
      syncSortControls();
      renderView();
    });
    row3.appendChild(resetSort);

    [row1, row2, row3].forEach((row) => toolbarEl.appendChild(row));
  }

  function rebuildGenreOptions() {
    const items = currentRanking() || [];
    const counts = new Map();
    items.forEach((item) => counts.set(item.genre, (counts.get(item.genre) || 0) + 1));
    // 장르 목록은 많이 나온 순으로 보여주고, 옵션이 바뀌면서 사라진 장르는 선택에서 빠진다.
    toolbarRows.genre.setOptions(
      [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([genre, count]) => ({ value: genre, label: `${genre} (${count})` }))
    );
    state.genre = toolbarRows.genre.getValues();
  }

  function syncSortControls() {
    const fields = sortFieldsForSite();
    state.sorts = state.sorts.filter((sort) => fields.includes(sort.field));
    toolbarRows.sortSelects.forEach((select, level) => {
      select.replaceChildren(el('option', { value: '', text: level === 0 ? '(사이트 순위 순)' : '(없음)' }));
      fields.forEach((field) => select.appendChild(el('option', { value: field, text: SORT_FIELDS[field].label() })));
      select.value = state.sorts[level]?.field || '';
    });
    toolbarRows.sortDirs.forEach((button, level) => {
      const sort = state.sorts[level];
      button.disabled = !sort;
      button.textContent = sort?.dir === 'asc' ? '↑ 오름차순' : '↓ 내림차순';
    });
    toolbarRows.periodLabel.textContent = `${PERIOD_LABELS[state.period]} 포인트 ≥`;
    toolbarRows.totalLabel.textContent = state.site === 'NAROU' ? '누적 포인트 ≥' : '누적 별점 ≥';
    toolbarRows.periodGroup.hidden = state.site !== 'NAROU';
  }

  function readSortControls() {
    const next = [];
    toolbarRows.sortSelects.forEach((select, level) => {
      const field = select.value;
      if (!field || next.some((sort) => sort.field === field)) return;
      const previous = state.sorts[level];
      next.push({ field, dir: previous && previous.field === field ? previous.dir : SORT_FIELDS[field].defaultDir });
    });
    state.sorts = next.slice(0, MAX_SORT_LEVELS);
  }

  function resetFilters() {
    state.genre = new Set();
    state.status = new Set();
    state.mediaMix = 'all';
    state.query = '';
    state.min = { periodPoint: null, totalPoint: null };
    toolbarRows.genre.reset();
    toolbarRows.status.reset();
    toolbarRows.mediaMix.value = 'all';
    toolbarRows.query.value = '';
    toolbarRows.minPeriod.value = '';
    toolbarRows.minTotal.value = '';
    rebuildGenreOptions();
    renderView();
  }

  // ---- 표 ----------------------------------------------------------------------

  function visibleColumns() {
    return COLUMNS.filter((column) => !column.sites || column.sites.includes(state.site));
  }

  function createHeaderCell(column) {
    const th = document.createElement('th');
    th.textContent = typeof column.label === 'function' ? column.label() : column.label;
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
    th.addEventListener('click', () => handleHeaderSort(column.sortField));
    return th;
  }

  function renderTable(items) {
    tableContainer.replaceChildren();
    const columns = visibleColumns();
    const titleWidth = getTitleColumnWidth() - RATING_COLUMN_CELL_PADDING;

    const headerRow = document.createElement('tr');
    columns.forEach((column) => headerRow.appendChild(createHeaderCell(column)));
    const thead = document.createElement('thead');
    thead.appendChild(headerRow);

    const tbody = document.createElement('tbody');
    items.forEach((item) => {
      const tr = document.createElement('tr');
      columns.forEach((column) => tr.appendChild(column.cell(item, titleWidth)));
      tbody.appendChild(tr);
    });

    const table = document.createElement('table');
    table.className = 'data-table';
    table.appendChild(thead);
    table.appendChild(tbody);
    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';
    wrapper.appendChild(table);
    tableContainer.appendChild(wrapper);
  }

  function renderFreshness(data) {
    const generated = Date.parse(data?.generatedAt);
    if (!Number.isFinite(generated)) {
      freshnessEl.className = 'source-status source-status-error';
      freshnessEl.textContent = '데이터 기준일 알 수 없음';
      return;
    }
    const ageDays = (Date.now() - generated) / (24 * 60 * 60 * 1000);
    const jst = new Date(generated + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    freshnessEl.textContent = ageDays > STALE_AFTER_DAYS ? `데이터 기준 ${jst} (오래됨)` : `데이터 기준 ${jst}`;
    freshnessEl.className = `source-status ${ageDays > STALE_AFTER_DAYS ? 'source-status-mock' : 'source-status-live'}`;
  }

  function renderView() {
    const data = window.WEBNOVEL_RANKING;
    titleEl.textContent = `${SITE_LABELS[state.site]} ${PERIOD_LABELS[state.period]} 인기 랭킹`;
    emptyEl.classList.add('hidden');

    const ranking = currentRanking();
    if (!data || !ranking) {
      tableContainer.replaceChildren();
      summaryEl.textContent = '';
      freshnessEl.className = 'source-status source-status-error';
      freshnessEl.textContent = '데이터 없음';
      emptyEl.textContent = '랭킹 데이터가 없습니다. npm run build:webnovel 로 만들거나 다음 배포를 기다려 주세요.';
      emptyEl.classList.remove('hidden');
      return;
    }
    renderFreshness(data);

    const shown = applySorts(applyFilters(ranking));
    const filterParts = [];
    if (state.genre.size > 0) filterParts.push([...state.genre].join(' / '));
    if (state.status.size > 0) filterParts.push([...state.status].join(' / '));
    if (state.mediaMix === 'none') filterParts.push('서적화 표기 없음');
    if (state.mediaMix === 'has') filterParts.push('서적화 표기 있음');
    if (state.query.trim()) filterParts.push(`검색 "${state.query.trim()}"`);
    Object.entries(state.min).forEach(([field, min]) => {
      if (min !== null && SORT_FIELDS[field].sites.includes(state.site)) filterParts.push(`${SORT_FIELDS[field].label()} ≥ ${min.toLocaleString('ko-KR')}`);
    });
    summaryEl.textContent = `상위 ${ranking.length}건 중 ${shown.length}건 표시`
      + (filterParts.length > 0 ? ` · 필터: ${filterParts.join(', ')}` : '')
      + ` · 정렬: ${describeSorts()} · 순위 번호는 사이트 순위입니다.`;

    if (shown.length === 0) {
      tableContainer.replaceChildren();
      emptyEl.textContent = '조건에 맞는 작품이 없습니다. 필터를 줄여 보세요.';
      emptyEl.classList.remove('hidden');
      return;
    }
    renderTable(shown);
  }

  function showSite(site) {
    state.site = site;
    state.genre = new Set();
    toolbarRows.genre.reset();
    state.sorts = [];
    toolbarRows.mediaMix.value = state.mediaMix;
    rebuildGenreOptions();
    syncSortControls();
    renderView();
  }

  buildToolbar();
  syncSortControls();

  document.addEventListener('books:tab', (event) => {
    const tab = event.detail?.tab;
    const isWebNovel = tab === 'NAROU' || tab === 'KAKUYOMU';
    panel.classList.toggle('hidden', !isWebNovel);
    if (isWebNovel) showSite(tab);
  });
})();
