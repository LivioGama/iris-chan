"use strict";
// Tool handlers: UI/UX pro skill support
// Provides design-specific interactions and measurements
const { runHelper } = require('../native-helper');
async function wait_for(args) {
    const ms = parseInt(args.milliseconds || args.ms || 500);
    if (ms < 0 || ms > 30000)
        return { ok: false, result: 'Wait time must be 0-30000ms' };
    await new Promise(r => setTimeout(r, ms));
    return { ok: true, result: `Waited ${ms}ms` };
}
async function click_and_wait(args) {
    const x = parseFloat(args.x || 0);
    const y = parseFloat(args.y || 0);
    const wait = parseInt(args.wait_ms || 300);
    await runHelper({
        action: 'click_at',
        x, y,
        button: args.button || 'left',
    });
    if (wait > 0) {
        await new Promise(r => setTimeout(r, wait));
    }
    return { ok: true, result: `Clicked at (${Math.round(x)}, ${Math.round(y)}), waited ${wait}ms` };
}
async function drag_with_snap(args) {
    const x = parseFloat(args.x || 0);
    const y = parseFloat(args.y || 0);
    const x2 = parseFloat(args.x2 || 0);
    const y2 = parseFloat(args.y2 || 0);
    const snapGrid = parseInt(args.snap_grid || 0);
    let endX = x2, endY = y2;
    if (snapGrid > 0) {
        endX = Math.round(x2 / snapGrid) * snapGrid;
        endY = Math.round(y2 / snapGrid) * snapGrid;
    }
    const result = await runHelper({
        action: 'drag',
        x, y, x2: endX, y2: endY,
    });
    return {
        ok: result.ok,
        result: result.result + (snapGrid > 0 ? ` (snapped to ${snapGrid}px grid)` : ''),
    };
}
async function multi_click(args) {
    const x = parseFloat(args.x || 0);
    const y = parseFloat(args.y || 0);
    const count = parseInt(args.count || 1);
    const interval = parseInt(args.interval_ms || 100);
    if (count < 1 || count > 10)
        return { ok: false, result: 'Click count must be 1-10' };
    for (let i = 0; i < count; i++) {
        await runHelper({
            action: 'click_at',
            x, y,
            button: args.button || 'left',
        });
        if (i < count - 1) {
            await new Promise(r => setTimeout(r, interval));
        }
    }
    return { ok: true, result: `Performed ${count} clicks at (${Math.round(x)}, ${Math.round(y)})` };
}
async function measure_vector(args) {
    const x1 = parseFloat(args.x1 || 0);
    const y1 = parseFloat(args.y1 || 0);
    const x2 = parseFloat(args.x2 || 0);
    const y2 = parseFloat(args.y2 || 0);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    return {
        ok: true,
        result: `Vector (${x1},${y1}) → (${x2},${y2}): distance=${Math.round(distance)}px, angle=${Math.round(angle)}°, Δx=${Math.round(dx)}, Δy=${Math.round(dy)}`,
    };
}
async function pause_and_wait(args) {
    // For workflows that need to wait for animations or transitions
    const duration = parseInt(args.duration || 1000);
    const until = args.until || 'animation completes';
    if (duration < 100 || duration > 10000) {
        return { ok: false, result: 'Duration must be 100-10000ms' };
    }
    await new Promise(r => setTimeout(r, duration));
    return { ok: true, result: `Paused for ${duration}ms (waiting for: ${until})` };
}
async function slow_move(args) {
    const x = parseFloat(args.x || 0);
    const y = parseFloat(args.y || 0);
    return runHelper({
        action: 'slow_move',
        x, y,
    });
}
module.exports = {
    wait_for,
    click_and_wait,
    drag_with_snap,
    multi_click,
    measure_vector,
    pause_and_wait,
    slow_move,
};
