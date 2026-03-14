"use strict";
const { spawnSync } = require('child_process');
const CHROMIUM_APPS = new Set([
    'Google Chrome',
    'Chrome',
    'Arc',
    'Brave Browser',
    'Brave',
    'Microsoft Edge',
    'Edge',
    'Comet',
]);
function escapeAppleScriptString(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
function normalizeUrl(raw) {
    const value = String(raw || '').trim();
    if (!value)
        return '';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value))
        return value;
    if (/^[\w.-]+\.[a-z]{2,}(?:[/?#].*)?$/i.test(value))
        return `https://${value}`;
    return '';
}
function canonicalUrl(raw) {
    const normalized = normalizeUrl(raw);
    if (!normalized)
        return '';
    try {
        const parsed = new URL(normalized);
        const host = parsed.host.replace(/^www\./i, '').toLowerCase();
        const pathname = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
        return `${host}${pathname}${parsed.search || ''}`;
    }
    catch {
        return normalized.toLowerCase();
    }
}
function runAppleScript(script, timeout = 8000) {
    const proc = spawnSync('osascript', ['-e', script], { timeout, encoding: 'utf-8' });
    if (proc.error)
        throw proc.error;
    if (proc.status !== 0) {
        throw new Error((proc.stderr || proc.stdout || 'AppleScript failed').trim());
    }
    return (proc.stdout || '').trim();
}
function runBrowserJavaScript(appName, jsCode, timeout = 8000) {
    const escaped = escapeAppleScriptString(jsCode);
    if (appName === 'Safari') {
        return runAppleScript(`tell application "Safari" to do JavaScript "${escaped}" in current tab of front window`, timeout);
    }
    if (CHROMIUM_APPS.has(appName)) {
        return runAppleScript(`tell application "${escapeAppleScriptString(appName)}" to execute front window's active tab javascript "${escaped}"`, timeout);
    }
    throw new Error(`Unsupported browser app: ${appName}`);
}
function getBrowserUrl(appName) {
    const scripts = appName === 'Safari'
        ? [
            'tell application "Safari" to get URL of current tab of front window',
            'tell application "Safari" to get URL of front document',
        ]
        : CHROMIUM_APPS.has(appName)
            ? [
                `tell application "${escapeAppleScriptString(appName)}" to get URL of active tab of front window`,
                `tell application "${escapeAppleScriptString(appName)}" to get URL of front document`,
            ]
            : [];
    for (const script of scripts) {
        try {
            const value = runAppleScript(script, 4000);
            if (value)
                return value;
        }
        catch { }
    }
    return '';
}
function getBrowserTitle(appName) {
    const scripts = appName === 'Safari'
        ? [
            'tell application "Safari" to get name of current tab of front window',
            'tell application "Safari" to get name of front document',
        ]
        : CHROMIUM_APPS.has(appName)
            ? [
                `tell application "${escapeAppleScriptString(appName)}" to get title of active tab of front window`,
                `tell application "${escapeAppleScriptString(appName)}" to get title of front window`,
            ]
            : [];
    for (const script of scripts) {
        try {
            const value = runAppleScript(script, 4000);
            if (value)
                return value;
        }
        catch { }
    }
    return '';
}
function setCurrentTabUrl(appName, url) {
    const escapedAppName = escapeAppleScriptString(appName);
    const escapedUrl = escapeAppleScriptString(url);
    if (appName === 'Safari') {
        return runAppleScript(`
tell application "Safari"
	activate
	if (count of windows) = 0 then
		make new document with properties {URL:"${escapedUrl}"}
	else
		set URL of current tab of front window to "${escapedUrl}"
	end if
end tell
`, 8000);
    }
    if (CHROMIUM_APPS.has(appName)) {
        return runAppleScript(`
tell application "${escapedAppName}"
	activate
	if (count of windows) = 0 then
		make new window
	end if
	set URL of active tab of front window to "${escapedUrl}"
end tell
`, 8000);
    }
    throw new Error(`Unsupported browser app: ${appName}`);
}
function parseBrowserJson(text) {
    if (!text)
        return {};
    try {
        return JSON.parse(text);
    }
    catch (err) {
        return { ok: false, error: `Invalid browser JSON: ${err.message}` };
    }
}
function pageInfoScript() {
    return `
(() => JSON.stringify({
  ok: true,
  href: String(window.location.href || ''),
  title: String(document.title || ''),
  host: String(window.location.host || '')
}))();
`.trim();
}
function clickByTextScript(targetText) {
    return `
(() => {
  const wanted = ${JSON.stringify(String(targetText || '').trim())};
  const wantedLower = wanted.toLowerCase();
  const interactiveSelector = [
    'a',
    'button',
    '[role="button"]',
    '[role="link"]',
    '[tabindex]',
    '[aria-label]',
    'yt-formatted-string',
    'tp-yt-paper-item',
    'ytd-guide-entry-renderer',
    'ytd-rich-grid-media'
  ].join(',');
  const visible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const textFor = (el) => {
    const raw = el?.innerText || el?.textContent || el?.getAttribute?.('aria-label') || el?.title || '';
    return String(raw).replace(/\\s+/g, ' ').trim();
  };
  const actionable = (el) => el?.closest?.('a,button,[role="button"],[role="link"],[tabindex],tp-yt-paper-item,ytd-guide-entry-renderer,ytd-rich-grid-media') || el;
  const seen = new Set();
  const matches = [];
  for (const node of document.querySelectorAll(interactiveSelector)) {
    const actionEl = actionable(node);
    if (!actionEl || seen.has(actionEl)) continue;
    seen.add(actionEl);
    if (!visible(actionEl)) continue;
    const text = textFor(actionEl);
    if (!text) continue;
    const normalized = text.toLowerCase();
    if (!normalized.includes(wantedLower)) continue;
    matches.push({ el: actionEl, text, exact: normalized === wantedLower, startsWith: normalized.startsWith(wantedLower), href: actionEl.href || null });
  }
  const exact = matches.filter((m) => m.exact);
  const starts = matches.filter((m) => m.startsWith);
  let choice = null;
  if (exact.length === 1) choice = exact[0];
  else if (exact.length > 1) {
    return JSON.stringify({ ok: false, ambiguous: true, count: exact.length, labels: exact.slice(0, 5).map((m) => m.text) });
  } else if (starts.length === 1) choice = starts[0];
  else if (starts.length > 1) {
    return JSON.stringify({ ok: false, ambiguous: true, count: starts.length, labels: starts.slice(0, 5).map((m) => m.text) });
  } else if (matches.length === 1) choice = matches[0];
  else if (matches.length > 1) {
    return JSON.stringify({ ok: false, ambiguous: true, count: matches.length, labels: matches.slice(0, 5).map((m) => m.text) });
  }
  if (!choice) {
    return JSON.stringify({ ok: false, notFound: true, count: 0, labels: [] });
  }
  choice.el.click();
  return JSON.stringify({ ok: true, text: choice.text, href: choice.href, count: matches.length });
})();
`.trim();
}
function genericSearchScript(query) {
    return `
(() => {
  const query = ${JSON.stringify(String(query || '').trim())};
  const candidates = Array.from(document.querySelectorAll([
    'input[type="search"]',
    'input[aria-label*="search" i]',
    'input[placeholder*="search" i]',
    '[role="searchbox"]',
    'input[name*="search" i]',
    'textarea[aria-label*="search" i]'
  ].join(',')));
  const visible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const target = candidates.find(visible) || document.activeElement;
  if (!target || typeof target.focus !== 'function') {
    return JSON.stringify({ ok: false, notFound: true });
  }
  target.focus();
  const proto = Object.getPrototypeOf(target);
  const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(target, query);
  else target.value = query;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  if (target.form?.requestSubmit) {
    target.form.requestSubmit();
  } else if (target.form?.submit) {
    target.form.submit();
  } else {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    target.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true }));
    target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
  }
  return JSON.stringify({ ok: true, query, submitted: true });
})();
`.trim();
}
function youtubeSearchScript(query) {
    return `
(() => {
  const query = ${JSON.stringify(String(query || '').trim())};
  if (!query) return JSON.stringify({ ok: false, error: 'Missing query' });
  const nextUrl = '/results?search_query=' + encodeURIComponent(query);
  window.location.href = nextUrl;
  return JSON.stringify({ ok: true, query, href: nextUrl, submitted: true });
})();
	`.trim();
}
function youtubeClickFirstChannelResultScript() {
    return `
(() => {
  const visible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const candidates = [
    ...document.querySelectorAll('ytd-channel-renderer a#main-link'),
    ...document.querySelectorAll('ytd-channel-renderer a.yt-simple-endpoint'),
    ...document.querySelectorAll('a[href^="/@"]'),
    ...document.querySelectorAll('a[href*="/channel/"]')
  ];
  const target = candidates.find(visible);
  if (!target) return JSON.stringify({ ok: false, notFound: true });
  const href = target.href || target.getAttribute('href') || '';
  const text = String(target.innerText || target.textContent || target.getAttribute('aria-label') || '').trim();
  target.click();
  return JSON.stringify({ ok: true, href, text });
})();
`.trim();
}
function verifySignalScript(signal) {
    return `
(() => {
  const wanted = ${JSON.stringify(String(signal || '').trim().toLowerCase())};
  if (!wanted) return JSON.stringify({ ok: true, matched: true, location: window.location.href, title: document.title });
  const haystacks = [
    String(window.location.href || '').toLowerCase(),
    String(document.title || '').toLowerCase(),
    String(document.body?.innerText || '').toLowerCase()
  ];
  const matched = haystacks.some((text) => text.includes(wanted));
  return JSON.stringify({ ok: matched, matched, location: window.location.href, title: document.title });
})();
`.trim();
}
function mediaControlScript(action) {
    return `
(() => {
  const wanted = ${JSON.stringify(String(action || 'pause').trim().toLowerCase())};
  const media = Array.from(document.querySelectorAll('video,audio')).find((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  if (!media) return JSON.stringify({ ok: false, error: 'No visible media element found' });
  if (wanted === 'pause') {
    media.pause();
  } else {
    const playPromise = media.play?.();
    if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
  }
  return JSON.stringify({ ok: true, paused: !!media.paused, currentTime: Number(media.currentTime || 0) });
})();
`.trim();
}
class BrowserAdapter {
    isSupported(appName) {
        return appName === 'Safari' || CHROMIUM_APPS.has(appName);
    }
    openUrl({ appName, url }) {
        const normalizedUrl = normalizeUrl(url);
        if (!this.isSupported(appName)) {
            return { ok: false, code: 'unsupported_app', error: `Unsupported browser app: ${appName}` };
        }
        if (!normalizedUrl) {
            return { ok: false, code: 'invalid_url', error: `Invalid URL: ${url}` };
        }
        const currentUrl = getBrowserUrl(appName);
        if (currentUrl && canonicalUrl(currentUrl) === canonicalUrl(normalizedUrl)) {
            return {
                ok: true,
                resolutionMethod: 'adapter',
                result: `Already on ${normalizedUrl} in ${appName}`,
                url: normalizedUrl,
            };
        }
        try {
            setCurrentTabUrl(appName, normalizedUrl);
        }
        catch {
            const proc = spawnSync('open', ['-a', appName, normalizedUrl], { encoding: 'utf-8', timeout: 8000 });
            if (proc.error || proc.status !== 0) {
                return {
                    ok: false,
                    code: 'open_failed',
                    error: (proc.error?.message || proc.stderr || proc.stdout || `Failed to open ${normalizedUrl}`).trim(),
                };
            }
        }
        return {
            ok: true,
            resolutionMethod: 'adapter',
            result: `Opened ${normalizedUrl} in ${appName}`,
            url: normalizedUrl,
        };
    }
    clickByText({ appName, text }) {
        if (!this.isSupported(appName)) {
            return { ok: false, code: 'unsupported_app', error: `Unsupported browser app: ${appName}` };
        }
        try {
            const parsed = parseBrowserJson(runBrowserJavaScript(appName, clickByTextScript(text)));
            if (parsed.ok) {
                return {
                    ok: true,
                    resolutionMethod: 'adapter',
                    result: `Clicked "${parsed.text}" in ${appName}`,
                    matchedText: parsed.text,
                };
            }
            if (parsed.ambiguous) {
                return {
                    ok: false,
                    code: 'ambiguous',
                    error: `Multiple visible matches for "${text}"`,
                    matches: parsed.labels || [],
                };
            }
            return {
                ok: false,
                code: parsed.notFound ? 'not_found' : 'browser_action_failed',
                error: parsed.error || `Could not find "${text}" in ${appName}`,
            };
        }
        catch (err) {
            return { ok: false, code: 'browser_action_failed', error: err.message };
        }
    }
    getCurrentPageInfo({ appName }) {
        if (!this.isSupported(appName)) {
            return { ok: false, code: 'unsupported_app', error: `Unsupported browser app: ${appName}` };
        }
        const href = getBrowserUrl(appName);
        const title = getBrowserTitle(appName);
        if (href || title) {
            let host = '';
            try {
                host = href ? new URL(normalizeUrl(href)).host : '';
            }
            catch { }
            return {
                ok: true,
                href,
                host,
                title,
            };
        }
        try {
            const parsed = parseBrowserJson(runBrowserJavaScript(appName, pageInfoScript()));
            if (parsed.ok === false)
                return parsed;
            return {
                ok: true,
                href: parsed.href || '',
                host: parsed.host || '',
                title: parsed.title || '',
            };
        }
        catch (err) {
            return { ok: false, code: 'page_info_failed', error: err.message };
        }
    }
    searchInPage({ appName, query }) {
        if (!this.isSupported(appName)) {
            return { ok: false, code: 'unsupported_app', error: `Unsupported browser app: ${appName}` };
        }
        const pageInfo = this.getCurrentPageInfo({ appName });
        const host = String(pageInfo.host || '').toLowerCase();
        if (host.endsWith('youtube.com')) {
            const targetUrl = `https://${host || 'www.youtube.com'}/results?search_query=${encodeURIComponent(query)}`;
            return this.openUrl({ appName, url: targetUrl });
        }
        const script = genericSearchScript(query);
        try {
            const parsed = parseBrowserJson(runBrowserJavaScript(appName, script));
            if (parsed.ok) {
                return {
                    ok: true,
                    resolutionMethod: 'adapter',
                    result: `Searched for "${query}" in ${appName}`,
                    query,
                    href: parsed.href || pageInfo.href || '',
                    host,
                };
            }
            return {
                ok: false,
                code: parsed.notFound ? 'not_found' : 'browser_action_failed',
                error: parsed.error || `Could not search for "${query}" in ${appName}`,
            };
        }
        catch (err) {
            return { ok: false, code: 'browser_action_failed', error: err.message };
        }
    }
    clickFirstSearchResult({ appName, resultKind }) {
        if (!this.isSupported(appName)) {
            return { ok: false, code: 'unsupported_app', error: `Unsupported browser app: ${appName}` };
        }
        const pageInfo = this.getCurrentPageInfo({ appName });
        const host = String(pageInfo.host || '').toLowerCase();
        if (resultKind === 'channel' && host.endsWith('youtube.com')) {
            try {
                const parsed = parseBrowserJson(runBrowserJavaScript(appName, youtubeClickFirstChannelResultScript()));
                if (parsed.ok) {
                    return {
                        ok: true,
                        resolutionMethod: 'adapter',
                        result: `Clicked the first YouTube channel result in ${appName}`,
                        href: parsed.href || '',
                        text: parsed.text || '',
                    };
                }
                return {
                    ok: false,
                    code: parsed.notFound ? 'not_found' : 'browser_action_failed',
                    error: parsed.error || `Could not click the first ${resultKind} result in ${appName}`,
                };
            }
            catch (err) {
                return { ok: false, code: 'browser_action_failed', error: err.message };
            }
        }
        return { ok: false, code: 'unsupported_result_kind', error: `Unsupported result click for ${resultKind || 'unknown'} in ${appName}` };
    }
    verifySignal({ appName, signal }) {
        if (!this.isSupported(appName)) {
            return { ok: false, code: 'unsupported_app', error: `Unsupported browser app: ${appName}` };
        }
        const pageInfo = this.getCurrentPageInfo({ appName });
        const wanted = String(signal || '').trim().toLowerCase();
        const currentUrl = String(pageInfo.href || '').toLowerCase();
        const currentTitle = String(pageInfo.title || '').toLowerCase();
        if (wanted && (currentUrl.includes(wanted) || currentTitle.includes(wanted))) {
            return {
                ok: true,
                resolutionMethod: 'adapter',
                result: `Verified "${signal}" in ${appName}`,
                location: pageInfo.href || '',
                title: pageInfo.title || '',
            };
        }
        try {
            const parsed = parseBrowserJson(runBrowserJavaScript(appName, verifySignalScript(signal)));
            if (parsed.ok) {
                return {
                    ok: true,
                    resolutionMethod: 'adapter',
                    result: `Verified "${signal}" in ${appName}`,
                    location: parsed.location,
                    title: parsed.title,
                };
            }
        }
        catch { }
        return {
            ok: false,
            code: 'verify_failed',
            error: `Verification signal "${signal}" not found in ${appName}`,
            location: pageInfo.href || '',
            title: pageInfo.title || '',
        };
    }
    controlMedia({ appName, action }) {
        if (!this.isSupported(appName)) {
            return { ok: false, code: 'unsupported_app', error: `Unsupported browser app: ${appName}` };
        }
        try {
            const parsed = parseBrowserJson(runBrowserJavaScript(appName, mediaControlScript(action)));
            if (parsed.ok) {
                const pastTense = String(action || 'pause').toLowerCase() === 'pause' ? 'Paused' : 'Played';
                return {
                    ok: true,
                    resolutionMethod: 'adapter',
                    result: `${pastTense} media in ${appName}`,
                    paused: Boolean(parsed.paused),
                };
            }
            return {
                ok: false,
                code: 'media_control_failed',
                error: parsed.error || `Could not ${action} media in ${appName}`,
            };
        }
        catch (err) {
            return { ok: false, code: 'media_control_failed', error: err.message };
        }
    }
}
module.exports = {
    BrowserAdapter,
    canonicalUrl,
    normalizeUrl,
};
