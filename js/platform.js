// 与浏览器 / 系统打交道的小工具：选文件、保存文件、分享。全部在本机完成，不联网。

/** 弹出系统文件选择器。必须在点击事件里同步调用（iOS 要求）。取消时返回 null。 */
export function pickFile(accept = '', { capture } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    if (capture) input.setAttribute('capture', capture);
    input.style.display = 'none';
    document.body.appendChild(input);
    let settled = false;
    const finish = (file) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    input.click();
  });
}

export async function readBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

export async function readText(file) {
  return await file.text();
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 15000);
}

/**
 * 保存或分享一个文件。手机上优先调起系统分享面板（可存到「文件」、网盘、发给自己）；
 * 不支持时退回浏览器下载。返回 'shared' | 'downloaded' | 'cancelled'。
 */
export async function saveFile(filename, data, mime, { title } = {}) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const file = typeof File === 'function' ? new File([blob], filename, { type: mime }) : null;
  if (file && navigator.canShare && navigator.share) {
    let ok = false;
    try {
      ok = navigator.canShare({ files: [file] });
    } catch {
      ok = false;
    }
    if (ok) {
      try {
        await navigator.share({ files: [file], title: title ?? filename });
        return 'shared';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancelled';
        // 其他错误（例如系统不允许分享这种文件）→ 退回下载
      }
    }
  }
  downloadBlob(filename, blob);
  return 'downloaded';
}

export const MIME = Object.freeze({
  csv: 'text/csv;charset=utf-8',
  json: 'application/json',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
});

export function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}

export function fileStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
