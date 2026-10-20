// 类别（账户）的常用操作，设置页和「记一笔」共用：改名。
import { promptDialog, toast } from './components.js';
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
