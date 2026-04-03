/**
 * Native Google Maps keys must NOT live in app.json (GitGuardian / public repos).
 * Set GOOGLE_MAPS_NATIVE_API_KEY in .env (see .env.example) or EAS Secrets for builds.
 *
 * @see https://docs.expo.dev/guides/environment-variables/
 */
module.exports = ({ config }) => {
  const nativeMapsKey = process.env.GOOGLE_MAPS_NATIVE_API_KEY || "";

  return {
    ...config,
    ios: {
      ...config.ios,
      config: {
        ...(config.ios?.config || {}),
        googleMapsApiKey: nativeMapsKey,
      },
    },
    android: {
      ...config.android,
      config: {
        ...(config.android?.config || {}),
        googleMaps: {
          ...(config.android?.config?.googleMaps || {}),
          apiKey: nativeMapsKey,
        },
      },
    },
  };
};
