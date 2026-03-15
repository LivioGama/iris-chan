const { BrowserAdapter, canonicalUrl } = require('../automation/browser-adapter');
const { WorldState } = require('../automation/world-state');
const { describeLink } = require('./describer');
const convexStore = require('../convex-store');
const log = require('../logger');

const INTERNAL_URL_RE = /^(about|chrome|edge|brave|arc|devtools|extensions|chrome-extension):/;
const TAG = 'LinkCapture';

class LinkCapturePoller {
	constructor({ pollIntervalMs = 10000, maxSeenCacheSize = 5000 } = {}) {
		this._browser = new BrowserAdapter();
		this._world = new WorldState();
		this._pollIntervalMs = pollIntervalMs;
		this._maxSeenCacheSize = maxSeenCacheSize;
		this._timer = null;
		this._seenUrls = new Set();
		this._processing = false;
		this._tickCount = 0;
	}

	start() {
		if (this._timer) return;
		this._timer = setInterval(() => {
			this._poll().catch(err => log.error(TAG, 'Poll error:', err.message));
		}, this._pollIntervalMs);
		log.info(TAG, `Started (interval: ${this._pollIntervalMs}ms)`);
	}

	stop() {
		if (!this._timer) return;
		clearInterval(this._timer);
		this._timer = null;
		log.info(TAG, 'Stopped');
	}

	async _poll() {
		if (this._processing) return;
		this._processing = true;
		this._tickCount++;
		const tick = this._tickCount;
		try {
			const frontmost = await this._world.getFrontmostApp({ force: true });
			if (!frontmost.ok || !frontmost.name) return;

			const appName = frontmost.name;
			if (!this._browser.isSupported(appName)) return;

			const pageInfo = this._browser.getCurrentPageInfo({ appName });
			if (!pageInfo.ok || !pageInfo.href) {
				log.warn(TAG, `[tick ${tick}] pageInfo failed for ${appName}:`, pageInfo.code || pageInfo.error || 'no href');
				return;
			}
			if (INTERNAL_URL_RE.test(pageInfo.href)) return;

			const canonical = canonicalUrl(pageInfo.href);
			if (!canonical) return;

			if (this._seenUrls.has(canonical)) return;

			if (this._seenUrls.size >= this._maxSeenCacheSize) {
				this._seenUrls.clear();
			}
			this._seenUrls.add(canonical);

			log.info(TAG, `[tick ${tick}] Captured: ${canonical} — "${(pageInfo.title || '').slice(0, 60)}"`);
			this._captureAsync(canonical, pageInfo);
		} finally {
			this._processing = false;
		}
	}

	async _captureAsync(canonical, pageInfo) {
		try {
			const snippet = await describeLink({
				url: pageInfo.href,
				title: pageInfo.title || '',
				host: pageInfo.host || '',
			});

			await convexStore.saveLink({
				url: canonical,
				title: pageInfo.title || '',
				snippet: snippet || '',
				source: 'browser_capture',
			});
			log.info(TAG, `Saved: ${canonical} (snippet: ${snippet ? snippet.length + ' chars' : 'none'})`);
		} catch (err) {
			log.error(TAG, 'Capture error:', err.message);
		}
	}
}

module.exports = { LinkCapturePoller };
