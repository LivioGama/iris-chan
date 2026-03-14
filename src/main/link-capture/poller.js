const { BrowserAdapter, canonicalUrl } = require('../automation/browser-adapter');
const { WorldState } = require('../automation/world-state');
const { describeLink } = require('./describer');
const convexStore = require('../convex-store');

const INTERNAL_URL_RE = /^(about|chrome|edge|brave|arc|devtools|extensions|chrome-extension):/;

class LinkCapturePoller {
	constructor({ pollIntervalMs = 10000, maxSeenCacheSize = 5000 } = {}) {
		this._browser = new BrowserAdapter();
		this._world = new WorldState();
		this._pollIntervalMs = pollIntervalMs;
		this._maxSeenCacheSize = maxSeenCacheSize;
		this._timer = null;
		this._seenUrls = new Set();
		this._processing = false;
	}

	start() {
		if (this._timer) return;
		this._timer = setInterval(() => {
			this._poll().catch(err => console.error('[LinkCapture] Poll error:', err.message));
		}, this._pollIntervalMs);
		console.log(`[LinkCapture] Started (interval: ${this._pollIntervalMs}ms)`);
	}

	stop() {
		if (!this._timer) return;
		clearInterval(this._timer);
		this._timer = null;
		console.log('[LinkCapture] Stopped');
	}

	async _poll() {
		if (this._processing) return;
		this._processing = true;
		try {
			const frontmost = await this._world.getFrontmostApp({ force: true });
			if (!frontmost.ok || !frontmost.name) return;
			if (!this._browser.isSupported(frontmost.name)) return;

			const pageInfo = this._browser.getCurrentPageInfo({ appName: frontmost.name });
			if (!pageInfo.ok || !pageInfo.href) return;
			if (INTERNAL_URL_RE.test(pageInfo.href)) return;

			const canonical = canonicalUrl(pageInfo.href);
			if (!canonical) return;

			if (this._seenUrls.has(canonical)) return;

			if (this._seenUrls.size >= this._maxSeenCacheSize) {
				this._seenUrls.clear();
			}
			this._seenUrls.add(canonical);

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
		} catch (err) {
			console.error('[LinkCapture] Capture error:', err.message);
		}
	}
}

module.exports = { LinkCapturePoller };
