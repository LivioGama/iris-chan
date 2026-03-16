import {
  BrowserWindow,
  screen,
  Tray,
  Menu,
  nativeImage,
  app,
} from 'electron';
import { join } from 'node:path';
import { createGeometryStore, type WindowBounds } from './geometry-store';
import type { IrisPaths } from './types';

const AVATAR_DEFAULTS = {
  width: 1280,
  height: 960,
};

const DISPLAY_POLL_MS = 500;

export const createShell = async (paths: IrisPaths) => {
  const geometryStore = createGeometryStore(
    join(paths.irisDir, 'geometry.json'),
  );

  // ── Avatar window ──
  const savedBounds = geometryStore.get('avatar');

  const avatarWindow = new BrowserWindow({
    width: savedBounds?.width ?? AVATAR_DEFAULTS.width,
    height: savedBounds?.height ?? AVATAR_DEFAULTS.height,
    x: savedBounds?.x,
    y: savedBounds?.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, 'preload-loader.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webgl: true,
    },
  });

  avatarWindow.setIgnoreMouseEvents(true, { forward: true });

  // Load renderer
  const rendererPath = join(
    paths.projectRoot,
    'packages',
    'renderer',
    'src',
    'index.html',
  );
  avatarWindow.loadFile(rendererPath);

  // ── Display tracking ──
  let currentDisplayId = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  ).id;

  const displayPoll = setInterval(() => {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    if (display.id !== currentDisplayId) {
      currentDisplayId = display.id;
      const { x, y } = display.workArea;
      avatarWindow.setPosition(x, y);
    }
  }, DISPLAY_POLL_MS);

  // ── Geometry persistence ──
  let saveDebounce: ReturnType<typeof setTimeout> | null = null;

  const persistGeometry = () => {
    if (saveDebounce) clearTimeout(saveDebounce);
    saveDebounce = setTimeout(() => {
      const bounds = avatarWindow.getBounds();
      geometryStore.set('avatar', bounds);
    }, 300);
  };

  avatarWindow.on('moved', persistGeometry);
  avatarWindow.on('resized', persistGeometry);

  // ── Tray ──
  const trayIcon = nativeImage.createFromNamedImage(
    'NSImageNameTouchBarComposeTemplate',
    [-1, 0, 1],
  );
  const tray = new Tray(trayIcon);

  const updateTrayMenu = () => {
    const menu = Menu.buildFromTemplate([
      {
        label: avatarWindow.isVisible() ? 'Hide Avatar' : 'Show Avatar',
        click: () => {
          if (avatarWindow.isVisible()) {
            avatarWindow.hide();
          } else {
            avatarWindow.show();
          }
          updateTrayMenu();
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
    tray.setContextMenu(menu);
  };

  updateTrayMenu();

  return {
    avatarWindow,
    tray,

    dispose() {
      clearInterval(displayPoll);
      if (saveDebounce) clearTimeout(saveDebounce);
      tray.destroy();
    },
  };
};
