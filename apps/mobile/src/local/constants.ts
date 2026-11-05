/** The made-up address of the API on the phone: only the paths after it matter. */
export const LOCAL_SERVER_URL = 'local://phone';
/** The phone's API asks for no token; the session still carries one. */
export const LOCAL_TOKEN = 'local';

/** Whether a session's address is the phone itself (no server). */
export const isLocalUrl = (url: string | null | undefined): boolean => url === LOCAL_SERVER_URL;
