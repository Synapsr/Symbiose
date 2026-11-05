import type { Deps } from '@symbiose/core';

import type { Config } from './env';

/** The API's dependencies on a server: authentication comes from the server's own signed tokens. */
export interface ServerDeps extends Omit<Deps, 'auth' | 'config'> {
  config: Config;
}
