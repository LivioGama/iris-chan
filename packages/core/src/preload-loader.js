// Electron preload must be JS. This loads the TS preload via tsx.
require('tsx/cjs');
require('./preload.ts');
