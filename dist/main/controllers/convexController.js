"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
const electron_1 = require("electron");
const ch = __importStar(require("../../shared/channels"));
const convexStore = __importStar(require("../convex-store"));
const service_ref_1 = require("../automation/service-ref");
function register() {
    electron_1.ipcMain.on(ch.NEW_CONVEX_SESSION, () => {
        convexStore.newSession();
    });
    electron_1.ipcMain.on(ch.END_CONVEX_SESSION, () => {
        convexStore.endSession();
    });
    electron_1.ipcMain.on(ch.SAVE_CONVERSATION_TURN, (_, role, text) => {
        convexStore.saveTurn(role, text);
        (0, service_ref_1.getLearningManager)()?.recordConversationTurn?.(role, text);
    });
    electron_1.ipcMain.handle(ch.SEMANTIC_SEARCH, (_, query, limit, roleFilter) => {
        return convexStore.semanticSearch(query, limit, roleFilter);
    });
}
