// 设备锁：用手机自带的 Face ID / 触控 ID / 锁屏密码（WebAuthn 平台验证器）来解锁界面。
// 这是「界面锁」：挡住别人直接翻看你的 App。它不会加密本机数据库——要保护备份文件，请在导出时设置密码。
// 所有验证都在本机完成，不涉及任何服务器。
import { h, icon } from './dom.js';
import { button, confirmDialog, promptDialog, toast } from './components.js';
import { fromB64, toB64 } from '../core/backup.js';

export async function lockSupported() {
  try {
    return !!(globalThis.PublicKeyCredential && navigator.credentials && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()));
  } catch {
    return false;
  }
}

const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

/** 创建一个本机验证凭据，返回其 id（base64）。会弹出系统的 Face ID / 触控 ID / 锁屏密码验证。 */
export async function registerLock() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: rand(32),
      rp: { name: '资产账本' },
      user: { id: rand(16), name: 'asset-ledger', displayName: '资产账本（本机）' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      attestation: 'none',
      timeout: 60000,
    },
  });
  if (!cred) throw new Error('没有创建凭据');
  return toB64(new Uint8Array(cred.rawId));
}

/** 要求用户通过系统验证。通过返回 true，取消/失败返回 false。 */
export async function verifyLock(credIdB64) {
  try {
    const cred = await navigator.credentials.get({
      publicKey: { challenge: rand(32), allowCredentials: [{ type: 'public-key', id: fromB64(credIdB64), transports: ['internal'] }], userVerification: 'required', timeout: 60000 },
    });
    return !!cred;
  } catch {
    return false;
  }
}

export function buildLockScreen(store) {
  const msg = h('p', { class: 'muted', role: 'status', style: 'min-height:1.5em;margin:6px 0 18px' }, '用 Face ID / 触控 ID / 锁屏密码解锁');
  let busy = false;
  const attempt = async () => {
    if (busy) return;
    busy = true;
    msg.textContent = '正在验证…';
    const ok = await verifyLock(store.state.meta.lockCredential);
    busy = false;
    if (ok) store.unlock();
    else msg.textContent = '没有通过验证，请再试一次';
  };
  const stuck = async () => {
    const go = await confirmDialog({
      title: '无法解锁？',
      message: '设备锁用的是手机自带的 Face ID / 触控 ID / 锁屏密码，通常用锁屏密码也能验证。如果始终不行，唯一的办法是清除本机数据后重新开始——之后可以用备份文件恢复。清除后无法找回未备份的数据。',
      confirmText: '清除本机数据…',
      cancelText: '再试试',
      danger: true,
    });
    if (!go) return;
    const typed = await promptDialog({ title: '确认清除', message: '请输入「清除全部数据」', validate: (t) => (t.trim() === '清除全部数据' ? '' : '输入不一致') });
    if (typed == null) return;
    const r = await store.wipeAll();
    if (r.ok) {
      await store.updateSettings({ lockEnabled: false });
      store.unlock();
      toast('已清除，可以重新开始或从备份恢复');
    }
  };
  const el = h(
    'div',
    { class: 'lock', role: 'dialog', 'aria-modal': 'true', 'aria-label': '资产账本已锁定' },
    h('div', { style: 'max-width:320px' }, h('div', { class: 'glyph' }, icon('lock', { size: 34 })), h('h1', {}, '资产账本已锁定'), msg, button('解锁', attempt, { block: true, iconName: 'fingerprint' }), h('div', { style: 'margin-top:14px' }, button('无法解锁？', stuck, { kind: 'ghost', sm: true }))),
  );
  setTimeout(attempt, 150);
  return el;
}
