// The web build is a development tool and always talks to a server: no API on the device there.
export const localFetch: typeof fetch = () => Promise.reject(new TypeError('No on-device data in the browser'));
export const localPhotoUri = (id: string) => id;
export const localModeAvailable = false;
export const phoneDataExists = () => false;
