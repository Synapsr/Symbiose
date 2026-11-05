// The fetch polyfill React Native installs (tests only: local-mode.test.ts).
declare module 'whatwg-fetch' {
  export const Request: typeof globalThis.Request;
  export const Response: typeof globalThis.Response;
  export const Headers: typeof globalThis.Headers;
}
