// 设置：备份与恢复、类别、显示、安全、存储与离线、清除数据。
import { h, icon } from '../dom.js';
import { fx } from '../feedback.js';
import { alertDialog, button, confirmDialog, noteBox, openSheet, promptDialog, seg, switchControl, toast } from '../components.js';
import { openTemplates } from './importHub.js';
import { MIN_PASSWORD_LENGTH, createBackup, openBackup } from '../../core/backup.js';
import { exportCSV } from '../../core/csvExport.js';
import { dayDiff, todayISO } from '../../core/date.js';
import { cardNumberOf, skinOf, sortedCategories } from '../../core/model.js';
import { MIME, fileStamp, isIOS, isStandalone, pickFile, saveFile } from '../../platform.js';
import { lockSupported, registerLock, verifyLock } from '../lock.js';
import { APP_NAME, APP_VERSION } from '../../version.js';
import { editGoal } from '../insights.js';
import { categoryList } from '../categoryEditor.js';
import { compactYuan } from '../fmt.js';
import { LIVE_STYLES, liveStyleOf } from '../liveNumber.js';
import { askTilt, tiltAlive } from '../tilt.js';

const when = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const row = (label, desc, control) => h('div', { class: 'setting' }, h('div', { class: 'grow' }, h('div', {}, label), desc ? h('div', { class: 'desc' }, desc) : null), control);
const listItem = (iconName, title, meta, onClick) =>
  h('button', { type: 'button', class: 'item', onClick }, h('span', { class: 'ico plain' }, icon(iconName)), h('span', { class: 'grow' }, h('div', { class: 'title' }, title), meta ? h('div', { class: 'meta' }, meta) : null), icon('chevronR', { size: 18 }));

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
      fx.success();
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
      fx.success();
      toast(`已恢复 ${r.count} 条记录`, { actionText: '撤销', onAction: async () => { const u = await store.undoRestore(); toast(u.ok ? '已撤销，回到恢复前的数据' : u.message); }, ms: 9000 });
    }, { block: true }), button('取消', () => sheet.close(), { block: true, kind: 'secondary' })),
  });
}

/** 主动检查新版本：有新版就下载并刷新；没有就提示已是最新。 */
async function checkForUpdate(btn) {
  const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => null);
  if (!reg) return location.reload();
  btn.disabled = true;
  btn.lastChild.textContent = '检查中…';
  const done = (msg) => {
    btn.disabled = false;
    btn.lastChild.textContent = '检查更新';
    if (msg) toast(msg);
  };
  try {
    await reg.update();
  } catch {
    return done('暂时连不上网络，稍后再试');
  }
  const nw = reg.installing || reg.waiting;
  if (!nw) return done(`已是最新版本（${APP_VERSION}）`);
  btn.lastChild.textContent = '正在更新…';
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  if (reg.waiting) reg.waiting.postMessage('skipWaiting');
  setTimeout(() => location.reload(), 8000);
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
    title: '导入与备份',
    sub: '数据只存在这台手机里，请定期备份。',
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
          listItem('download', '导入记录', '粘贴文字或 CSV / Excel', () => ctx.nav.goto('import')),
          listItem('share', '导出完整备份', '换手机时用它恢复，可加密', () => openBackupExport(ctx)),
          listItem('upload', '从备份文件恢复', '选择 .json 备份文件', () => startRestore(ctx)),
          listItem('table', '导出 CSV', '用表格软件查看', async () => {
            if (!store.state.snapshots.length) return toast('还没有记录可导出');
            const r = await saveFile(`资产账本-导出-${fileStamp()}.csv`, exportCSV(store.state.snapshots, store.state.categories), MIME.csv, { title: '资产账本 CSV' });
            if (r !== 'cancelled') toast(r === 'shared' ? '已打开分享面板' : '已下载');
          }),
          listItem('file', '下载导入模板', '填好后导入', () => openTemplates(ctx)),
          meta.preRestore ? listItem('undo', '撤销上次恢复', `换回 ${when(meta.preRestore.savedAt)} 的数据`, async () => {
            if (!(await confirmDialog({ title: '撤销上次恢复？', message: `会换回 ${when(meta.preRestore.savedAt)} 时的数据（${meta.preRestore.payload.snapshots.length} 条记录）。现在这份数据会被替换。`, confirmText: '撤销恢复', danger: true }))) return;
            const r = await store.undoRestore();
            toast(r.ok ? '已撤销恢复' : r.message);
          }) : null,
        ),
      );
    },
  });

  /* 类别 */
  const newName = h('input', { type: 'text', placeholder: '新账户名称', 'aria-label': '新类别名称', maxlength: 20 });
  let addKind = 'asset';
  section({
    id: 'categories',
    title: '账户与类别',
    sub: '点账户可编辑，按住 ≡ 拖动排序。',
    sig: (st) => JSON.stringify(sortedCategories(st.categories).map((c) => [c.id, c.name, c.enabled, c.colorSlot, c.icon ?? null, !!c.debt, c.group ?? null, c.groupName ?? null])) + st.snapshots.length,
    build: () => {
      // 新增：先选「资产 / 负债」，再填名字
      const kind = seg([{ value: 'asset', label: '资产' }, { value: 'debt', label: '负债' }], addKind, (v) => {
        addKind = v;
        newName.placeholder = v === 'debt' ? '如：信用卡、花呗' : '如：基金、银行卡';
      }, { label: '新账户类型' });
      newName.placeholder = addKind === 'debt' ? '如：信用卡、花呗' : '如：基金、银行卡';
      const add = async () => {
        const r = await store.addCategory(newName.value, { debt: addKind === 'debt' });
        if (!r.ok) return toast(r.message);
        newName.value = '';
        toast(addKind === 'debt' ? '已添加，记账时填欠款金额' : '已添加');
      };
      newName.addEventListener('keydown', (e) => e.key === 'Enter' && add());
      return h('div', { class: 'stack' }, categoryList(store), h('div', { class: 'add-cat' }, kind, h('div', { class: 'row' }, h('div', { class: 'grow' }, newName), button('添加', add, { kind: 'secondary' }))));
    },
  });

  /* 个性化：卡面、持有人、光影、开屏、实时增长 */
  section({
    id: 'prestige',
    title: '个性化',
    sig: (st) => JSON.stringify([st.settings.coverSkin, st.settings.holderName, st.settings.cardNo, st.settings.tilt, st.settings.splash, st.settings.liveGrowth, st.settings.liveStyle]),
    build: (self) => {
      const set = (patch) => self.quiet(() => store.updateSettings(patch));
      const s = store.state.settings;
      const skin = skinOf(s);
      const editHolder = async () => {
        const v = await promptDialog({ title: '卡面持有人', message: '显示在首页卡片底部，例如你的名字或英文缩写。留空则不显示。', value: s.holderName ?? '', placeholder: '如：J. LIM', maxlength: 16 });
        if (v == null) return;
        await store.updateSettings({ holderName: v.trim().slice(0, 16) });
      };
      const editCardNo = async () => {
        const v = await promptDialog({
          title: '卡号',
          message: '填 16 位数字，留空则用自动生成的号码（由第一条记录的日期得出）。',
          value: s.cardNo ?? '',
          placeholder: cardNumberOf({}, store.state.snapshots).join(' '),
          type: 'text',
          maxlength: 19,
          validate: (t) => {
            const d = t.replace(/\s/g, '');
            return d === '' || /^\d{16}$/.test(d) ? '' : '需要 16 位数字';
          },
        });
        if (v == null) return;
        await store.updateSettings({ cardNo: v.replace(/\s/g, '') || null });
      };
      // iPhone 上打开光影要先在这次点按里请求陀螺仪权限
      const tiltSwitch = switchControl(!!s.tilt, async (on) => {
        if (on && !(await askTilt())) {
          toast('没有获得动作与方向权限，可在系统设置里允许后再打开');
          return store.updateSettings({ tilt: false });
        }
        await set({ tilt: on });
        if (!on) return;
        fx.select();
        toast('已打开，回首页倾斜手机看看卡面');
        // 电脑没有陀螺仪：鼠标在卡片上移动也有效果，不提示
        setTimeout(() => {
          if (!tiltAlive() && matchMedia('(pointer: coarse)').matches) toast('没有收到手机方向数据：请在系统设置里允许此 App 使用「动作与方向」');
        }, 1800);
      }, '卡面光影');
      return h(
        'div',
        { class: 'list' },
        row('卡面', null, seg([{ value: 'ink', label: '墨' }, { value: 'paper', label: '素' }, { value: 'jade', label: '黛' }], skin, (v) => set({ coverSkin: v }), { label: '卡面' })),
        row('持有人', '显示在卡号下面', button(s.holderName || '设定', editHolder, { sm: true, kind: 'secondary' })),
        row('卡号', '首页卡片左下角，16 位', button(cardNumberOf(s, store.state.snapshots).join(' '), editCardNo, { sm: true, kind: 'secondary' })),
        row('卡面光影', '倾斜手机时，卡面高光和金边跟着光线移动', tiltSwitch),
        row('开屏动画', '打开 App 时的徽记动画，点一下可跳过', switchControl(s.splash !== false, (on) => set({ splash: on }), '开屏动画')),
        row('实时增长', '首页净资产按近一年增速每秒增长（估算）', switchControl(s.liveGrowth !== false, (on) => store.updateSettings({ liveGrowth: on }), '实时增长')),
        s.liveGrowth !== false ? row('增长风格', null, seg(LIVE_STYLES.map(({ value, label }) => ({ value, label })), liveStyleOf(s), (v) => set({ liveStyle: v }), { label: '增长风格' })) : null,
      );
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
        row('操作音效', '按键、保存时的轻声提示；手机静音时不响', switchControl(s.sound !== false, (on) => set({ sound: on }).then(() => on && fx.done()), '操作音效')),
        row('触感震动', isIOS() ? 'iPhone 需 iOS 18 及以上' : null, switchControl(s.haptics !== false, (on) => set({ haptics: on }).then(() => on && fx.select()), '触感震动')),
        row('隐藏金额', '首页右上角的眼睛也能切换', switchControl(!!s.hideAmounts, (on) => set({ hideAmounts: on }), '隐藏金额')),
        row('财富目标', '首页显示达成进度', button(s.goalFen ? compactYuan(s.goalFen) : '设定', () => editGoal(store), { sm: true, kind: 'secondary' })),
        row('金额单位', null, seg([{ value: 'yuan', label: '元' }, { value: 'wan', label: '万元' }], s.unit, (v) => set({ unit: v }), { label: '金额单位' })),
        row('涨跌颜色', null, seg([{ value: 'red', label: '红涨绿跌' }, { value: 'green', label: '绿涨红跌' }], s.riseColor, (v) => set({ riseColor: v }), { label: '涨跌颜色' })),
        row('外观', null, seg([{ value: 'auto', label: '跟随系统' }, { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }], s.theme, (v) => set({ theme: v }), { label: '外观' })),
        row('变化提醒', '较上次变化超过时提示', h('div', { class: 'row', style: 'gap:6px' }, th, h('span', {}, '%'))),
        row('备份提醒', null, remind),
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
        h('div', { class: 'list' }, h('div', { class: 'setting' }, h('div', { class: 'grow' }, h('div', {}, '设备锁'), desc), sw), settings.lockEnabled ? row('重新锁定', null, after) : null),
        h('p', { class: 'hint' }, '只防别人翻看，不加密数据。'),
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
        status.textContent = !sw ? '不支持' : navigator.serviceWorker.controller ? '已就绪' : '联网打开一次后就绪';
        try {
          const p = await navigator.storage?.persisted?.();
          persist.textContent = p ? '已开启' : '未开启';
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
        : noteBox('warn', [h('b', {}, '建议添加到主屏幕'), h('div', { class: 'small' }, isIOS() ? 'Safari 分享按钮 → 添加到主屏幕，数据更不容易被清理。' : '浏览器菜单 → 安装应用 / 添加到主屏幕。')]);
      return h(
        'div',
        { class: 'stack' },
        install,
        h('div', { class: 'card flat' }, h('div', { class: 'kv' }, h('span', {}, '离线可用'), status), h('div', { class: 'kv' }, h('span', {}, '持久存储'), persist), h('div', { class: 'kv' }, h('span', {}, '已占用空间'), usage), h('div', { class: 'kv' }, h('span', {}, '数据库'), h('span', { class: 'muted' }, ctx.repoKind === 'memory' ? '临时（不会保存！）' : '本机'))),
        persistBtn,
      );
    },
  });

  /* 关于 */
  section({
    id: 'about',
    title: '关于',
    sig: () => '',
    build: () => {
      const btn = button('检查更新', () => checkForUpdate(btn), { sm: true, kind: 'secondary', iconName: 'repeat' });
      return h(
        'div',
        { class: 'stack' },
        h('div', { class: 'list' }, row(APP_NAME, `版本 ${APP_VERSION}`, btn)),
        h('p', { class: 'hint' }, '完全离线，不上传任何数据，不连接任何账户。'),
      );
    },
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
