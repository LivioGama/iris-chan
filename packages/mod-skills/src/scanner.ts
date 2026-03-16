// Skill scanner: discovers SKILL.md files in ~/.iris/skills/ subdirectories
// and parses their metadata.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface SkillMetadata {
  name: string;
  description: string;
  version: string;
  trigger?: string;
  entrypoint: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
  dir: string;
}

/**
 * Parse a SKILL.md file for metadata.
 * Expected format:
 * ---
 * name: my-skill
 * description: Does something
 * version: 1.0.0
 * trigger: /myskill
 * entrypoint: run.ts
 * ---
 */
const parseSkillMd = (content: string, dir: string): SkillMetadata | null => {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;

  const frontmatter = fmMatch[1];
  const meta: Record<string, string> = {};

  for (const line of frontmatter.split('\n')) {
    const [key, ...valueParts] = line.split(':');
    if (key && valueParts.length > 0) {
      meta[key.trim()] = valueParts.join(':').trim();
    }
  }

  if (!meta.name) return null;

  // Parse parameters section from markdown
  const parameters: Record<string, { type: string; description: string; required?: boolean }> = {};
  const paramSection = content.match(/## Parameters\n([\s\S]*?)(?:\n## |$)/);
  if (paramSection) {
    const paramLines = paramSection[1].split('\n').filter((l) => l.startsWith('- '));
    for (const line of paramLines) {
      const paramMatch = line.match(/^- `(\w+)`\s*\((\w+)\)(?:\s*\[required\])?\s*:\s*(.+)/);
      if (paramMatch) {
        parameters[paramMatch[1]] = {
          type: paramMatch[2],
          description: paramMatch[3].trim(),
          required: line.includes('[required]'),
        };
      }
    }
  }

  return {
    name: meta.name,
    description: meta.description ?? meta.name,
    version: meta.version ?? '1.0.0',
    trigger: meta.trigger,
    entrypoint: meta.entrypoint ?? 'run.ts',
    parameters,
    dir,
  };
};

/**
 * Scan the skills directory for all valid skills.
 */
export const scanSkills = (skillsDir: string): SkillMetadata[] => {
  const skills: SkillMetadata[] = [];

  if (!existsSync(skillsDir)) return skills;

  const entries = readdirSync(skillsDir);

  for (const entry of entries) {
    const dir = join(skillsDir, entry);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue; // broken symlink or permission error
    }

    const skillMdPath = join(dir, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;

    try {
      const content = readFileSync(skillMdPath, 'utf-8');
      const meta = parseSkillMd(content, dir);
      if (meta) {
        // Verify entrypoint exists
        const entryPath = join(dir, meta.entrypoint);
        if (existsSync(entryPath)) {
          skills.push(meta);
        }
      }
    } catch {
      // Skip invalid skills
    }
  }

  return skills;
};
