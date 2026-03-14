"use strict";
let convexClient = null;
function setConvexClient(client) {
    convexClient = client;
}
function getConvexClient() {
    if (!convexClient) {
        throw new Error('Convex client not initialized in adapter');
    }
    return convexClient;
}
module.exports = {
    setConvexClient,
    getConvexClient,
};
