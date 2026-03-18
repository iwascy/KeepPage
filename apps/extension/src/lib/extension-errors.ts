export function getRuntimeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function isExtensionContextInvalidatedError(error: unknown) {
  return getRuntimeErrorMessage(error).toLowerCase().includes("extension context invalidated");
}

export function isMissingReceiverError(error: unknown) {
  const message = getRuntimeErrorMessage(error).toLowerCase();
  return (
    message.includes("receiving end does not exist") ||
    message.includes("could not establish connection")
  );
}

export function isStaleExtensionContextError(error: unknown) {
  return (
    isExtensionContextInvalidatedError(error) ||
    isMissingReceiverError(error)
  );
}

export function getRefreshRequiredMessage() {
  return "扩展刚安装或更新后，当前页面需要先刷新一次，再重新点击 KeepPage。";
}
