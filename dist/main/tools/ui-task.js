"use strict";
const { getUiTaskService } = require('../automation/service-ref');
async function run_ui_task(args) {
    const service = getUiTaskService();
    if (!service) {
        return { ok: false, result: 'UI task service is not available' };
    }
    return service.runTask(args || {});
}
module.exports = {
    run_ui_task,
};
