// Procedural overlays: head, fingers, blink, lip-sync

export function applyOverlays(vrm, time, getSpeakingVolume) {
	const h = vrm.humanoid;
	if (!h) return;

	// Head look-around
	const head = h.getNormalizedBoneNode('head');
	if (head) {
		head.rotation.y = Math.sin(time * 0.3) * 0.12 + Math.sin(time * 0.13) * 0.06;
		head.rotation.x = Math.sin(time * 0.5) * 0.05;
		head.rotation.z = Math.sin(time * 0.4 + 1.0) * 0.04;
	}

	// Fingers — relaxed curl with gentle movement
	const curl = 0.2 + Math.sin(time * 0.35) * 0.08;
	for (const side of ['right', 'left']) {
		const sign = side === 'right' ? -1 : 1;
		for (const finger of ['Index', 'Middle', 'Ring', 'Little']) {
			const prox = h.getNormalizedBoneNode(`${side}${finger}Proximal`);
			const inter = h.getNormalizedBoneNode(`${side}${finger}Intermediate`);
			const dist = h.getNormalizedBoneNode(`${side}${finger}Distal`);
			const offset = { Index: 0, Middle: 0.15, Ring: 0.3, Little: 0.45 }[finger];
			const fc = curl + Math.sin(time * 0.4 + offset) * 0.05;
			if (prox) prox.rotation.z = sign * fc;
			if (inter) inter.rotation.z = sign * fc * 1.1;
			if (dist) dist.rotation.z = sign * fc * 0.8;
		}
		const tMeta = h.getNormalizedBoneNode(`${side}ThumbMetacarpal`);
		const tProx = h.getNormalizedBoneNode(`${side}ThumbProximal`);
		const tDist = h.getNormalizedBoneNode(`${side}ThumbDistal`);
		if (tMeta) tMeta.rotation.z = sign * 0.15;
		if (tProx) tProx.rotation.z = sign * (0.1 + Math.sin(time * 0.3) * 0.05);
		if (tDist) tDist.rotation.z = sign * 0.1;
	}

	// Expressions
	const expr = vrm.expressionManager;
	if (expr) {
		const blinkInterval = 6.0 + Math.sin(time * 0.13) * 2.0;
		const blinkPhase = time % blinkInterval;
		let blinkVal = 0;
		if (blinkPhase < 0.12) {
			blinkVal = Math.sin((blinkPhase / 0.12) * Math.PI);
		}
		expr.setValue('blink', blinkVal);

		// Lip sync from playback volume
		const vol = getSpeakingVolume();
		if (vol > 0.01) {
			const open = Math.min(1, vol * 4);
			expr.setValue('aa', open * 0.7);
			expr.setValue('oh', open * 0.3);
			expr.setValue('happy', 0.15);
		} else {
			expr.setValue('aa', 0);
			expr.setValue('oh', 0);
			const smileVal = Math.max(0, Math.sin(time * 0.2) * 0.3);
			expr.setValue('happy', smileVal);
		}
	}
}
