// 类别（账户）的常用操作，设置页和「记一笔」共用：改名、设为负债、添加负债账户。
import { confirmDialog, promptDialog, toast } from './components.js';
import { cleanName, nameKey } from '../core/model.js';

/** 弹出改名对话框；成功返回新名字，取消或失败返回 null。历史记录按 id 关联，改名后会一并显示新名字。 */
export async function renameCategory(store, id) {
  const cat = store.state.categories.find((c) => c.id === id);
  if (!cat) return null;
  const name = await promptDialog({
    title: '改名',
    message: '以前的记录会一起显示新名字，金额不受影响。',
    value: cat.name,
    maxlength: 20,
    confirmText: '保存',
    validate: (v) => {
      const n = cleanName(v);
      if (!n) return '名称不能为空';
      if (store.state.categories.some((c) => c.id !== id && nameKey(c.name) === nameKey(n))) return '已经有同名的类别了，换一个名字';
      return '';
    },
  });
  if (name == null || cleanName(name) === cat.name) return null;
  const r = await store.saveCategories(store.state.categories.map((c) => (c.id === id ? { ...c, name } : c)).sort((a, b) => a.order - b.order));
  if (!r.ok) {
    toast(r.message);
    return null;
  }
  toast(`已改名为「${cleanName(name)}」`);
  return cleanName(name);
}

/**
 * 设为 / 取消「负债」。已有记录时按情况询问：以前把欠款记成了正数，就需要把旧记录一起翻成负数，净资产才算得对。
 * 返回 true 表示已更改。
 */
export async function toggleDebt(store, id, on) {
  const cat = store.state.categories.find((c) => c.id === id);
  if (!cat || !!cat.debt === !!on) return false;
  const vals = store.state.snapshots.map((s) => s.entries[id]?.fen).filter((f) => Number.isInteger(f) && f !== 0);
  // 设为负债时，需要翻转的是以前记成正数的；改回资产时，需要翻转的是负数
  const wrongSign = vals.filter((f) => (on ? f > 0 : f < 0)).length;
  let flipRecords = false;
  if (wrongSign) {
    flipRecords = await confirmDialog({
      title: on ? `把「${cat.name}」设为负债` : `把「${cat.name}」改回资产`,
      message: on
        ? `它有 ${wrongSign} 条记录的金额是正数（当作了资产）。要把这些记录一起改成欠款、从资产里减去吗？`
        : `它有 ${wrongSign} 条记录记的是欠款。要把这些记录一起改成资产、加回总额吗？`,
      confirmText: '旧记录一起改',
      cancelText: '只改以后的记录',
    });
  }
  const r = await store.setCategoryDebt(id, on, { flipRecords });
  if (!r.ok) {
    toast(r.message);
    return false;
  }
  const tail = r.flipped ? `，${r.flipped} 条旧记录已一起修改` : '';
  toast(on ? `「${cat.name}」已设为负债${tail}` : `「${cat.name}」已改回资产${tail}`);
  return true;
}

/** 新增一个负债账户（信用卡、花呗、贷款……）。成功返回新类别。 */
export async function addDebtAccount(store) {
  const name = await promptDialog({
    title: '添加负债账户',
    message: '例如 信用卡、花呗、房贷。记账时填欠款金额（正数即可），会自动从资产里减去，首页显示净资产。',
    placeholder: '信用卡',
    maxlength: 20,
    confirmText: '添加',
    validate: (v) => {
      const n = cleanName(v);
      if (!n) return '名称不能为空';
      if (store.state.categories.some((c) => nameKey(c.name) === nameKey(n))) return '已经有同名的类别了，换一个名字';
      return '';
    },
  });
  if (name == null) return null;
  const r = await store.addCategory(name, { debt: true });
  if (!r.ok) {
    toast(r.message);
    return null;
  }
  toast(`已添加负债账户「${r.category.name}」`);
  return r.category;
}
