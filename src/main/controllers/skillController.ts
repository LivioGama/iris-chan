import { ipcMain } from 'electron';
import * as ch from '../../shared/channels';
import * as skills from '../skills';

export function register() {
    ipcMain.handle(ch.GET_SKILL_DECLARATIONS, () => skills.getDeclarations());
    ipcMain.handle(ch.GET_SKILL_PROMPTS, () => skills.getSystemPrompts());
    ipcMain.handle(ch.GET_SKILL_CATALOG, () => skills.getCatalog());

    ipcMain.handle(ch.KILL_SKILL, () => skills.killSkill());

    // Run skill by name (e.g., 'ship', 'claude-code-assistant')
    ipcMain.handle(ch.RUN_SKILL, async (_, skillName: string, args: any) => {
        try {
            const result = await skills.runSkillByName(skillName, args || {});
            return result;
        } catch (err: any) {
            return { ok: false, result: `Skill error: ${err.message}` };
        }
    });
}
