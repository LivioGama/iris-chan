const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const log = require('../logger');

const FLASH_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

function gatherProjectContext(projectPath) {
	const ctx = [];

	// package.json
	const pkgPath = path.join(projectPath, 'package.json');
	if (fs.existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
			ctx.push(`Project: ${pkg.name || 'unknown'} — ${pkg.description || ''}`);
			if (pkg.dependencies) ctx.push(`Dependencies: ${Object.keys(pkg.dependencies).join(', ')}`);
		} catch {}
	}

	// CLAUDE.md
	const claudePath = path.join(projectPath, 'CLAUDE.md');
	if (fs.existsSync(claudePath)) {
		try {
			ctx.push(`CLAUDE.md:\n${fs.readFileSync(claudePath, 'utf8').substring(0, 2000)}`);
		} catch {}
	}

	// src/ tree (shallow)
	try {
		const tree = execSync(`find "${projectPath}/src" -maxdepth 3 -type f -name "*.ts" -o -name "*.js" -o -name "*.tsx" -o -name "*.jsx" 2>/dev/null | head -50`, { encoding: 'utf8', timeout: 3000 });
		if (tree.trim()) ctx.push(`Source files:\n${tree.trim()}`);
	} catch {}

	return ctx.join('\n\n');
}

async function enrichPrompt(rawPrompt, projectPath) {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) {
		log.warn('Enricher', 'No GEMINI_API_KEY, returning raw prompt');
		return { enrichedPrompt: rawPrompt, impactedFiles: [], complexity: 'unknown' };
	}

	const context = gatherProjectContext(projectPath);

	const systemPrompt = `You are a project analyst. Given a user's vague task description and project context, produce a structured task specification.

Return a JSON object with:
- enrichedPrompt: string — detailed, actionable prompt for a coding agent (include specific files, expected behavior, edge cases)
- impactedFiles: string[] — list of files likely to be modified
- complexity: "trivial" | "small" | "medium" | "large"

Respond ONLY with valid JSON, no markdown fences.`;

	const userPrompt = `Project path: ${projectPath}

${context}

User's raw task: "${rawPrompt}"`;

	try {
		const res = await fetch(`${FLASH_ENDPOINT}?key=${apiKey}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				contents: [{ parts: [{ text: userPrompt }] }],
				systemInstruction: { parts: [{ text: systemPrompt }] },
				generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
			}),
		});

		if (!res.ok) {
			log.warn('Enricher', `Gemini Flash error: HTTP ${res.status}`);
			return { enrichedPrompt: rawPrompt, impactedFiles: [], complexity: 'unknown' };
		}

		const json = await res.json();
		const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';

		// Parse JSON from response (handle possible markdown fences)
		const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
		const parsed = JSON.parse(cleaned);

		return {
			enrichedPrompt: parsed.enrichedPrompt || rawPrompt,
			impactedFiles: parsed.impactedFiles || [],
			complexity: parsed.complexity || 'unknown',
		};
	} catch (err) {
		log.warn('Enricher', `Enrichment failed: ${err.message}`);
		return { enrichedPrompt: rawPrompt, impactedFiles: [], complexity: 'unknown' };
	}
}

module.exports = { enrichPrompt, gatherProjectContext };
