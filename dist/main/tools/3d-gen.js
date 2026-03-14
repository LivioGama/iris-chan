"use strict";
// Tool handler: 3D model generation from images via DreamGaussian
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const log = require('../logger');
async function generate_3d_model(args) {
    const imagePath = args.image_path || args.image || '';
    const prompt = args.prompt || '';
    const outputDir = args.output_dir || path.join(process.env.HOME, 'Desktop', 'iris-3d-models');
    if (!imagePath) {
        return { ok: false, result: 'Missing image_path parameter' };
    }
    // Validate image exists
    if (!fs.existsSync(imagePath)) {
        return { ok: false, result: `Image not found: ${imagePath}` };
    }
    return new Promise((resolve) => {
        // Use macOS-optimized script (Metal GPU acceleration)
        const isMac = process.platform === 'darwin';
        const scriptName = isMac ? 'image-to-3d-macos.py' : 'dreamgaussian-gen.py';
        const scriptPath = path.join(__dirname, '..', '..', 'scripts', scriptName);
        if (!fs.existsSync(scriptPath)) {
            return resolve({
                ok: false,
                result: `DreamGaussian script not found at ${scriptPath}. Run setup first.`
            });
        }
        // Build command arguments
        const args_list = [scriptPath, imagePath, '--json', '--output', outputDir];
        if (prompt) {
            args_list.push('--prompt', prompt);
        }
        log.info('3D-Gen', `Launching DreamGaussian for: ${imagePath}`);
        // Spawn Python process
        const proc = spawn('python3', args_list, {
            timeout: 900000, // 15 minutes max
        });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
            log.info('3D-Gen', `[stderr] ${data.toString().trim()}`);
        });
        proc.on('error', (err) => {
            log.error('3D-Gen', `Process error: ${err.message}`);
            resolve({ ok: false, result: `Process error: ${err.message}` });
        });
        proc.on('close', (code) => {
            if (code !== 0) {
                log.error('3D-Gen', `Python process exited with code ${code}`);
                return resolve({
                    ok: false,
                    result: `Generation failed (exit code ${code}): ${stderr}`
                });
            }
            try {
                const result = JSON.parse(stdout);
                if (result.ok) {
                    log.info('3D-Gen', `✓ Generated: ${result.glb_path}`);
                }
                else {
                    log.error('3D-Gen', `Generation error: ${result.error}`);
                }
                resolve(result);
            }
            catch (e) {
                log.error('3D-Gen', `Failed to parse output: ${e.message}`);
                resolve({
                    ok: false,
                    result: `Output parse error: ${e.message}\n${stdout}`
                });
            }
        });
    });
}
async function check_3d_setup(args) {
    /**
     * Check if DreamGaussian is properly installed and configured
     */
    try {
        const { execSync } = require('child_process');
        // Check Python
        const pythonVersion = execSync('python3 --version', { encoding: 'utf-8' });
        log.info('3D-Gen', `Python: ${pythonVersion.trim()}`);
        // Check CUDA
        let cudaStatus = 'Not available';
        try {
            const cudaCheck = execSync('python3 -c "import torch; print(torch.cuda.is_available())"', { encoding: 'utf-8' });
            cudaStatus = cudaCheck.trim() === 'True' ? 'Available ✓' : 'Not detected';
        }
        catch { }
        // Check DreamGaussian
        let dgStatus = 'Not installed';
        try {
            execSync('python3 -c "import dreamer_gaussian"', { encoding: 'utf-8' });
            dgStatus = 'Installed ✓';
        }
        catch { }
        return {
            ok: true,
            result: `3D Generation Setup Status:\n- Python: ${pythonVersion.trim()}\n- CUDA: ${cudaStatus}\n- DreamGaussian: ${dgStatus}\n\nTo install: pip install -r requirements-3d.txt`
        };
    }
    catch (err) {
        return { ok: false, result: `Setup check error: ${err.message}` };
    }
}
module.exports = {
    generate_3d_model,
    check_3d_setup,
};
