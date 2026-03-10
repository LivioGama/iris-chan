import { ipcMain } from 'electron';
import * as ch from '../../shared/channels';
import * as toolExecutor from '../tools';
import * as screenCapture from '../screen-capture';
import * as convexStore from '../convex-store';

export function register() {
    ipcMain.handle(ch.EXECUTE_TOOL, (_, name: string, args: any) => toolExecutor.execute(name, args));
    ipcMain.handle(ch.CAPTURE_SCREEN, (_, options: any) => screenCapture.capture(options));

    ipcMain.on(ch.SAVE_TOOL_EXECUTION, (_, name: string, args: any, result: any, success: boolean, durationMs: number) => {
        convexStore.saveToolExecution(name, args, result, success, durationMs);
    });
}
