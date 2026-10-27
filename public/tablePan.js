// 표(.table-wrapper)를 마우스로 잡고 끌어서 좌우·상하로 이동한다(드래그 이동). 스크롤바를 찾아 누르지 않아도
// 표를 끌기만 하면 되고, 가로 휠/트랙패드와 Shift+휠은 브라우저가 원래 지원하므로 건드리지 않는다.
//
// 동작 규칙
// - 표 안의 셀에서 시작한 왼쪽 버튼 드래그만 이동으로 본다. 5px 미만 움직임은 클릭으로 둔다(머리글 정렬,
//   더보기 버튼 등이 그대로 동작).
// - 링크/버튼/입력/커버 이미지, 그리고 타이틀 칸(.title-scroll)에서 시작한 드래그는 이동하지 않는다.
//   타이틀 칸은 텍스트를 드래그해 선택·복사할 수 있어야 하기 때문이다(그 외 칸은 텍스트 선택 대신 이동).
// - 표 영역 자체(스크롤바, 표 밖 빈 공간)를 누른 경우는 건드리지 않아 스크롤바 드래그가 그대로 된다.
// - 실제로 끈 뒤 마우스를 놓을 때 생기는 클릭은 막아서, 끌다가 머리글 정렬이나 이미지 팝업이 열리지 않게 한다.
(function () {
  'use strict';

  const DRAG_THRESHOLD_PX = 5;
  const IGNORED_SELECTOR = 'a, button, input, select, textarea, label, summary, .title-scroll, .cover-thumb';

  let drag = null;
  let suppressNextClick = false;

  document.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    const wrapper = target.closest('.table-wrapper');
    if (!wrapper || target === wrapper) return; // 스크롤바/빈 공간
    if (target.closest(IGNORED_SELECTOR)) return;

    event.preventDefault(); // 이동으로 시작하는 드래그는 텍스트 선택이 시작되지 않게 한다(클릭은 그대로 발생)
    drag = {
      wrapper,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: wrapper.scrollLeft,
      startTop: wrapper.scrollTop,
      moved: false
    };
  });

  document.addEventListener('mousemove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (!drag.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      drag.wrapper.classList.add('is-dragging'); // 끄는 동안 텍스트 선택을 막고 커서를 바꾼다
    }

    drag.wrapper.scrollLeft = drag.startLeft - dx;
    drag.wrapper.scrollTop = drag.startTop - dy;
    event.preventDefault();
  });

  function endDrag() {
    if (!drag) return;
    if (drag.moved) {
      drag.wrapper.classList.remove('is-dragging');
      suppressNextClick = true;
      setTimeout(() => {
        suppressNextClick = false;
      }, 0);
    }
    drag = null;
  }

  document.addEventListener('mouseup', endDrag);
  window.addEventListener('blur', endDrag);

  // 드래그를 마치며 발생하는 click은 막는다(캡처 단계에서 가로챈다).
  document.addEventListener(
    'click',
    (event) => {
      if (!suppressNextClick) return;
      event.stopPropagation();
      event.preventDefault();
    },
    true
  );
})();
