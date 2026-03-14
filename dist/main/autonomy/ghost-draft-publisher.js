"use strict";
const crypto = require('node:crypto');
function base64Url(input) {
    return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function signJwt(keyId, secretHex) {
    const nowSec = Math.floor(Date.now() / 1000);
    const header = { alg: 'HS256', typ: 'JWT', kid: keyId };
    const payload = {
        iat: nowSec,
        exp: nowSec + 5 * 60,
        aud: '/admin/',
    };
    const headerEncoded = base64Url(JSON.stringify(header));
    const payloadEncoded = base64Url(JSON.stringify(payload));
    const body = `${headerEncoded}.${payloadEncoded}`;
    const signature = crypto.createHmac('sha256', Buffer.from(secretHex, 'hex')).update(body).digest('base64')
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${body}.${signature}`;
}
async function createGhostDraft({ apiUrl, adminApiKey, title, html, tags = [] }) {
    if (!apiUrl || !adminApiKey) {
        return { ok: false, error: 'Ghost API URL or admin key missing' };
    }
    const [keyId, secret] = String(adminApiKey).split(':');
    if (!keyId || !secret) {
        return { ok: false, error: 'Invalid Ghost admin key format' };
    }
    const token = signJwt(keyId, secret);
    const body = {
        posts: [
            {
                title,
                html,
                status: 'draft',
                tags,
            },
        ],
    };
    const res = await fetch(`${apiUrl.replace(/\/$/, '')}/ghost/api/admin/posts/?source=html`, {
        method: 'POST',
        headers: {
            Authorization: `Ghost ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        return { ok: false, error: await res.text() };
    }
    const json = await res.json();
    return { ok: true, draft: json.posts?.[0] || null };
}
module.exports = { createGhostDraft };
