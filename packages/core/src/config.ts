export const VERSION = '0.1.0';

/** What the API itself reads from its host's configuration. */
export interface CoreConfig {
  /** Lowercase emails of the accounts that see the admin view (ADMIN_EMAILS on a server); none on the phone. */
  adminEmails?: string[];
}
