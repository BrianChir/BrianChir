document.addEventListener('DOMContentLoaded', () => {
  const tabBar = new mdc.tabBar.MDCTabBar(document.querySelector('.mdc-tab-bar'));
  const panes = document.querySelectorAll('.pane');
  const textField = new mdc.textField.MDCTextField(document.querySelector('.mdc-text-field'));
  const submitBtn = document.getElementById('submit-btn');
  let activeCategory = 'liked';

  tabBar.listen('MDCTabBar:activated', (event) => {
    activeCategory = event.detail.tab.getAttribute('data-category');
    panes.forEach(pane => {
      pane.classList.toggle('active', pane.getAttribute('data-category') === activeCategory);
    });
  });

  submitBtn.addEventListener('click', () => {
    const input = textField.value.trim();
    if (!input) return;
    const list = document.querySelector(`.pane[data-category="${activeCategory}"] .items`);
    const li = document.createElement('li');
    li.className = 'mdc-list-item';
    li.textContent = input;
    list.appendChild(li);
    textField.value = '';
    updateSummary();
  });

  function updateSummary() {
    ['liked', 'lacked', 'learned', 'longed'].forEach(cat => {
      const items = Array.from(document.querySelectorAll(`.pane[data-category="${cat}"] .mdc-list-item`))
        .map(li => li.textContent);
      const block = document.getElementById(`summary-${cat}`);
      block.innerHTML = `\n        <h3 class="mdc-typography--subtitle1">${cat.charAt(0).toUpperCase() + cat.slice(1)}</h3>\n        <ul class="mdc-list mdc-list--dense">\n          ${items.map(item => `<li class="mdc-list-item">${item}</li>`).join('')}\n        </ul>`;
    });
  }

  updateSummary();
});
