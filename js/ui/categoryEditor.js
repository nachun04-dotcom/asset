// 账户（类别）管理：编辑面板（改名 / 负债 / 启用 / 图标 / 删除）、拖拽排序、分组图标选择器。设置页和「记一笔」共用。
import { h, icon } from './dom.js';
import { button, confirmDialog, openSheet, switchControl, toast } from './components.js';
import { catIcon, catSlotClass, iconGlyph } from './fmt.js';
import { ICONSET, ICON_GROUPS } from './iconset.js';
import { CATEGORY_ICON_KEYS, cleanName, iconKeyFor, sortedCategories } from '../core/model.js';
import { toggleDebt } from './categoryActions.js';

const CLASSIC_LABELS = { wallet: '钱包', chat: '聊天', card: '银行卡', bank: '银行', cash: '现金', coin: '硬币', bitcoin: '数字货币', safe: '保险柜', trend: '走势', chart: '柱状图', sprout: '理财', gem: '贵金属', box: '货物', cart: '购物', briefcase: '公文包', home: '房产', car: '汽车', globe: '海外', receipt: '账单', shield: '保障', heart: '健康', star: '星标', pie: '组合', phone: '手机' };
const labelOf = (k) => ICONSET[k]?.label ?? CLASSIC_LABELS[k] ?? k;

/* ------------------------------ 拖拽排序 ------------------------------ */

/**
 * 让列表里的行可以按住把手上下拖动排序（手指、鼠标都行）。
 * 每行需要 data-id，把手需要 .drag-handle；松手后调用 onSort(新的 id 顺序)。
 * 拖动时其他行平滑让位；拖到列表边缘时，所在的滚动区域会自动滚动。
 */
export function makeSortable(list, onSort) {
  let g = null;
  const rows = () => [...list.children].filter((el) => el.dataset.id);
  const scroller = () => list.closest('.sheet-body') ?? document.scrollingElement;

  const move = (y) => {
    if (!g) return;
    const sc = scroller();
    const vr = sc === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : sc.getBoundingClientRect();
    if (y < vr.top + 56) sc.scrollTop -= 8;
    else if (y > vr.bottom - 56) sc.scrollTop += 8;
    const dy = y - g.y0 + (sc.scrollTop - g.scroll0);
    g.el.style.transform = `translate3d(0, ${dy}px, 0)`;
    // 根据拖动行的中心点，算出它现在应该落在第几个位置
    const mid = g.mid0 + dy;
    let to = g.from;
    g.items.forEach((it, i) => {
      if (i === g.from) return;
      if (i > g.from && mid > it.mid) to = Math.max(to, i);
      if (i < g.from && mid < it.mid) to = Math.min(to, i);
    });
    g.to = to;
    g.items.forEach((it, i) => {
      if (i === g.from) return;
      let shift = 0;
      if (g.from < to && i > g.from && i <= to) shift = -g.h;
      if (g.from > to && i >= to && i < g.from) shift = g.h;
      it.el.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : '';
    });
  };

  const end = () => {
    if (!g) return;
    const { from, to, items, el } = g;
    g = null;
    list.classList.remove('sorting');
    el.classList.remove('dragging');
    for (const it of items) it.el.style.transform = '';
    if (to !== from) {
      const ids = items.map((it) => it.el.dataset.id);
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved);
      const ref = items[to].el;
      list.insertBefore(el, to > from ? ref.nextSibling : ref);
      navigator.vibrate?.(8);
      onSort(ids);
    }
  };

  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle || !list.contains(handle) || g) return;
    const el = handle.closest('[data-id]');
    const items = rows().map((r) => {
      const b = r.getBoundingClientRect();
      return { el: r, mid: b.top + b.height / 2 };
    });
    const from = items.findIndex((it) => it.el === el);
    if (from < 0) return;
    e.preventDefault();
    try {
      handle.setPointerCapture?.(e.pointerId); // 个别浏览器在这里会抛错，失败也不影响拖动
    } catch {
      /* 忽略 */
    }
    const b = el.getBoundingClientRect();
    g = { el, items, from, to: from, y0: e.clientY, h: b.height, mid0: b.top + b.height / 2, scroll0: scroller().scrollTop };
    list.classList.add('sorting');
    el.classList.add('dragging');
  });
  list.addEventListener('pointermove', (e) => {
    if (!g) return;
    e.preventDefault();
    move(e.clientY);
  });
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
}

export const dragHandle = (name) => h('span', { class: 'drag-handle', role: 'button', 'aria-label': `按住拖动「${name}」调整顺序`, title: '按住拖动排序' }, icon('grip', { size: 20, stroke: 1.8 }));

/** 拖拽排序抽屉：「记一笔」里用，也可从别处打开。 */
export function openReorderSheet(store, { onDone } = {}) {
  const list = h('div', { class: 'list sort-list' });
  const draw = () => {
    list.replaceChildren(
      ...sortedCategories(store.state.categories).map((c) =>
        h('div', { class: ['sort-row', !c.enabled && 'off'], 'data-id': c.id }, catIcon(c, store.state.categories, { size: 32 }), h('span', { class: 'cat-nm' }, c.name, c.debt ? h('span', { class: 'tag debt' }, '负债') : null, c.enabled ? null : h('span', { class: 'tag' }, '已停用')), dragHandle(c.name)),
      ),
    );
  };
  draw();
  makeSortable(list, async (ids) => {
    const byId = new Map(store.state.categories.map((c) => [c.id, c]));
    const r = await store.saveCategories(ids.map((id) => byId.get(id)));
    if (!r.ok) {
      toast(r.message);
      draw();
    }
  });
  const sheet = openSheet({
    title: '调整顺序',
    auto: true,
    body: h('div', { class: 'stack' }, h('p', { class: 'hint' }, '按住右边的 ≡ 上下拖动，松手即保存。首页、记一笔都按这个顺序显示。'), list),
    footer: button('完成', () => sheet.close(), { block: true }),
    onClose: () => onDone?.(),
  });
  return sheet;
}

/* ------------------------------ 图标选择器 ------------------------------ */

function iconPicker(cat, categories, nowKey, onChoose) {
  const tabs = [...ICON_GROUPS.filter(([, keys]) => keys.length), ['经典', CATEGORY_ICON_KEYS]];
  // 默认打开当前图标所在的那一组
  let active = Math.max(0, tabs.findIndex(([, keys]) => keys.includes(nowKey)));
  const bar = h('div', { class: 'ico-tabs', role: 'tablist' });
  const grid = h('div', { class: 'ico-grid', role: 'listbox', 'aria-label': '图标' });
  const draw = () => {
    bar.replaceChildren(...tabs.map(([name], i) => h('button', { type: 'button', role: 'tab', class: ['ico-tab', i === active && 'on'], 'aria-selected': String(i === active), onClick: () => { active = i; draw(); } }, name)));
    grid.replaceChildren(
      ...tabs[active][1].map((k) =>
        h('button', { type: 'button', role: 'option', class: ['ico-opt', k === nowKey && 'on'], 'aria-selected': String(k === nowKey), 'aria-label': labelOf(k), onClick: () => onChoose(k) }, h('span', { class: `cat-ico ${catSlotClass(cat)}`, style: '--sz:46px' }, iconGlyph(k, { size: 25, stroke: 1.6 })), h('span', { class: 'ico-label' }, labelOf(k))),
      ),
    );
  };
  draw();
  return h('div', { class: 'ico-picker' }, bar, grid);
}

/* ------------------------------ 删除 ------------------------------ */

/** 删除一个账户；已有金额时说清楚会删掉什么，并建议「停用」作为替代。返回是否已删除。 */
export async function confirmDeleteCategory(store, id) {
  const cat = store.state.categories.find((c) => c.id === id);
  if (!cat) return false;
  const n = store.categoryValueCount(id);
  const ok = await confirmDialog({
    title: `删除「${cat.name}」？`,
    message: n
      ? `它在 ${n} 条记录里有金额。删除后这些金额会一起删掉，相关记录的合计会变化，而且无法撤销。\n\n只是以后不想再记它的话，建议关掉「启用」就好（历史数据保留）。删除前也可以先去「设置 → 导入与备份」导出一份备份。`
      : '它在所有记录里都没有金额，可以放心删除。',
    confirmText: n ? `删除，并移除 ${n} 笔金额` : '删除',
    danger: true,
  });
  if (!ok) return false;
  const r = await store.deleteCategory(id, { withRecords: true });
  if (!r.ok) {
    toast(r.message);
    return false;
  }
  toast(n ? `已删除「${cat.name}」，并从 ${r.records} 条记录中移除` : `已删除「${cat.name}」`);
  return true;
}

/* ------------------------------ 编辑面板 ------------------------------ */

/** 编辑一个账户：名称、负债、启用、图标、删除，都在这一个面板里。 */
export function openCategoryEditor(store, id, { onChange } = {}) {
  const sheet = openSheet({ title: '编辑账户', auto: true, body: null, onClose: () => onChange?.() });
  const current = () => sortedCategories(store.state.categories);
  const draw = () => {
    const cat = store.state.categories.find((c) => c.id === id);
    if (!cat) return sheet.close();
    const nameOf = () => store.state.categories.find((c) => c.id === id)?.name ?? '';
    // 名称：旁边有明确的「保存」，改了才能点；直接点别处也会自动保存
    const name = h('input', { type: 'text', value: cat.name, maxlength: 20, 'aria-label': '账户名称', enterkeyhint: 'done' });
    const saveBtn = button('保存', () => saveName(), { sm: true, disabled: true });
    const saveName = async () => {
      const n = cleanName(name.value);
      if (!n || n === nameOf()) {
        name.value = nameOf();
        saveBtn.disabled = true;
        return;
      }
      const r = await store.saveCategories(current().map((c) => (c.id === id ? { ...c, name: n } : c)));
      if (!r.ok) {
        toast(r.message);
        name.value = nameOf();
      } else toast(`已改名为「${n}」`);
      saveBtn.disabled = true;
    };
    name.addEventListener('input', () => {
      const n = cleanName(name.value);
      saveBtn.disabled = !n || n === nameOf();
    });
    name.addEventListener('change', saveName);
    name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur());

    const debtSw = switchControl(!!cat.debt, async (on) => {
      await toggleDebt(store, id, on);
      draw();
    }, '负债');
    const enableSw = switchControl(cat.enabled, async (on) => {
      const r = await store.saveCategories(current().map((c) => (c.id === id ? { ...c, enabled: on } : c)));
      if (!r.ok) toast(r.message);
      else toast(on ? `「${cat.name}」已启用` : `「${cat.name}」已停用：首页和记一笔不再显示，历史数据保留`);
      draw();
    }, '启用');

    const choose = async (key) => {
      const r = await store.saveCategories(current().map((c) => (c.id === id ? { ...c, icon: key ?? undefined } : c)));
      if (!r.ok) toast(r.message);
      draw();
    };
    const nowKey = iconKeyFor(cat, store.state.categories);

    sheet.body.replaceChildren(
      h(
        'div',
        { class: 'stack edit-cat' },
        h('div', { class: 'edit-hero' }, catIcon(cat, store.state.categories, { size: 56 }), h('div', { class: 'grow' }, h('div', { class: 'eh-name' }, cat.name), h('div', { class: 'eh-sub' }, cat.debt ? '负债账户' : '资产账户', cat.enabled ? '' : ' · 已停用'))),
        h('div', { class: 'field' }, h('span', { class: 'label' }, '名称'), h('div', { class: 'row' }, h('div', { class: 'grow' }, name), saveBtn), h('span', { class: 'hint' }, '改名后，以前的记录也会显示新名字，金额不受影响。')),
        h(
          'div',
          { class: 'list' },
          h('div', { class: 'setting' }, h('div', { class: 'grow' }, h('div', {}, '启用'), h('div', { class: 'desc' }, '关掉后，首页和记一笔都不再显示它；历史数据保留，随时可以再打开')), enableSw),
          h('div', { class: 'setting' }, h('div', { class: 'grow' }, h('div', {}, '这是负债'), h('div', { class: 'desc' }, '信用卡、花呗、贷款等：记账时填欠款金额（正数），自动从资产里减去')), debtSw),
        ),
        h('div', { class: 'field' }, h('span', { class: 'label' }, '图标'), iconPicker(cat, store.state.categories, nowKey, choose), cat.icon ? button('恢复默认图标', () => choose(null), { kind: 'ghost', sm: true }) : null),
        button('删除这个账户', async () => {
          if (await confirmDeleteCategory(store, id)) await sheet.close();
        }, { kind: 'danger', block: true, iconName: 'trash' }),
      ),
    );
  };
  draw();
  return sheet;
}

/* ------------------------------ 设置页里的账户列表 ------------------------------ */

/** 设置页用：每行「图标 + 完整名称（点开编辑） + 拖动把手」，拖动即保存顺序。 */
export function categoryList(store) {
  const list = h('div', { class: 'list sort-list' });
  for (const cat of sortedCategories(store.state.categories)) {
    const open = h('button', { type: 'button', class: 'cat-open', 'aria-label': `编辑「${cat.name}」` }, catIcon(cat, store.state.categories, { size: 36 }), h('span', { class: 'cat-nm' }, cat.name, cat.debt ? h('span', { class: 'tag debt' }, '负债') : null, cat.enabled ? null : h('span', { class: 'tag' }, '已停用')), icon('chevronR', { size: 16 }));
    open.addEventListener('click', () => openCategoryEditor(store, cat.id));
    list.appendChild(h('div', { class: ['cat-item', !cat.enabled && 'off', cat.group && 'sub'], 'data-id': cat.id }, open, dragHandle(cat.name)));
  }
  makeSortable(list, async (ids) => {
    const byId = new Map(store.state.categories.map((c) => [c.id, c]));
    const r = await store.saveCategories(ids.map((x) => byId.get(x)));
    if (!r.ok) toast(r.message);
  });
  return list;
}
