// 设置：备份与恢复、类别、显示、安全、存储与离线、清除数据。
import { h, icon } from '../dom.js';
import { alertDialog, button, confirmDialog, noteBox, openSheet, promptDialog, seg, switchControl, toast } from '../components.js';
import { catDot } from '../fmt.js';
import { openTemplates } from './importHub.js';
import { MIN_PASSWORD_LENGTH, createBackup, openBackup } from '../../core/backup.js';
import { exportCSV } from '../../core/csvExport.js';
import { dayDiff, todayISO } from '../../core/date.js';
import { sortedCategories } from '../../core/model.js';
import { MIME, fileStamp, isIOS, isStandalone, pickFile, saveFile } from '../../platform.js';
import { lockSupported, registerLock, verifyLock } from '../lock.js';
import { APP_NAME, APP_VERSION } from '../../version.js';

const when = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const row = (label, desc, control) => h('div', { class: 'setting' }, h('div', { class: 'grow' }, h('div', {}, label), desc ? h('div', { class: 'desc' }, desc) : null), control);
const listItem = (iconName, title, meta, onClick) =>
  h('button', { type: 'button', class: 'item', onClick }, h('span', { style: 'color:var(--pine-text);flex:none;display:grid' }, icon(iconName)), h('span', { class: 'grow' }, h('div', { class: 'title' }, title), meta ? h('div', { class: 'meta' }, meta) : null), icon('chevronR', { size: 18 }));

/* ------------------------------ 备份 / 恢复 ------------------------------ */

function openBackupExport(ctx) {
  const { store } = ctx;
  let encrypt = false;
  const pw1 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: `密码（至少 ${MIN_PASSWORD_LENGTH} 位）`, 'aria-label': '备份密码' });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: '再输入一次密码', 'aria-label': '确认备份密码' });
  const pwBox = h('div', { class: 'stack', hidden: true }, pw1, pw2, noteBox('warn', '密码只在这一次用来加密，不会保存在任何地方，也无法找回。忘记密码，这个备份文件就打不开了。'));
  const err = h('div', { class: 'err', role: 'alert' });
  const snaps = store.state.snapshots.length;
  const go = button('导出备份文件', async () => {
    err.textContent = '';
    if (encrypt) {
      if (pw1.value.length < MIN_PASSWORD_LENGTH) return void (err.textContent = `密码至少 ${MIN_PASSWORD_LENGTH} 位`);
      if (pw1.value !== pw2.value) return void (err.textContent = '两次输入的密码不一致');
    }
    go.disabled = true;
    go.textContent = encrypt ? '正在加密…' : '正在生成…';
    try {
      const text = await createBackup(store.getBackupPayload(), { password: encrypt ? pw1.value : '' });
      const r = await saveFile(`资产账本备份-${fileStamp()}${encrypt ? '-加密' : ''}.json`, text, MIME.json, { title: '资产账本备份' });
      if (r === 'cancelled') {
        go.disabled = false;
        go.textContent = '导出备份文件';
        return;
      }
      await store.markBackedUp();
      await sheet.close();
      toast(r === 'shared' ? '备份已交给分享面板，请确认存到了安全的地方' : '备份文件已下载，请把它存到手机以外的地方');
    } catch (e) {
      go.disabled = false;
      go.textContent = '导出备份文件';
      err.textContent = `导出失败：${e.message}`;
    }
  }, { block: true, iconName: 'share' });
  const sheet = openSheet({
    title: '导出完整备份',
    body: h(
      'div',
      { class: 'stack' },
      h('p', {}, `备份文件包含全部 ${snaps} 条记录、类别和显示设置，换手机或重装后可以完整恢复。`),
      seg([{ value: 'no', label: '不加密' }, { value: 'yes', label: '用密码加密' }], 'no', (v) => {
        encrypt = v === 'yes';
        pwBox.hidden = !encrypt;
      }, { block: true, label: '是否加密' }),
      pwBox,
      h('p', { class: 'hint' }, encrypt ? '' : '不加密的备份任何人拿到文件都能直接看到你的资产数字，请妥善保管；建议设置密码。'),
      err,
    ),
    footer: go,
  });
  return sheet;
}

async function startRestore(ctx) {
  const { store } = ctx;
  const file = await pickFile('.json,application/json,text/plain');
  if (!file) return;
  let text;
  try {
    text = await file.text();
  } catch {
    return alertDialog({ title: '无法读取这个文件', message: '请确认文件还在。' });
  }
  let res = await openBackup(text);
  let msg = '这个备份已加密，请输入创建备份时设置的密码。';
  while (!res.ok && (res.code === 'NEED_PASSWORD' || res.code === 'BAD_PASSWORD')) {
    if (res.code === 'BAD_PASSWORD') msg = '密码不对，或备份文件已损坏。请再试一次。';
    const pw = await promptDialog({ title: '输入备份密码', message: msg, type: 'password', confirmText: '解锁备份' });
    if (pw == null) return;
    res = await openBackup(text, { password: pw });
  }
  if (!res.ok) return alertDialog({ title: '不能恢复这个文件', message: res.message });
  confirmRestore(ctx, res);
}

function confirmRestore(ctx, res) {
  const { store } = ctx;
  const { payload, summary, meta } = res;
  const now = store.state.snapshots.length;
  const sheet = openSheet({
    title: '确认恢复',
    auto: true,
    body: h(
      'div',
      { class: 'stack' },
      noteBox('ok', ['备份文件已验证通过，内容完整。']),
      h('div', { class: 'card flat' },
        h('div', { class: 'kv' }, h('span', {}, '备份时间'), h('span', {}, when(meta.createdAt) || '未知')),
        h('div', { class: 'kv' }, h('span', {}, '记录条数'), h('span', {}, `${summary.snapshots} 条`)),
        h('div', { class: 'kv' }, h('span', {}, '日期范围'), h('span', {}, summary.from ? `${summary.from} ~ ${summary.to}` : '—')),
        h('div', { class: 'kv' }, h('span', {}, '类别'), h('span', {}, sortedCategories(payload.categories).map((c) => c.name).join('、'))),
        h('div', { class: 'kv' }, h('span', {}, '是否加密'), h('span', {}, meta.encrypted ? '是' : '否')),
      ),
      noteBox('warn', [h('b', {}, `恢复会整体替换现在的 ${now} 条记录，不是合并。`), h('div', { class: 'small' }, '恢复前，App 会先自动保存一份当前数据的安全副本；恢复后如果发现不对，可以在设置里「撤销上次恢复」。')]),
    ),
    footer: h('div', { class: 'stack', style: 'gap:8px' }, button('替换并恢复', async () => {
      const r = await store.restore(payload);
      if (!r.ok) return alertDialog({ title: '没有恢复', message: r.message });
      await sheet.close();
      toast(`已恢复 ${r.count} 条记录`, { actionText: '撤销', onAction: async () => { const u = await store.undoRestore(); toast(u.ok ? '已撤销，回到恢复前的数据' : u.message); }, ms: 9000 });
    }, { block: true }), button('取消', () => sheet.close(), { block: true, kind: 'secondary' })),
  });
}

/* ------------------------------ 页面 ------------------------------ */

export function buildSettings(ctx, opts = {}) {
  const { store } = ctx;
  const root = h('div', {}, h('div', { class: 'screen-head' }, h('h1', { class: 'screen-title' }, '设置')));
  const sections = [];

  function section({ id, title, sub, sig, build }) {
    const body = h('div', {});
    const el = h('section', { class: 'section', id: `set-${id}` }, h('h2', { class: 'section-title' }, title), sub ? h('p', { class: 'section-sub' }, sub) : null, body);
    const s = { id, el, suppress: 0, last: null, sig };
    s.draw = () => {
      s.last = sig(store.state);
      body.replaceChildren(build(s));
    };
    s.quiet = async (fn) => {
      s.suppress++;
      try {
        return await fn();
      } finally {
        s.suppress--;
        s.last = sig(store.state);
      }
    };
    sections.push(s);
    root.appendChild(el);
    s.draw();
    return s;
  }

  /* 备份与恢复 */
  section({
    id: 'backup',
    title: '备份与恢复',
    sub: '数据只保存在这台手机的浏览器存储里。换手机、卸载或清除网站数据都会丢失，请定期备份。',
    sig: (st) => `${st.meta.lastBackupAt}|${st.meta.preRestore?.savedAt}|${st.snapshots.length}`,
    build: () => {
      const { meta, settings, snapshots } = store.state;
      const last = meta.lastBackupAt;
      const days = last ? dayDiff(last.slice(0, 10), todayISO()) : null;
      const overdue = snapshots.length > 0 && (last == null || days >= settings.backupRemindDays);
      return h(
        'div',
        { class: 'stack' },
        noteBox(overdue ? 'warn' : 'info', [last ? `上次备份：${when(last)}（${days === 0 ? '今天' : `${days} 天前`}）` : '还没有备份过']),
        h(
          'div',
          { class: 'list' },
          listItem('share', '导出完整备份', '可设置密码加密；换手机时用它恢复', () => openBackupExport(ctx)),
          listItem('upload', '从备份文件恢复', '选择之前导出的 .json 备份', () => startRestore(ctx)),
          listItem('table', '导出 CSV', '用 Excel / 表格软件查看和分析（不能用来恢复）', async () => {
            if (!store.state.snapshots.length) return toast('还没有记录可导出');
            const r = await saveFile(`资产账本-导出-${fileStamp()}.csv`, exportCSV(store.state.snapshots, store.state.categories), MIME.csv, { title: '资产账本 CSV' });
            if (r !== 'cancelled') toast(r === 'shared' ? '已打开分享面板' : '已下载');
          }),
          listItem('file', '下载导入模板', 'CSV / Excel，可填写后导入', () => openTemplates(ctx)),
          meta.preRestore ? listItem('undo', '撤销上次恢复', `恢复前的数据保存于 ${when(meta.preRestore.savedAt)}，点这里换回去`, async () => {
            if (!(await confirmDialog({ title: '撤销上次恢复？', message: `会换回 ${when(meta.preRestore.savedAt)} 时的数据（${meta.preRestore.payload.snapshots.length} 条记录）。现在这份数据会被替换。`, confirmText: '撤销恢复', danger: true }))) return;
            const r = await store.undoRestore();
            toast(r.ok ? '已撤销恢复' : r.message);
          }) : null,
        ),
      );
    },
  });

  /* 类别 */
  const newName = h('input', { type: 'text', placeholder: '新类别名称，如「基金」', 'aria-label': '新类别名称', maxlength: 20 });
  section({
    id: 'categories',
    title: '资产类别',
    sub: '可以改名、调整顺序、停用。停用后历史数据保留，只是新记录里不再出现。',
    sig: (st) => JSON.stringify(sortedCategories(st.categories).map((c) => [c.id, c.enabled, c.colorSlot])) + st.snapshots.length,
    build: () => {
      // 注意：这一块在改名时不会重画（避免点击落空），所以所有操作都必须读「当下」的类别，而不是画面生成时的旧快照，
      // 否则改名之后再上移 / 停用，会把旧名字写回去。
      const current = () => sortedCategories(store.state.categories);
      const nameOf = (id) => store.state.categories.find((c) => c.id === id)?.name ?? '';
      const save = async (next, ok) => {
        const r = await store.saveCategories(next);
        if (!r.ok) {
          toast(r.message);
          sections.find((x) => x.id === 'categories').draw();
        } else if (ok) toast(ok);
        return r;
      };
      const rows = current().map((cat, i, all) => {
        const input = h('input', { type: 'text', value: cat.name, 'aria-label': `类别名称：${cat.name}`, maxlength: 20 });
        const up = h('button', { type: 'button', class: 'icon-btn', 'aria-label': `上移${cat.name}`, disabled: i === 0, style: 'width:38px' }, icon('up', { size: 18 }));
        const down = h('button', { type: 'button', class: 'icon-btn', 'aria-label': `下移${cat.name}`, disabled: i === all.length - 1, style: 'width:38px' }, icon('down', { size: 18 }));
        const del = !store.isCategoryUsed(cat.id) ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': `删除${cat.name}`, style: 'width:38px' }, icon('trash', { size: 18 })) : null;
        const sw = switchControl(cat.enabled, () => {}, `${cat.name}：启用`);
        const relabel = (name) => {
          input.setAttribute('aria-label', `类别名称：${name}`);
          up.setAttribute('aria-label', `上移${name}`);
          down.setAttribute('aria-label', `下移${name}`);
          del?.setAttribute('aria-label', `删除${name}`);
          sw.querySelector('input').setAttribute('aria-label', `${name}：启用`);
        };
        input.addEventListener('change', async () => {
          const r = await store.saveCategories(current().map((c) => (c.id === cat.id ? { ...c, name: input.value } : c)));
          if (!r.ok) {
            toast(r.message);
            input.value = nameOf(cat.id);
          } else {
            input.value = nameOf(cat.id);
            relabel(input.value);
          }
        });
        const move = (dir) => async () => {
          const next = current();
          const at = next.findIndex((c) => c.id === cat.id);
          if (at < 0 || !next[at + dir]) return;
          [next[at], next[at + dir]] = [next[at + dir], next[at]];
          await save(next);
        };
        up.addEventListener('click', move(-1));
        down.addEventListener('click', move(1));
        del?.addEventListener('click', async () => {
          if (!(await confirmDialog({ title: `删除「${nameOf(cat.id)}」？`, message: '这个类别还没有任何记录，可以安全删除。', confirmText: '删除', danger: true }))) return;
          const r = await store.deleteCategory(cat.id);
          if (!r.ok) toast(r.message);
        });
        sw.querySelector('input').addEventListener('change', async (e) => {
          const on = e.target.checked;
          await save(current().map((c) => (c.id === cat.id ? { ...c, enabled: on } : c)), on ? null : `已停用「${nameOf(cat.id)}」：历史数据保留，新记录里不再出现`);
        });
        return h('div', { class: ['cat-item', !cat.enabled && 'off', cat.group && 'sub'] }, catDot(cat), h('div', { class: 'grow' }, input), up, down, del, sw);
      });
      const add = async () => {
        const r = await store.addCategory(newName.value);
        if (!r.ok) return toast(r.message);
        newName.value = '';
        toast('已添加。新记录会包含它；以前的记录不受影响，不会变成「不完整」。');
      };
      newName.addEventListener('keydown', (e) => e.key === 'Enter' && add());
      return h('div', { class: 'stack' }, h('div', { class: 'list' }, ...rows), h('div', { class: 'row' }, h('div', { class: 'grow' }, newName), button('添加', add, { kind: 'secondary' })));
    },
  });

  /* 显示 */
  const display = section({
    id: 'display',
    title: '显示与提醒',
    sig: (st) => JSON.stringify(st.settings),
    build: (self) => {
      const set = (patch) => self.quiet(async () => {
        const r = await store.updateSettings(patch);
        if (!r.ok) toast(r.message);
        return r;
      });
      const th = h('input', { type: 'text', inputmode: 'decimal', value: String(store.state.settings.changeThresholdPct), 'aria-label': '变化提醒阈值（百分比）', style: 'width:84px;text-align:right', autocomplete: 'off' });
      th.addEventListener('change', async () => {
        const v = Number(th.value.normalize('NFKC'));
        if (!(v > 0 && v <= 1000)) {
          toast('请输入 0 到 1000 之间的数');
          th.value = String(store.state.settings.changeThresholdPct);
          return;
        }
        await set({ changeThresholdPct: v });
      });
      const remind = h('select', { 'aria-label': '备份提醒间隔', style: 'width:110px' }, ...[7, 14, 30, 90].map((d) => h('option', { value: String(d) }, `${d} 天`)));
      remind.value = String(store.state.settings.backupRemindDays);
      remind.addEventListener('change', () => set({ backupRemindDays: Number(remind.value) }));
      const s = store.state.settings;
      return h(
        'div',
        { class: 'list' },
        row('金额单位', '首页和列表里的显示方式', seg([{ value: 'yuan', label: '元' }, { value: 'wan', label: '万元' }], s.unit, (v) => set({ unit: v }), { label: '金额单位' })),
        row('涨跌颜色', '只影响颜色，▲▼ 符号始终显示', seg([{ value: 'red', label: '红涨绿跌' }, { value: 'green', label: '绿涨红跌' }], s.riseColor, (v) => set({ riseColor: v }), { label: '涨跌颜色' })),
        row('外观', null, seg([{ value: 'auto', label: '跟随系统' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }], s.theme, (v) => set({ theme: v }), { label: '外观' })),
        row('变化提醒', '与上一条相比变化超过这个比例时提示（只提示，不改数据）', h('div', { class: 'row', style: 'gap:6px' }, th, h('span', {}, '%'))),
        row('备份提醒', '距上次备份超过这么久，首页会提醒', remind),
      );
    },
  });

  /* 安全 */
  section({
    id: 'security',
    title: '安全',
    sig: (st) => `${st.settings.lockEnabled}|${!!st.meta.lockCredential}|${st.settings.lockAfterSec}`,
    build: (self) => {
      const { settings, meta } = store.state;
      const sw = switchControl(settings.lockEnabled && !!meta.lockCredential, async (on) => {
        sw.querySelector('input').disabled = true;
        await self.quiet(async () => {
          if (on) {
            try {
              const id = await registerLock();
              await store.setMeta('lockCredential', id);
              const r = await store.updateSettings({ lockEnabled: true });
              if (r.ok) toast('已开启设备锁');
            } catch (e) {
              toast(e?.name === 'NotAllowedError' ? '没有通过验证，未开启设备锁' : `无法开启：${e.message}`);
            }
          } else if (await verifyLock(store.state.meta.lockCredential)) {
            await store.updateSettings({ lockEnabled: false });
            await store.setMeta('lockCredential', null);
            toast('已关闭设备锁');
          } else toast('没有通过验证，设备锁保持开启');
        });
        self.draw();
      }, '设备锁');
      const after = h('select', { 'aria-label': '多久后重新锁定', style: 'width:120px' }, ...[[0, '立即'], [60, '1 分钟后'], [300, '5 分钟后'], [900, '15 分钟后']].map(([v, l]) => h('option', { value: String(v) }, l)));
      after.value = String(settings.lockAfterSec);
      after.addEventListener('change', () => self.quiet(() => store.updateSettings({ lockAfterSec: Number(after.value) })));
      const desc = h('div', { class: 'desc' }, '用 Face ID / 触控 ID / 锁屏密码解锁');
      lockSupported().then((ok) => {
        if (!ok && !settings.lockEnabled) {
          sw.querySelector('input').disabled = true;
          desc.textContent = '这台设备（或当前打开方式）不支持设备锁';
        }
      });
      return h(
        'div',
        { class: 'stack' },
        h('div', { class: 'list' }, h('div', { class: 'setting' }, h('div', { class: 'grow' }, h('div', {}, '设备锁'), desc), sw), settings.lockEnabled ? row('重新锁定', '离开 App 多久后需要再次验证', after) : null),
        noteBox('info', '设备锁用来挡住别人直接翻看这个 App，不会加密手机里的数据。想保护备份文件，请在导出时设置密码。'),
      );
    },
  });

  /* 存储与离线 */
  section({
    id: 'storage',
    title: '存储与离线',
    sig: (st) => `${st.snapshots.length}|${st.meta.persisted}`,
    build: (self) => {
      const status = h('span', { class: 'muted' }, '检查中…');
      const persist = h('span', { class: 'muted' }, '检查中…');
      const usage = h('span', { class: 'muted' }, '—');
      const persistBtn = h('span', {});
      (async () => {
        const sw = 'serviceWorker' in navigator;
        status.textContent = !sw ? '当前环境不支持离线缓存（需要 HTTPS 或 localhost）' : navigator.serviceWorker.controller ? '已就绪：断网也能打开' : '尚未就绪：请联网打开一次，等这里变成「已就绪」';
        try {
          const p = await navigator.storage?.persisted?.();
          persist.textContent = p ? '已开启（系统不会随意清理）' : '未开启（存储紧张时系统可能清理）';
          if (!p && navigator.storage?.persist) persistBtn.replaceChildren(button('申请持久存储', async () => {
            const ok = await navigator.storage.persist();
            await store.setMeta('persisted', !!ok);
            toast(ok ? '已开启持久存储' : '系统没有批准；把 App 添加到主屏幕后更容易成功');
          }, { sm: true, kind: 'secondary' }));
          const est = await navigator.storage?.estimate?.();
          if (est?.usage != null) usage.textContent = est.usage > 1048576 ? `${(est.usage / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(est.usage / 1024))} KB`;
        } catch {
          persist.textContent = '无法检查';
        }
      })();
      const install = isStandalone()
        ? null
        : noteBox('warn', [h('b', {}, '建议添加到主屏幕后再使用'), h('div', { class: 'small' }, isIOS() ? '用 Safari 打开 → 点分享按钮 → 添加到主屏幕。iPhone 的 Safari 可能会清理长期不打开的网页的本地数据，添加到主屏幕后的 App 不受这个限制。' : '在 Chrome 菜单里选「安装应用」或「添加到主屏幕」，之后它会像普通 App 一样打开，并且更不容易被系统清理数据。')]);
      return h(
        'div',
        { class: 'stack' },
        install,
        h('div', { class: 'card flat' }, h('div', { class: 'kv' }, h('span', {}, '离线可用'), status), h('div', { class: 'kv' }, h('span', {}, '持久存储'), persist), h('div', { class: 'kv' }, h('span', {}, '已占用空间'), usage), h('div', { class: 'kv' }, h('span', {}, '数据库'), h('span', { class: 'muted' }, ctx.repoKind === 'memory' ? '临时（不会保存！）' : '本机 IndexedDB'))),
        persistBtn,
      );
    },
  });

  /* 关于 */
  section({
    id: 'about',
    title: '关于',
    sig: () => '',
    build: () =>
      h(
        'div',
        { class: 'card flat stack' },
        h('div', { class: 'kv' }, h('span', {}, APP_NAME), h('span', { class: 'muted' }, `版本 ${APP_VERSION}`)),
        h('p', { class: 'small' }, '完全离线：除了第一次安装，这个 App 不联网，不上传任何数据，也不连接支付宝、微信、币安或银行，不保存任何账户密码。页面的安全策略（CSP）还禁止它向其他网站发起连接。'),
        h('p', { class: 'small muted' }, '资产快照账本——记的是某一天各渠道的余额，不是每笔收支。'),
      ),
  });

  /* 危险操作 */
  section({
    id: 'danger',
    title: '清除数据',
    sig: () => '',
    build: () =>
      h('div', { class: 'stack' }, button('清除本机所有数据…', async () => {
        if (!(await confirmDialog({ title: '清除所有数据？', message: `会删除全部 ${store.state.snapshots.length} 条记录并恢复默认设置。清除后无法找回——请先导出完整备份。`, confirmText: '继续', danger: true }))) return;
        const typed = await promptDialog({ title: '再确认一次', message: '请输入「清除全部数据」', validate: (t) => (t.trim() === '清除全部数据' ? '' : '输入不一致') });
        if (typed == null) return;
        const r = await store.wipeAll();
        toast(r.ok ? '已清除全部数据' : r.message);
      }, { kind: 'danger', block: true, iconName: 'trash' })),
  });

  const offSub = store.subscribe((st) => {
    for (const s of sections) {
      const g = s.sig(st);
      if (g === s.last) continue;
      if (s.suppress) s.last = g;
      else s.draw();
    }
  });

  if (opts.focus) setTimeout(() => root.querySelector(`#set-${opts.focus}`)?.scrollIntoView({ block: 'start' }), 0);
  return { el: root, destroy: offSub };
}
