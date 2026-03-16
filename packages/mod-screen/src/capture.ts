/**
 * Screenshot capture with Retina normalization and coordinate mapping.
 * Requires Electron's desktopCapturer and screen APIs.
 */

export interface CaptureMapping {
  captureId: string;
  capturedAt: number;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  imageWidth: number;
  imageHeight: number;
  displayWidth: number;
  displayHeight: number;
  displayId: number;
  permissionStatus: string;
}

export interface CaptureResult {
  ok: boolean;
  data: string | null; // base64 JPEG
  error?: string;
  permissionStatus?: string;
  context?: {
    captureId: string;
    capturedAt: number;
    capturedAtIso: string;
    imageWidth: number;
    imageHeight: number;
    displayWidth: number;
    displayHeight: number;
    scaleFactor: number;
    displayId: number;
    displayBounds: { x: number; y: number; width: number; height: number };
    permissionStatus: string;
    cursorX: number;
    cursorY: number;
    cursorScreenX: number;
    cursorScreenY: number;
  };
}

const MAX_HISTORY = 24;

let mappings = new Map<string, CaptureMapping>();
let latestCaptureId = '';
let lastErrorLog = 0;

export const getMapping = (captureId?: string): CaptureMapping | undefined =>
  mappings.get(captureId ?? latestCaptureId);

export const getLatestCaptureId = (): string => latestCaptureId;

const rememberMapping = (mapping: CaptureMapping) => {
  mappings.set(mapping.captureId, mapping);
  latestCaptureId = mapping.captureId;

  // Trim history
  if (mappings.size > MAX_HISTORY) {
    const oldest = mappings.keys().next().value;
    if (oldest) mappings.delete(oldest);
  }
};

export const getScreenPermissionStatus = (): string => {
  try {
    const { systemPreferences } = require('electron');
    return systemPreferences.getMediaAccessStatus('screen');
  } catch {
    return 'unknown';
  }
};

export const capture = async (): Promise<CaptureResult> => {
  try {
    const { desktopCapturer, screen } = require('electron');

    const permissionStatus = getScreenPermissionStatus();
    if (permissionStatus === 'denied') {
      return {
        ok: false,
        data: null,
        error: 'Screen recording permission denied. Grant it in System Settings → Privacy & Security → Screen Recording.',
        permissionStatus,
      };
    }

    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { width: dw, height: dh } = display.size;

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: dw, height: dh },
    });

    if (sources.length === 0) {
      return { ok: false, data: null, error: 'No screen sources available' };
    }

    // Find matching display source
    const source =
      sources.find((s: any) => s.display_id === String(display.id)) ??
      sources[0];
    const thumbnail = source.thumbnail;

    if (thumbnail.isEmpty()) {
      return { ok: false, data: null, error: 'Empty screenshot captured' };
    }

    // Normalize: get 1x PNG then resize to logical dimensions
    let png = thumbnail.toPNG({ scaleFactor: 1 });
    const { nativeImage } = require('electron');
    let img = nativeImage.createFromBuffer(png);
    const imgSize = img.getSize();

    if (imgSize.width !== dw || imgSize.height !== dh) {
      img = img.resize({ width: dw, height: dh, quality: 'best' });
    }

    // Convert to JPEG base64
    const jpeg = img.toJPEG(40);
    const base64 = jpeg.toString('base64');
    const finalSize = img.getSize();

    const captureId = `cap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const capturedAt = Date.now();

    const scaleX = dw / finalSize.width;
    const scaleY = dh / finalSize.height;

    const mapping: CaptureMapping = {
      captureId,
      capturedAt,
      scaleX,
      scaleY,
      offsetX: display.bounds.x,
      offsetY: display.bounds.y,
      imageWidth: finalSize.width,
      imageHeight: finalSize.height,
      displayWidth: dw,
      displayHeight: dh,
      displayId: display.id,
      permissionStatus,
    };

    rememberMapping(mapping);

    // Cursor position in image coordinates
    const cursorX = Math.round((cursor.x - display.bounds.x) / scaleX);
    const cursorY = Math.round((cursor.y - display.bounds.y) / scaleY);

    return {
      ok: true,
      data: base64,
      context: {
        captureId,
        capturedAt,
        capturedAtIso: new Date(capturedAt).toISOString(),
        imageWidth: finalSize.width,
        imageHeight: finalSize.height,
        displayWidth: dw,
        displayHeight: dh,
        scaleFactor: display.scaleFactor,
        displayId: display.id,
        displayBounds: display.bounds,
        permissionStatus,
        cursorX,
        cursorY,
        cursorScreenX: cursor.x,
        cursorScreenY: cursor.y,
      },
    };
  } catch (err) {
    const now = Date.now();
    if (now - lastErrorLog > 10_000) {
      lastErrorLog = now;
      console.error('[screen] Capture failed:', err);
    }
    return {
      ok: false,
      data: null,
      error: err instanceof Error ? err.message : String(err),
      permissionStatus: getScreenPermissionStatus(),
    };
  }
};

export const getCaptureHealth = (captureId?: string) => {
  const mapping = getMapping(captureId);
  return {
    hasCapture: !!mapping,
    captureId: mapping?.captureId ?? '',
    ageMs: mapping ? Date.now() - mapping.capturedAt : -1,
    permissionStatus: getScreenPermissionStatus(),
    historySize: mappings.size,
  };
};
