// 여러 개를 동시에 고를 수 있는 필터 드롭다운(체크박스 목록). 아무것도 고르지 않으면 "전체"(필터 없음)다.
// 만화·소설 순위(booksApp.js)와 웹소설 랭킹(webNovelApp.js)의 필터가 함께 쓴다.
//
// 사용: const ms = MultiSelect.create({ id, options: [{ value, label }], onChange(selectedSet) });
//       parent.appendChild(ms.element); ms.getValues() / ms.reset() / ms.setOptions(options)
(function () {
  'use strict';

  const instances = new Set();

  function create({ id, options = [], allLabel = '전체', onChange = () => {} }) {
    const details = document.createElement('details');
    details.className = 'multi-select';
    if (id) details.id = id;

    const summary = document.createElement('summary');
    details.appendChild(summary);
    const menu = document.createElement('div');
    menu.className = 'multi-select-menu';
    details.appendChild(menu);

    let currentOptions = [];
    const selected = new Set();

    function updateSummary() {
      if (selected.size === 0) {
        summary.textContent = allLabel;
      } else {
        const labels = currentOptions.filter((option) => selected.has(option.value)).map((option) => option.label);
        summary.textContent = labels.length <= 2 ? labels.join(', ') : `${labels.length}개 선택`;
      }
      details.classList.toggle('multi-select-active', selected.size > 0);
    }

    function render() {
      menu.replaceChildren();

      const clearButton = document.createElement('button');
      clearButton.type = 'button';
      clearButton.className = 'multi-select-clear';
      clearButton.textContent = `${allLabel} (선택 해제)`;
      clearButton.addEventListener('click', () => {
        if (selected.size === 0) return;
        selected.clear();
        render();
        updateSummary();
        onChange(new Set(selected));
      });
      menu.appendChild(clearButton);

      currentOptions.forEach((option) => {
        const label = document.createElement('label');
        label.className = 'multi-select-option';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selected.has(option.value);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selected.add(option.value);
          else selected.delete(option.value);
          updateSummary();
          onChange(new Set(selected));
        });
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(` ${option.label}`));
        menu.appendChild(label);
      });
    }

    const api = {
      element: details,
      getValues: () => new Set(selected),
      // 목록이 바뀌면(예: 기간을 바꿔 장르 목록이 달라짐) 사라진 값은 선택에서 뺀다. onChange는 부르지 않는다.
      setOptions(nextOptions) {
        currentOptions = nextOptions;
        const valid = new Set(nextOptions.map((option) => option.value));
        [...selected].forEach((value) => {
          if (!valid.has(value)) selected.delete(value);
        });
        render();
        updateSummary();
      },
      reset() {
        selected.clear();
        render();
        updateSummary();
      },
      close() {
        details.open = false;
      }
    };

    api.setOptions(options);
    instances.add(api);
    return api;
  }

  // 한 번에 하나의 드롭다운만 열리게 하고, 바깥을 누르거나 Esc를 누르면 닫는다.
  document.addEventListener('click', (event) => {
    instances.forEach((instance) => {
      if (!instance.element.contains(event.target)) instance.close();
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') instances.forEach((instance) => instance.close());
  });
  document.addEventListener('toggle', (event) => {
    instances.forEach((instance) => {
      if (instance.element !== event.target && event.target.open) instance.close();
    });
  }, true);

  window.MultiSelect = { create };
})();
