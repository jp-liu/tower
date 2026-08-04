function isWindows(platform = process.platform) {
  return platform === "win32";
}

function isLinux(platform = process.platform) {
  return platform === "linux";
}

function portablePlatformName(platform = process.platform) {
  return isWindows(platform) ? "windows" : platform;
}

module.exports = { isLinux, isWindows, portablePlatformName };
