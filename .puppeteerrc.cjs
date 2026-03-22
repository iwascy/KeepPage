function isTruthyFlag(value) {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false" && normalized !== "no" && normalized !== "off";
}

const skipDownloadInCi = isTruthyFlag(process.env.CI) || isTruthyFlag(process.env.JENKINS_URL);

module.exports = {
  // Avoid network-bound browser downloads during CI installs. Runtime
  // environments that use cloud archive should provide Chrome/Chromium
  // themselves, or set PUPPETEER_EXECUTABLE_PATH explicitly.
  skipDownload: skipDownloadInCi,
};
