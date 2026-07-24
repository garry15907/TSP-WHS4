const path = require("node:path");

function loadConfig(overrides = {}) {
  const rootDir = overrides.rootDir || path.resolve(__dirname, "..");
  const port = Number(overrides.port || process.env.PORT || 3000);
  const reportThreshold = Number(
    overrides.reportThreshold || process.env.REPORT_THRESHOLD || 3,
  );
  const sessionSecret =
    overrides.sessionSecret ||
    process.env.SESSION_SECRET ||
    "development-only-secret-change-me";
  const appOrigin =
    overrides.appOrigin || process.env.APP_ORIGIN || `http://localhost:${port}`;
  const dbPath =
    overrides.dbPath || path.join(rootDir, "data", "tiny-market.sqlite");

  return {
    rootDir,
    port,
    reportThreshold,
    sessionSecret,
    appOrigin,
    dbPath,
    adminSeed: {
      username: overrides.adminUsername || process.env.ADMIN_USERNAME || "admin",
      displayName:
        overrides.adminDisplayName ||
        process.env.ADMIN_DISPLAY_NAME ||
        "Platform Admin",
      password:
        overrides.adminPassword ||
        process.env.ADMIN_PASSWORD ||
        "ChangeThisAdminPass123!",
    },
  };
}

module.exports = { loadConfig };
