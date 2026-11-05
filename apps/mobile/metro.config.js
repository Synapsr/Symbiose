// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * The AI SDKs (packages/core runs them in the app on a phone without a
 * server) re-export across circular imports. Their ESM build breaks under
 * Metro's import support (`BetaToolRunner` of undefined at startup); their
 * CommonJS build re-exports through getters and loads fine. So these two
 * packages resolve to CommonJS; everything else is untouched.
 */
const COMMONJS = /^(@anthropic-ai\/sdk|openai)(\/|$)/;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (COMMONJS.test(moduleName)) {
    return context.resolveRequest({ ...context, unstable_conditionNames: ['require', 'react-native', 'default'] }, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
