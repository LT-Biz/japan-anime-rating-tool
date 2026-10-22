// "일본 만화·소설 순위 정보" 화면. 애니메이션 방영 정보와 별개의 화면으로, 아직 애니화되지 않은 인기 원작을
// 찾는 IP 발굴용이다. 데이터는 AniListClient.getBookRanking(AniList 지표: 인기도/급상승/평점)만 쓴다.
// 주의: 이 순위의 인기도는 AniList 이용자의 목록 등록 수이지 일본 서점 판매량이 아니다.
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

  const modeButtons = document.querySelectorAll('.mode-btn');
  const animeMode = document.getElementById('animeMode');
  const booksMode = document.getElementById('booksMode');
  const bookTypeButtons = document.querySelectorAll('.book-type-btn');
  const bookTitle = document.getElementById('bookTitle');
  const bookSourceStatus = document.getElementById('bookSourceStatus');
  const bookSortSelect = document.getElementById('bookSortSelect');
  const bookOnlyUnadapted = document.getElementById('bookOnlyUnadapted');
  const bookSummary = document.getElementById('bookSummary');
  const bookLoading = document.getElementById('bookLoading');
  const bookTableContainer = document.getElementById('bookTableContainer');
  const bookEmptyMessage = document.getElementById('bookEmptyMessage');

  setupInfoPopup(document.getElementById('bookInfoBtn'), document.getElementById('bookInfoPopup'));

  const state = { type: 'MANGA', sort: 'popularity', onlyUnadapted: false };
  // (종류|정렬 기준)별로 한 번 받은 결과를 재사용한다. AniList는 요청 간격 제한 때문에 한 번 받는 데
  // 약 9초 걸려서, 같은 조건으로 돌아왔을 때 다시 받지 않게 한다. 실패한 결과는 캐시하지 않는다.
  const cache = new Map();
  let renderToken = 0;
  let booksLoadedOnce = false;

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

  const BOOK_COLUMNS = [
    '순위', '표지', '타이틀 (일본어)', '타이틀 (영어)', '작가', '인기도', '평점', '즐겨찾기', '급상승',
    '연재 상태', '연재 시작', '애니화', '장르/테마', '정보 보기'
  ];

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
    BOOK_COLUMNS.forEach((label) => {
      const th = document.createElement('th');
      th.textContent = label;
      headerRow.appendChild(th);
    });
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
      bookEmptyMessage.textContent = result.errorMessage || '데이터를 불러오지 못했습니다.';
      bookEmptyMessage.classList.remove('hidden');
      return;
    }

    const shown = state.onlyUnadapted ? result.items.filter((item) => item.adaptation.state === 'none') : result.items;
    bookSummary.textContent = state.onlyUnadapted
      ? `AniList 상위 ${result.items.length}건 중 아직 애니화되지 않은 ${shown.length}건을 보여줍니다. 순위는 필터 전 기준입니다.`
      : `AniList 상위 ${result.items.length}건을 보여줍니다.`;

    if (shown.length === 0) {
      bookEmptyMessage.textContent = '조건에 맞는 작품이 없습니다.';
      bookEmptyMessage.classList.remove('hidden');
      return;
    }
    renderTable(shown);
  }

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

  // 필터는 이미 받은 목록을 거르기만 하므로 다시 요청하지 않는다(캐시 사용).
  bookOnlyUnadapted.addEventListener('change', () => {
    state.onlyUnadapted = bookOnlyUnadapted.checked;
    refresh();
  });
})();
