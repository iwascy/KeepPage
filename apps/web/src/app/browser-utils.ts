export async function copyTextToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.append(textarea);
  textarea.select();
  const successful = document.execCommand("copy");
  textarea.remove();
  if (!successful) {
    throw new Error("当前环境不支持复制到剪贴板。");
  }
}

export function buildAppUrl(hash: string) {
  return new URL(hash, window.location.href).toString();
}

export function clampContextMenuPosition(x: number, y: number, width: number, height: number) {
  const horizontalGap = 20;
  const verticalGap = 20;
  const left = Math.min(
    Math.max(horizontalGap, x),
    Math.max(horizontalGap, window.innerWidth - width - horizontalGap),
  );
  const top = Math.min(
    Math.max(verticalGap, y),
    Math.max(verticalGap, window.innerHeight - height - verticalGap),
  );
  return { left, top };
}
