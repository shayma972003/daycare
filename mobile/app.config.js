const { existsSync } = require("node:fs");

const localGoogleServicesFile = "./google-services.json";

module.exports = ({ config }) => {
  const googleServicesFile =
    process.env.GOOGLE_SERVICES_JSON ??
    (existsSync(localGoogleServicesFile) ? localGoogleServicesFile : undefined);

  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
