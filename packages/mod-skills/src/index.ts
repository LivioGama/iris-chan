import { CH, type BusClient } from '@iris/bus';
import { join } from 'node:path';
import { scanSkills, type SkillMetadata } from './scanner';
import { runSkill } from './runner';
import manifest from '../manifest.json';

interface ModuleContext {
  bus: BusClient;
  settings: unknown;
  env: Record<string, string>;
  paths: { irisDir: string; dataDir: string; logsDir: string; assetsDir: string; projectRoot: string };
  logger: { debug: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

let skills: SkillMetadata[] = [];

export default {
  manifest,

  async start(ctx: ModuleContext) {
    const skillsDir = join(ctx.paths.irisDir, 'skills');
    skills = scanSkills(skillsDir);

    ctx.logger.info(`Discovered ${skills.length} skills in ${skillsDir}`);

    // Register each skill as a tool
    for (const skill of skills) {
      const toolParams: Record<string, unknown> = {};
      for (const [name, param] of Object.entries(skill.parameters)) {
        toolParams[name] = {
          type: param.type.toUpperCase(),
          description: param.description,
        };
      }

      ctx.bus.publish(CH.TOOL_REGISTER, {
        name: `skill_${skill.name}`,
        description: skill.description,
        parameters: {
          type: 'OBJECT',
          properties: toolParams,
          required: Object.entries(skill.parameters)
            .filter(([, p]) => p.required)
            .map(([name]) => name),
        },
        handler: async (args: Record<string, unknown>) => {
          const result = await runSkill(skill, args, ctx.env);
          ctx.bus.publish(CH.SKILL_RESULT, {
            name: skill.name,
            ok: result.ok,
            output: result.output,
            durationMs: result.durationMs,
          });
          return { ok: result.ok, result: result.output || result.error };
        },
      });

      ctx.logger.debug(`Registered skill: ${skill.name} (${skill.entrypoint})`);
    }

    // Publish skill catalog
    ctx.bus.publish(CH.SKILL_CATALOG, {
      skills: skills.map((s) => ({
        name: s.name,
        description: s.description,
        version: s.version,
        trigger: s.trigger,
        parameters: Object.keys(s.parameters),
      })),
    });

    // Handle skill run requests
    ctx.bus.subscribe<{ name: string; args?: Record<string, unknown> }>(
      CH.SKILL_RUN,
      async (msg) => {
        const skill = skills.find((s) => s.name === msg.payload.name);
        if (!skill) {
          ctx.bus.publish(CH.SKILL_RESULT, {
            name: msg.payload.name,
            ok: false,
            error: `Skill "${msg.payload.name}" not found`,
          });
          return;
        }

        const result = await runSkill(skill, msg.payload.args ?? {}, ctx.env);
        ctx.bus.publish(CH.SKILL_RESULT, {
          name: skill.name,
          ok: result.ok,
          output: result.output,
          error: result.error,
          durationMs: result.durationMs,
        });
      },
    );

    ctx.logger.info('Skills module started');
  },

  async stop() {
    skills = [];
  },

  getHealth() {
    return {
      status: 'ok' as const,
      details: {
        skillCount: skills.length,
        skills: skills.map((s) => s.name),
      },
    };
  },
};
