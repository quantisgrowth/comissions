// Responsive presentation only: permissions and financial rules remain in the existing modules.
(() => {
  const narrow = matchMedia('(max-width: 900px)');
  const sidebar = document.querySelector('body > aside');
  const main = document.querySelector('body > main');
  const modal = document.getElementById('modal');
  if (!sidebar || !main || !modal) return;
  sidebar.id = 'appSidebar';
  sidebar.setAttribute('aria-label', 'Menu principal');
  const top = document.createElement('div');
  top.className = 'mobile-app-bar';
  top.innerHTML = '<button type="button" class="mobile-menu-toggle" aria-label="Abrir menu" aria-controls="appSidebar" aria-expanded="false">☰</button><span class="brand">Comissions<span>↗</span></span><span class="mobile-page-label"></span>';
  document.body.prepend(top);
  const shade = document.createElement('button');
  shade.type = 'button'; shade.className = 'mobile-menu-shade';
  shade.setAttribute('aria-label', 'Fechar menu'); shade.hidden = true;
  document.body.append(shade);
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'mobile-sidebar-close';
  close.setAttribute('aria-label', 'Fechar menu'); close.textContent = '×';
  sidebar.prepend(close);
  const bottom = document.createElement('nav');
  bottom.className = 'mobile-bottom-nav'; bottom.setAttribute('aria-label', 'Atalhos principais');
  document.body.append(bottom);
  const toggle = top.querySelector('button');
  let previousFocus, scheduled = false, filtersExpanded = false;
  function setMenu(open) {
    open = !!open && narrow.matches;
    if (open) previousFocus = document.activeElement;
    document.body.classList.toggle('mobile-menu-open', open);
    toggle.setAttribute('aria-expanded', String(open)); shade.hidden = !open;
    if (narrow.matches) sidebar.inert = !open;
    main.inert = open; bottom.inert = open;
    if (open) close.focus();
    else if (previousFocus?.isConnected) { previousFocus.focus(); previousFocus = null; }
  }
  toggle.onclick = () => setMenu(!document.body.classList.contains('mobile-menu-open'));
  shade.onclick = close.onclick = () => setMenu(false);
  sidebar.addEventListener('click', e => {
    if (e.target.closest('#nav button, footer button')) setMenu(false);
  }, true);
  document.addEventListener('keydown', e => {
    if (!document.body.classList.contains('mobile-menu-open')) return;
    if (e.key === 'Escape') { e.preventDefault(); setMenu(false); }
    if (e.key === 'Tab') {
      const items = [...sidebar.querySelectorAll('button,select,a[href],input')].filter(el => !el.disabled && el.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  });
  function labelTables(root) {
    for (const table of root.querySelectorAll('table')) {
      const heading = table.querySelector('thead tr') || table.querySelector('tr:has(th)');
      if (!heading) continue;
      const labels = [...heading.cells].map(cell => cell.textContent.trim());
      table.classList.add('mobile-card-table'); table.setAttribute('role', 'table');
      for (const row of table.rows) {
        row.setAttribute('role', 'row');
        if (row === heading) continue;
        for (let n = 0; n < row.cells.length; n++) {
          const cell = row.cells[n]; cell.setAttribute('role', 'cell');
          if (cell.colSpan > 1) { cell.classList.add('mobile-full-cell'); continue; }
          cell.dataset.label = labels[n] || '';
        }
      }
    }
  }
  function refresh() {
    scheduled = false;
    const source = [...document.querySelectorAll('#nav > button')];
    const selected = source.find(b => b.classList.contains('active'));
    top.querySelector('.mobile-page-label').textContent = selected?.textContent || '';
    const signature = source.map(b => b.textContent + ':' + b.className).join('|');
    if (bottom.dataset.signature !== signature) {
      bottom.dataset.signature = signature; bottom.replaceChildren();
      const priorities = [/painel|visão geral/i, /vendas|contratos/i, /comiss/i];
      const shortcuts = priorities.map(re => source.find(b => re.test(b.textContent))).filter(Boolean);
      for (const item of [...new Set(shortcuts)]) {
        const b = document.createElement('button'); b.type = 'button';
        b.textContent = /painel|visão/i.test(item.textContent) ? 'Painel' : /vendas|contratos/i.test(item.textContent) ? 'Vendas' : 'Comissões';
        b.className = item.classList.contains('active') ? 'active' : '';
        if (b.className) b.setAttribute('aria-current', 'page');
        b.onclick = () => { item.click(); window.scrollTo({top: 0, behavior: 'instant'}); };
        bottom.append(b);
      }
      const more = document.createElement('button'); more.type = 'button'; more.textContent = 'Menu';
      more.setAttribute('aria-controls', 'appSidebar'); more.onclick = () => setMenu(true); bottom.append(more);
    }
    labelTables(main); labelTables(modal);
    for (const filters of main.querySelectorAll('.commission-filter-bar')) {
      if (filters.parentElement.classList.contains('mobile-filter-drawer')) continue;
      const details = document.createElement('details'); details.className = 'mobile-filter-drawer';
      details.open = !narrow.matches || filtersExpanded;
      details.addEventListener('toggle', () => { if (narrow.matches) filtersExpanded = details.open; });
      const summary = document.createElement('summary'); summary.textContent = 'Filtrar comissões' + ([...filters.querySelectorAll('select')].filter(s => s.value !== 'all').length ? ' · filtros ativos' : '');
      filters.before(details); details.append(summary, filters);
    }
    if (modal.open && !modal.querySelector('.mobile-dialog-bar')) {
      const bar = document.createElement('div'); bar.className = 'mobile-dialog-bar';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn secondary';
      b.textContent = '← Voltar'; b.setAttribute('aria-label', 'Fechar formulário e voltar');
      b.onclick = () => { if (modal.querySelector('form[data-submitting]')) return; modal.close(); }; bar.append(b); modal.prepend(bar);
    }
    for (const input of document.querySelectorAll('input[type=number]')) {
      if (!input.hasAttribute('inputmode')) input.inputMode = input.step === '1' ? 'numeric' : 'decimal';
    }
  }
  const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(refresh); } };
  new MutationObserver(schedule).observe(main, {childList:true, subtree:true});
  new MutationObserver(schedule).observe(sidebar, {childList:true, subtree:true});
  new MutationObserver(schedule).observe(modal, {childList:true, subtree:true, attributes:true, attributeFilter:['open']});
  narrow.addEventListener('change', () => { setMenu(false); sidebar.inert = narrow.matches;
    for (const details of main.querySelectorAll('.mobile-filter-drawer')) details.open = !narrow.matches || filtersExpanded;
  });
  sidebar.inert = narrow.matches;
  function fitKeyboard() { document.documentElement.style.setProperty('--mobile-available-height', Math.round(Math.min(window.innerHeight, window.visualViewport?.height || window.innerHeight)) + 'px'); }
  window.visualViewport?.addEventListener('resize', fitKeyboard);
  window.addEventListener('resize', fitKeyboard); fitKeyboard();
  refresh();
})();
