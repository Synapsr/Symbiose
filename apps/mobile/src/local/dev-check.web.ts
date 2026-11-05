// The checks run the API on the phone: there is none in the browser.
export async function runDevCheck(log: (line: string) => void) {
  log('dev-check: native builds only');
  return { passed: 0, failed: 0 };
}
