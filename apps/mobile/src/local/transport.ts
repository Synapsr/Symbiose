// What the app's API client needs to talk to the API on the phone.
export { localFetch } from './host';
export { photoUri as localPhotoUri } from './photos';
export { phoneDataExists } from './db';
export const localModeAvailable = true;
