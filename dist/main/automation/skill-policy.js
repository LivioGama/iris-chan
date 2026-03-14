"use strict";
function normalizeText(value = '') {
    return String(value || '').toLowerCase().replace(/["'`]/g, '').replace(/\s+/g, ' ').trim();
}
function inferGoalCapabilities(goal = '') {
    const text = normalizeText(goal);
    const caps = new Set();
    if (!text)
        return caps;
    if (/\bopen\b|\blaunch\b|\bstart\b/.test(text))
        caps.add('open');
    if (/\bgo to\b|\bnavigate\b|\bvisit\b/.test(text))
        caps.add('navigate');
    if (/\bsearch\b|\bfind\b/.test(text))
        caps.add('search');
    if (/\bclick\b|\bopen that\b|\bgo to that\b/.test(text))
        caps.add('click');
    if (/\bselect\b/.test(text))
        caps.add('select');
    if (/\btype\b|\benter\b|\bwrite\b/.test(text))
        caps.add('type');
    if (/\bpause\b/.test(text))
        caps.add('pause');
    if (/\bplay\b|\bresume\b/.test(text))
        caps.add('play');
    if (/\bback\b/.test(text))
        caps.add('back');
    if (/\bforward\b/.test(text))
        caps.add('forward');
    if (/\bscroll\b/.test(text))
        caps.add('scroll');
    if (/\bsave\b/.test(text))
        caps.add('save');
    if (/\bundo\b/.test(text))
        caps.add('undo');
    if (/\bredo\b/.test(text))
        caps.add('redo');
    if (/\bfind\b|\bsearch in file\b/.test(text))
        caps.add('find');
    if (/\bnew file\b/.test(text))
        caps.add('newfile');
    if (/\bcopy\b/.test(text))
        caps.add('copy');
    if (/\bcut\b/.test(text))
        caps.add('cut');
    if (/\bpaste\b/.test(text))
        caps.add('paste');
    if (/\bselect all\b/.test(text))
        caps.add('selectall');
    if (/\bclose file\b|\bclose tab\b/.test(text))
        caps.add('closefile');
    if (/\bdefault browser\b/.test(text))
        caps.add('defaultbrowser');
    if (/\bdefault mail\b/.test(text))
        caps.add('defaultmail');
    return caps;
}
function inferPlanCapabilities(plan = {}) {
    const caps = new Set();
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    for (const step of steps) {
        switch (step?.type) {
            case 'openApp':
                caps.add('open');
                break;
            case 'openUrl':
                caps.add('open');
                caps.add('navigate');
                break;
            case 'searchInCurrentContext':
                caps.add('search');
                break;
            case 'clickElement':
            case 'clickSearchResult':
                caps.add('click');
                break;
            case 'selectItemByText':
                caps.add('select');
                break;
            case 'setElementValue':
                caps.add('type');
                break;
            case 'navigateHistory':
                caps.add(step.direction === 'forward' ? 'forward' : 'back');
                break;
            case 'scrollUntilVisible':
                caps.add('scroll');
                break;
            case 'editorCommand':
                if (step.action === 'save')
                    caps.add('save');
                if (step.action === 'undo')
                    caps.add('undo');
                if (step.action === 'redo')
                    caps.add('redo');
                if (step.action === 'find')
                    caps.add('find');
                if (step.action === 'newFile')
                    caps.add('newfile');
                if (step.action === 'copy')
                    caps.add('copy');
                if (step.action === 'cut')
                    caps.add('cut');
                if (step.action === 'paste')
                    caps.add('paste');
                if (step.action === 'selectAll')
                    caps.add('selectall');
                if (step.action === 'closeFile')
                    caps.add('closefile');
                break;
            case 'resolveSystemDefault':
                if (step.kind === 'browser')
                    caps.add('defaultbrowser');
                if (step.kind === 'mail')
                    caps.add('defaultmail');
                break;
            default:
                break;
        }
    }
    return caps;
}
function planLikelySatisfiesGoal(goal = '', plan = {}) {
    const goalCaps = inferGoalCapabilities(goal);
    if (!goalCaps.size)
        return true;
    const planCaps = inferPlanCapabilities(plan);
    for (const cap of goalCaps) {
        if (!planCaps.has(cap))
            return false;
    }
    return true;
}
function inferDomain(text = '') {
    const normalized = normalizeText(text);
    if (/\bbrowser\b|\byoutube\b|\barc\b|\bsafari\b|\bchrome\b|\bedge\b/.test(normalized))
        return 'browser';
    if (/\bfinder\b|\bfile\b|\bfolder\b|\bdesktop\b|\bdownloads\b/.test(normalized))
        return 'finder';
    if (/\bvisual studio code\b|\bcode\b|\bcursor\b|\bzed\b|\bsublime text\b|\bnova\b|\btextedit\b|\btext edit\b|\beditor\b/.test(normalized))
        return 'editor';
    if (/\bvideo\b|\bmusic\b|\bpause\b|\bplay\b/.test(normalized))
        return 'media';
    if (/\bdefault\b|\bsettings\b|\bsystem\b|\bactivity monitor\b|\bconsole\b|\bdisk utility\b|\bsystem information\b/.test(normalized))
        return 'system';
    return 'general';
}
module.exports = {
    normalizeText,
    inferGoalCapabilities,
    inferPlanCapabilities,
    planLikelySatisfiesGoal,
    inferDomain,
};
