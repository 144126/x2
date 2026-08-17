// shared by the lock screen and the server — kept out of $lib/server/pin.ts so the browser
// never has to import the module that holds the hashing
export const MIN = 4;
export const MAX = 12;
