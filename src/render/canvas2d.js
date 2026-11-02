// AeroBlast Pro - 2D Canvas Rendering Engine (발파 패턴 2D 도면 렌더링)
//
// 발파공, 저항선/공간격 라벨, 자유면, 임시 드로잉 프리뷰 등을 editor-canvas에 그린다.

import { state, dom } from '../core/state.js';
import { getGeodesicDistance, segmentNormal, getMapCosLat } from '../patterns/blastPatterns.js';
import { calculateCorrectedPitch, estimateBoundingBoxCount } from '../core/blastEngine.js';

const EXPLOSION_DURATION_MS = 500; // 발파 시뮬레이션 기폭 애니메이션 지속시간(확대+페이드 전체)

export function screenToWorld(sX, sY) {
    if (state.map && !state.canvasMode) {
        const coord = state.map.getCoordinateFromPixel([sX, sY]);
        if (coord) {
            return { x: coord[0], y: coord[1] };
        }
    }
    return {
        x: (sX - state.panX) / state.zoom,
        y: (sY - state.panY) / state.zoom
    };
}

export function worldToScreen(wX, wY) {
    if (state.map && !state.canvasMode) {
        const pixel = state.map.getPixelFromCoordinate([wX, wY]);
        if (pixel) {
            return { x: pixel[0], y: pixel[1] };
        }
    }
    return {
        x: wX * state.zoom + state.panX,
        y: wY * state.zoom + state.panY
    };
}

export function drawPreviewLabel(ctx, x, y, text, color) {
    // NOTE: x/y here are already screen-pixel coordinates (from w2s()/worldToScreen()),
    // so sizing must stay in fixed screen pixels — do not divide by state.zoom again.
    ctx.save();
    ctx.fillStyle = 'rgba(10, 13, 20, 0.85)';

    ctx.font = `10px Outfit`;
    const textWidth = ctx.measureText(text).width;
    const paddingX = 6;
    const paddingY = 4;
    const boxW = textWidth + paddingX * 2;
    const boxH = 12 + paddingY * 2;

    ctx.fillRect(x - boxW/2, y - boxH/2, boxW, boxH);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - boxW/2, y - boxH/2, boxW, boxH);
    
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
}

export function draw2D() {
    const ctx = dom.ctx;
    const w = dom.canvas.width;
    const h = dom.canvas.height;
    
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    
    if (state.map && !state.canvasMode) {
        state.zoom = 1.0; // Draw elements in fixed screen pixel coordinates
        const view = state.map.getView();
        const res = view.getResolution();
        const center = view.getCenter();
        if (center) {
            const lonLat = ol.proj.toLonLat(center, view.getProjection());
            const latRad = lonLat[1] * Math.PI / 180;
            state.scaleFactor = res * Math.cos(latRad);
        } else {
            state.scaleFactor = res;
        }
    } else {
        // Draw a professional major/minor grid, spaced in real meters (worldUnit = meter / scaleFactor)
        // so grid lines represent true 10m/1m regardless of zoom or calibration.
        const majorSizeWorld = 10 / state.scaleFactor;
        const minorSizeWorld = 1 / state.scaleFactor;

        const startWorld = screenToWorld(0, 0);
        const endWorld = screenToWorld(w, h);

        const drawGridPass = (gridSize, strokeStyle, dash) => {
            ctx.strokeStyle = strokeStyle;
            ctx.lineWidth = 1;
            ctx.setLineDash(dash);

            const startX = Math.floor(startWorld.x / gridSize) * gridSize;
            const endX = Math.ceil(endWorld.x / gridSize) * gridSize;
            const startY = Math.floor(startWorld.y / gridSize) * gridSize;
            const endY = Math.ceil(endWorld.y / gridSize) * gridSize;

            for (let x = startX; x <= endX; x += gridSize) {
                const sPt = worldToScreen(x, 0);
                ctx.beginPath();
                ctx.moveTo(sPt.x, 0);
                ctx.lineTo(sPt.x, h);
                ctx.stroke();
            }

            for (let y = startY; y <= endY; y += gridSize) {
                const sPt = worldToScreen(0, y);
                ctx.beginPath();
                ctx.moveTo(0, sPt.y);
                ctx.lineTo(w, sPt.y);
                ctx.stroke();
            }

            ctx.setLineDash([]);
        };

        // Minor grid (1m, solid faint) — 10 subdivisions per major cell, like real CAD graph paper.
        // Skip when lines would be denser than 8px apart on screen.
        const minorScreenGap = minorSizeWorld * state.zoom;
        if (minorScreenGap >= 8) {
            drawGridPass(minorSizeWorld, 'rgba(255, 255, 255, 0.05)', []);
        }

        // Major grid (10m, brighter solid)
        drawGridPass(majorSizeWorld, 'rgba(255, 255, 255, 0.14)', []);

        // Draw the origin reference axis ("1차 자유면" 기준선), styled like a real CAD center
        // line (ISO long-dash/short-dash, muted single color) instead of a neon accent color —
        // '#d500f9' stays reserved for the actual user-drawn free face line so the two stay
        // visually distinct. No X/Y text labels — the crosshair alone marks the origin.
        const origin = worldToScreen(0, 0);
        const axisColor = 'rgba(148, 168, 196, 0.5)';

        ctx.strokeStyle = axisColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([12, 3, 2, 3]);

        ctx.beginPath();
        ctx.moveTo(0, origin.y);
        ctx.lineTo(w, origin.y);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(origin.x, 0);
        ctx.lineTo(origin.x, h);
        ctx.stroke();

        ctx.setLineDash([]);

        // Origin crosshair "+"
        ctx.strokeStyle = axisColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(origin.x - 6, origin.y);
        ctx.lineTo(origin.x + 6, origin.y);
        ctx.moveTo(origin.x, origin.y - 6);
        ctx.lineTo(origin.x, origin.y + 6);
        ctx.stroke();

        // (0, 0) label at the origin
        ctx.fillStyle = 'rgba(148, 168, 196, 0.9)';
        ctx.font = '10px Outfit';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('(0, 0)', origin.x + 8, origin.y + 8);

        // Edge ruler ticks + distance labels (10m major spacing), left edge = Y, bottom edge = X.
        // Reuses the same majorSizeWorld/startWorld/endWorld grid pass above so it tracks pan/zoom.
        ctx.fillStyle = 'rgba(148, 168, 196, 0.85)';
        ctx.strokeStyle = 'rgba(148, 168, 196, 0.6)';
        ctx.lineWidth = 1;

        const rulerStartX = Math.floor(startWorld.x / majorSizeWorld) * majorSizeWorld;
        const rulerEndX = Math.ceil(endWorld.x / majorSizeWorld) * majorSizeWorld;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        for (let x = rulerStartX; x <= rulerEndX; x += majorSizeWorld) {
            const meters = Math.round(x * state.scaleFactor);
            if (meters === 0) continue; // origin already labeled above
            const sPt = worldToScreen(x, 0);
            ctx.beginPath();
            ctx.moveTo(sPt.x, h - 8);
            ctx.lineTo(sPt.x, h);
            ctx.stroke();
            ctx.fillText(`${meters}m`, sPt.x, h - 10);
        }

        const rulerStartY = Math.floor(startWorld.y / majorSizeWorld) * majorSizeWorld;
        const rulerEndY = Math.ceil(endWorld.y / majorSizeWorld) * majorSizeWorld;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (let y = rulerStartY; y <= rulerEndY; y += majorSizeWorld) {
            const meters = Math.round(y * state.scaleFactor);
            if (meters === 0) continue;
            const sPt = worldToScreen(0, y);
            ctx.beginPath();
            ctx.moveTo(0, sPt.y);
            ctx.lineTo(8, sPt.y);
            ctx.stroke();
            ctx.fillText(`${meters}m`, 10, sPt.y);
        }

        // Default 1st free-face guide line — a fixed offset in front of the origin so the user
        // always has a design reference before drawing/committing a real free face. Visual only,
        // not written into state.freeFace (which drives actual pattern generation).
        if (state.freeFace.length === 0) {
            const guideY = worldToScreen(0, -6 / state.scaleFactor).y;
            ctx.strokeStyle = '#fde047';
            ctx.lineWidth = 2;
            ctx.setLineDash([10, 6]);
            ctx.beginPath();
            ctx.moveTo(0, guideY);
            ctx.lineTo(w, guideY);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = '#fde047';
            ctx.font = '10px Outfit';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText('1차 자유면 기준선 (가이드)', 10, guideY - 4);
        }
    }

    const w2s = (wx, wy) => worldToScreen(wx, wy);

    // 1. Draw Free Face Line (Cliff edge)
    if (state.freeFace.length > 0) {
        ctx.beginPath();
        const p0 = w2s(state.freeFace[0].x, state.freeFace[0].y);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < state.freeFace.length; i++) {
            const pi = w2s(state.freeFace[i].x, state.freeFace[i].y);
            ctx.lineTo(pi.x, pi.y);
        }
        ctx.strokeStyle = '#d500f9'; // neon purple
        ctx.lineWidth = 4;
        ctx.shadowColor = '#d500f9';
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0; // reset

        // Draw node handles on face
        state.freeFace.forEach((pt, idx) => {
            const sPt = w2s(pt.x, pt.y);
            ctx.beginPath();
            ctx.arc(sPt.x, sPt.y, 6, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#d500f9';
            ctx.stroke();
        });
    }

    // 1b. Draw in-progress Free Face polyline (multi-click drawing preview)
    if (state.tempFreeFace.length > 0) {
        ctx.save();
        ctx.beginPath();
        const p0 = w2s(state.tempFreeFace[0].x, state.tempFreeFace[0].y);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < state.tempFreeFace.length; i++) {
            const pi = w2s(state.tempFreeFace[i].x, state.tempFreeFace[i].y);
            ctx.lineTo(pi.x, pi.y);
        }
        // Rubber-band segment from the last confirmed point to the current cursor
        if (state.tempFreeFaceCursor) {
            const pc = w2s(state.tempFreeFaceCursor.x, state.tempFreeFaceCursor.y);
            ctx.lineTo(pc.x, pc.y);
        }
        ctx.strokeStyle = '#d500f9';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        state.tempFreeFace.forEach(pt => {
            const sPt = w2s(pt.x, pt.y);
            ctx.beginPath();
            ctx.arc(sPt.x, sPt.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#d500f9';
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#fff';
            ctx.stroke();
        });
    }

    // 1c. Free Face 패턴 설정 모달이 열려 있는 동안 배치 방향(천공이 들어갈 쪽)을 화살표로 표시
    if (state.freeFace.length >= 2 && dom.faceModal && !dom.faceModal.classList.contains('hidden')) {
        const dir = state.faceLineDirection;
        const arrowLengthPx = 30;
        const arrowColor = 'rgba(0, 243, 255, 0.9)';

        for (let i = 0; i < state.freeFace.length - 1; i++) {
            const p1 = state.freeFace[i];
            const p2 = state.freeFace[i + 1];
            const s1 = w2s(p1.x, p1.y);
            const s2 = w2s(p2.x, p2.y);

            const ax = (s1.x + s2.x) / 2;
            const ay = (s1.y + s2.y) / 2;

            // 실제 공 배치(offsetPolyline)와 동일하게 월드 좌표계에서 법선 방향을 구한 뒤
            // 화면 좌표로 변환한다 — 지도(OpenLayers) 모드에서는 월드/화면 y축이 서로 뒤집혀 있어
            // 화면 좌표에서 바로 각도를 계산하면 실제 배치 방향과 반대로 보일 수 있기 때문.
            const normal = segmentNormal(p1, p2, dir);
            const midWorldX = (p1.x + p2.x) / 2;
            const midWorldY = (p1.y + p2.y) / 2;
            // 1% of the segment's own world-space length as a probe nudge — kept in the same
            // coordinate units as p1/p2 (raw world units or projected meters) so it never
            // mismatches scaleFactor/projection unit conversions.
            const worldSegLen = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
            const probeDist = Math.max(worldSegLen * 0.01, 1e-6);
            const probeWorld = { x: midWorldX + normal.x * probeDist, y: midWorldY + normal.y * probeDist };
            const sProbe = w2s(probeWorld.x, probeWorld.y);

            const angle = Math.atan2(sProbe.y - ay, sProbe.x - ax);
            const targetX = ax + Math.cos(angle) * arrowLengthPx;
            const targetY = ay + Math.sin(angle) * arrowLengthPx;

            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(targetX, targetY);
            ctx.strokeStyle = arrowColor;
            ctx.lineWidth = 2.5;
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(targetX, targetY);
            ctx.lineTo(targetX - (7) * Math.cos(angle - Math.PI / 6), targetY - (7) * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(targetX - (7) * Math.cos(angle + Math.PI / 6), targetY - (7) * Math.sin(angle + Math.PI / 6));
            ctx.closePath();
            ctx.fillStyle = arrowColor;
            ctx.fill();

            if (i === Math.floor((state.freeFace.length - 1) / 2)) {
                const burdenVal = dom.faceInputBurden ? parseFloat(dom.faceInputBurden.value) : NaN;
                const label = isNaN(burdenVal) ? '천공 방향' : `천공 방향 (저항선 ${burdenVal.toFixed(2)}m)`;
                drawPreviewLabel(ctx, targetX, targetY - 14, label, '#00f3ff');
            }
        }
    }

    // 2. Draw Spacing Connections and Labels
    Object.keys(state.rows).forEach((rowName, rowIdx) => {
        const color = state.rowColors[rowIdx % state.rowColors.length];
        const holeIds = state.rows[rowName];
        const rowHoles = state.holes.filter(h => holeIds.includes(h.id));
        
        // Sort row holes for rendering sequence line
        rowHoles.sort((a, b) => {
            return a.id.localeCompare(b.id, undefined, {numeric: true});
        });

        if (rowHoles.length > 1) {
            ctx.beginPath();
            const p0 = w2s(rowHoles[0].x, rowHoles[0].y);
            ctx.moveTo(p0.x, p0.y);
            for (let i = 1; i < rowHoles.length; i++) {
                const pi = w2s(rowHoles[i].x, rowHoles[i].y);
                ctx.lineTo(pi.x, pi.y);
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 5]);
            ctx.stroke();
            ctx.setLineDash([]); // reset
        }

        // Draw Spacing Labels in between holes
        for (let i = 0; i < rowHoles.length - 1; i++) {
            const h1 = rowHoles[i];
            const h2 = rowHoles[i+1];
            const sH1 = w2s(h1.x, h1.y);
            const sH2 = w2s(h2.x, h2.y);
            const midX = (sH1.x + sH2.x) / 2;
            const midY = (sH1.y + sH2.y) / 2;
            const spVal = h1.spacing;
            
            if (spVal > 0) {
                // Background bubble for text
                ctx.fillStyle = 'rgba(10, 13, 20, 0.8)';
                ctx.fillRect(midX - 16, midY - 8, 32, 16);
                ctx.strokeStyle = color;
                ctx.lineWidth = 0.5;
                ctx.strokeRect(midX - 16, midY - 8, 32, 16);
                
                ctx.fillStyle = '#fff';
                ctx.font = `10px Outfit`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(spVal.toFixed(1) + 'm', midX, midY);
            }
        }
    });

    // 3. Draw Burden Vector Arrows
    // 'Row 1'이라는 이름이 아니라, state.rows에서 실제로 첫 번째인 열(자유면과 맞닿은 열)인지로 판단한다 —
    // nextRowIndex는 전역으로 계속 증가해 재생성 시 이름이 'Row 1'이 아닐 수 있기 때문.
    const firstRowName = Object.keys(state.rows)[0];
    state.holes.forEach(h => {
        // Only draw burden vectors for the first row to the Free Face (per user request)
        if (h.rowName === firstRowName && h.burden > 0 && h.nearestFacePoint) {
            const sH = w2s(h.x, h.y);
            const sPt = w2s(h.nearestFacePoint.x, h.nearestFacePoint.y);
            
            // Draw burden line
            ctx.beginPath();
            ctx.moveTo(sH.x, sH.y);
            ctx.lineTo(sPt.x, sPt.y);
            ctx.strokeStyle = 'rgba(255, 140, 0, 0.7)'; // orange
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Draw arrowhead at target face point
            const angle = Math.atan2(sH.y - sPt.y, sH.x - sPt.x);
            ctx.beginPath();
            ctx.moveTo(sPt.x, sPt.y);
            ctx.lineTo(sPt.x + 8 * Math.cos(angle - Math.PI/6), sPt.y + 8 * Math.sin(angle - Math.PI/6));
            ctx.lineTo(sPt.x + 8 * Math.cos(angle + Math.PI/6), sPt.y + 8 * Math.sin(angle + Math.PI/6));
            ctx.closePath();
            ctx.fillStyle = 'rgba(255, 140, 0, 0.7)';
            ctx.fill();

            // Draw Burden text tag
            const midX = (sH.x + sPt.x) / 2;
            const midY = (sH.y + sPt.y) / 2;
            
            ctx.fillStyle = 'rgba(10, 13, 20, 0.8)';
            ctx.fillRect(midX - 16, midY - 8, 32, 16);
            ctx.strokeStyle = '#ff8c00';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(midX - 16, midY - 8, 32, 16);

            ctx.fillStyle = '#ff8c00';
            ctx.font = `10px Outfit`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(h.burden.toFixed(1) + 'm', midX, midY);
        }
    });

    // 4. Draw Blast Holes (Pins)
    state.holes.forEach(h => {
        const rowIdx = Object.keys(state.rows).indexOf(h.rowName);
        const color = state.rowColors[rowIdx >= 0 ? rowIdx % state.rowColors.length : 0];
        const sH = w2s(h.x, h.y);
        
        // Draw hover glow ring on the targeted hole; red for delete intent, cyan otherwise
        if (h.id === state.hoveredHoleId) {
            const isDeleteTarget = state.selectedTool === 'delete-hole';
            ctx.beginPath();
            ctx.arc(sH.x, sH.y, 12, 0, Math.PI * 2);
            ctx.fillStyle = isDeleteTarget ? 'rgba(239, 68, 68, 0.25)' : 'rgba(0, 243, 255, 0.25)';
            ctx.fill();
            ctx.strokeStyle = isDeleteTarget ? '#ef4444' : '#00f3ff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // Draw selection ring (amber) for holes in state.selectedHoleIds — distinct from hover(cyan)
        if (state.selectedHoleIds && state.selectedHoleIds.includes(h.id)) {
            ctx.beginPath();
            ctx.arc(sH.x, sH.y, 10, 0, Math.PI * 2);
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // 발파 시뮬레이션 재생 중 기폭 애니메이션 — 반경 0 → 저항선(B) 크기로 확대되며 페이드아웃되는 "펑" 원.
        // 같은 지발 그룹의 공들은 delaySimulator.setSimStep()이 동시에 flashStartTime을 세팅하므로 함께 확대된다.
        if (state.flashingHoleIds && state.flashingHoleIds.includes(h.id)) {
            const elapsed = performance.now() - (state.flashStartTime || 0);
            const t = Math.max(0, Math.min(1, elapsed / EXPLOSION_DURATION_MS));
            if (t < 1) {
                const B = h.burden || state.params.targetBurden || 2.5;
                const pxPerMeter = state.zoom / (state.scaleFactor || 0.01);
                const targetRadius = Math.min(80, Math.max(8, B * pxPerMeter)); // ponytail: clamp so extreme zoom never breaks the burst visually
                const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic expansion
                const radius = targetRadius * eased;
                const alpha = 1 - t; // linear fade

                ctx.beginPath();
                ctx.arc(sH.x, sH.y, radius, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 255, 255, ${(alpha * 0.35).toFixed(3)})`;
                ctx.fill();
                ctx.strokeStyle = `rgba(255, 247, 0, ${alpha.toFixed(3)})`;
                ctx.lineWidth = 3;
                ctx.stroke();
            }
        }

        ctx.beginPath();
        ctx.arc(sH.x, sH.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#0f172a'; // dark filled pin
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = color;
        ctx.stroke();

        // Inner core
        ctx.beginPath();
        ctx.arc(sH.x, sH.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // Label
        const numLabel = h.id.split('-').pop(); // extract index number
        ctx.fillStyle = '#fff';
        ctx.font = `bold 8px Outfit`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(numLabel, sH.x, sH.y - 13);
        
        // Row tag (if Zoom is close enough)
        if (state.zoom > 1.2) {
            ctx.fillStyle = varColorSecondary();
            ctx.font = `7px Noto Sans KR`;
            ctx.fillText(h.rowName, sH.x, sH.y + 16);
        }
    });

    // 4b. Draw Custom measurements (Persistent and active ruler drag)
    if (state.customMeasurements && state.customMeasurements.length > 0) {
        state.customMeasurements.forEach(m => {
            const h1 = state.holes.find(h => h.id === m.fromHoleId);
            const h2 = state.holes.find(h => h.id === m.toHoleId);
            if (h1 && h2) {
                const sH1 = w2s(h1.x, h1.y);
                const sH2 = w2s(h2.x, h2.y);
                
                // Draw custom measurement line
                ctx.beginPath();
                ctx.moveTo(sH1.x, sH1.y);
                ctx.lineTo(sH2.x, sH2.y);
                ctx.strokeStyle = '#00f3ff'; // cyan
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]); // dashed line
                ctx.stroke();
                ctx.setLineDash([]); // reset

                // Draw distance text box
                const midX = (sH1.x + sH2.x) / 2;
                const midY = (sH1.y + sH2.y) / 2;
                const distM = getGeodesicDistance(h1, h2);

                ctx.fillStyle = 'rgba(10, 13, 20, 0.85)';
                ctx.fillRect(midX - 20, midY - 9, 40, 18);
                ctx.strokeStyle = '#00f3ff';
                ctx.lineWidth = 1;
                ctx.strokeRect(midX - 20, midY - 9, 40, 18);

                ctx.fillStyle = '#00f3ff';
                ctx.font = `bold 10px Outfit`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(distM.toFixed(1) + 'm', midX, midY);
            }
        });
    }

    if (state.activeMeasurement) {
        const active = state.activeMeasurement;
        const fromH = state.holes.find(h => h.id === active.fromHoleId);
        if (fromH) {
            const sFromH = w2s(fromH.x, fromH.y);
            const sCurrent = w2s(active.currentPos.x, active.currentPos.y);
            
            // Draw active measurement line being dragged
            ctx.beginPath();
            ctx.moveTo(sFromH.x, sFromH.y);
            ctx.lineTo(sCurrent.x, sCurrent.y);
            ctx.strokeStyle = '#ec4899'; // pink for active dragging
            ctx.lineWidth = 2.5;
            ctx.setLineDash([3, 3]);
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw a temporary connection circle on target if snapped
            if (active.toHoleId) {
                const targetH = state.holes.find(h => h.id === active.toHoleId);
                if (targetH) {
                    const sTarget = w2s(targetH.x, targetH.y);
                    ctx.beginPath();
                    ctx.arc(sTarget.x, sTarget.y, 14, 0, Math.PI * 2);
                    ctx.strokeStyle = '#ec4899';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }

            // Draw floating distance label
            const midX = (sFromH.x + sCurrent.x) / 2;
            const midY = (sFromH.y + sCurrent.y) / 2;
            const distM = getGeodesicDistance(fromH, active.currentPos);

            ctx.fillStyle = 'rgba(10, 13, 20, 0.9)';
            ctx.fillRect(midX - 22, midY - 10, 44, 20);
            ctx.strokeStyle = '#ec4899';
            ctx.lineWidth = 1;
            ctx.strokeRect(midX - 22, midY - 10, 44, 20);

            ctx.fillStyle = '#ec4899';
            ctx.font = `bold 10px Outfit`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(distM.toFixed(1) + 'm', midX, midY);
        }
    }

    // 5. Draw Temporary Drawing Lines (Calibrate Scale, Auto-pattern guide)
    if (state.selectedTool === 'calibrate' && state.tempScaleLine) {
        const l = state.tempScaleLine;
        const sStart = w2s(l.start.x, l.start.y);
        const sEnd = w2s(l.end.x, l.end.y);
        
        // Line
        ctx.beginPath();
        ctx.moveTo(sStart.x, sStart.y);
        ctx.lineTo(sEnd.x, sEnd.y);
        ctx.strokeStyle = '#a855f7'; // purple
        ctx.lineWidth = 3;
        ctx.stroke();
        
        // Handles
        [sStart, sEnd].forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
            ctx.fillStyle = '#a855f7';
            ctx.fill();
        });
    }

    // Shift+드래그 박스 선택 미리보기: 반투명 사각형 (박스 패턴 미리보기와 동일 스타일, 다른 색상)
    if (state.isBoxSelecting && state.tempSelectionBox) {
        const { start, current } = state.tempSelectionBox;
        const sStart = w2s(start.x, start.y);
        const sCurrent = w2s(current.x, current.y);
        const rx = Math.min(sStart.x, sCurrent.x);
        const ry = Math.min(sStart.y, sCurrent.y);
        const rw = Math.abs(sCurrent.x - sStart.x);
        const rh = Math.abs(sCurrent.y - sStart.y);

        ctx.fillStyle = 'rgba(0, 243, 255, 0.12)';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = '#00f3ff';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);
    }

    // 박스 패턴 드래그 미리보기: 반투명 사각형 + "예상 발파공: N개" 툴팁
    if (state.selectedTool === 'box-pattern' && state.tempBoxPattern) {
        const { start, current } = state.tempBoxPattern;
        const sStart = w2s(start.x, start.y);
        const sCurrent = w2s(current.x, current.y);
        const rx = Math.min(sStart.x, sCurrent.x);
        const ry = Math.min(sStart.y, sCurrent.y);
        const rw = Math.abs(sCurrent.x - sStart.x);
        const rh = Math.abs(sCurrent.y - sStart.y);

        ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);

        const toReal = (state.map && !state.canvasMode) ? getMapCosLat(start) : state.scaleFactor;
        const W = Math.abs(current.x - start.x) * toReal;
        const L = Math.abs(current.y - start.y) * toReal;
        if (W > 0 && L > 0) {
            const { S1 } = calculateCorrectedPitch(W, state.params.targetSpacing);
            const count = estimateBoundingBoxCount(W, L, S1, state.params.targetBurden);
            drawPreviewLabel(ctx, sCurrent.x, sCurrent.y - 20, `예상 발파공: ${count}개`, '#f59e0b');
        }
    }

    if (state.selectedTool === 'auto-row' && state.tempRowLine) {
        const l = state.tempRowLine;
        const sStart = w2s(l.start.x, l.start.y);
        const sEnd = w2s(l.end.x, l.end.y);
        
        ctx.beginPath();
        ctx.moveTo(sStart.x, sStart.y);
        ctx.lineTo(sEnd.x, sEnd.y);
        ctx.strokeStyle = '#00f3ff'; // cyan
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]); // reset

        // Draw dots indicating placement candidates along the line
        const dx = l.end.x - l.start.x;
        const dy = l.end.y - l.start.y;
        const distPx = Math.sqrt(dx*dx + dy*dy);
        const distM = distPx * state.scaleFactor;
        const spacingM = state.params.targetSpacing;
        const numHoles = Math.max(2, Math.floor(distM / spacingM) + 1);

        for (let i = 0; i < numHoles; i++) {
            const t = numHoles > 1 ? i / (numHoles - 1) : 0;
            const cx = l.start.x + dx * t;
            const cy = l.start.y + dy * t;
            const sC = w2s(cx, cy);
            
            ctx.beginPath();
            ctx.arc(sC.x, sC.y, 6, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0, 243, 255, 0.4)';
            ctx.fill();
            ctx.strokeStyle = '#00f3ff';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }

    // 5b. Draw active W-S Auto Pattern Preview
    if (state.selectedTool === 'ws-pattern' && state.activeWSPattern) {
        const active = state.activeWSPattern;
        const h1 = active.h1Pos;
        const h2 = active.currentPos;
        
        const sH1 = w2s(h1.x, h1.y);
        const sH2 = w2s(h2.x, h2.y);
        
        const dx = h2.x - h1.x;
        const dy = h2.y - h1.y;
        const wLen = Math.sqrt(dx*dx + dy*dy);
        
        // Draw h1 preview circle
        ctx.beginPath();
        ctx.arc(sH1.x, sH1.y, 10, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 140, 0, 0.4)';
        ctx.fill();
        ctx.strokeStyle = '#ff8c00';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        
        if (wLen > 0) {
            const px = -dy / wLen;
            const py = dx / wLen;
            const sDistPx = wLen * state.params.bsRatio;
            
            const h3 = { x: h1.x + px * sDistPx, y: h1.y + py * sDistPx };
            const h4 = { x: h2.x + px * sDistPx, y: h2.y + py * sDistPx };
            
            const sH3 = w2s(h3.x, h3.y);
            const sH4 = w2s(h4.x, h4.y);
            
            // Draw preview rectangle outline
            ctx.beginPath();
            ctx.moveTo(sH1.x, sH1.y);
            ctx.lineTo(sH2.x, sH2.y);
            ctx.strokeStyle = '#ff8c00'; // orange for Burden W
            ctx.lineWidth = 2;
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(sH3.x, sH3.y);
            ctx.lineTo(sH4.x, sH4.y);
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(sH1.x, sH1.y);
            ctx.lineTo(sH3.x, sH3.y);
            ctx.strokeStyle = '#00f3ff'; // cyan for Spacing S
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(sH2.x, sH2.y);
            ctx.lineTo(sH4.x, sH4.y);
            ctx.stroke();
            
            // Draw preview circles for h2, h3, h4
            [sH2].forEach(p => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 140, 0, 0.4)';
                ctx.fill();
                ctx.strokeStyle = '#ff8c00';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            });
            
            [sH3, sH4].forEach(p => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0, 243, 255, 0.3)';
                ctx.fill();
                ctx.strokeStyle = '#00f3ff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            });
            
            // Labels W and S in meters
            const distM = getGeodesicDistance(h1, h2);
            const sM = distM * state.params.bsRatio;
            
            drawPreviewLabel(ctx, (sH1.x + sH2.x)/2, (sH1.y + sH2.y)/2, `저항선 W: ${distM.toFixed(1)}m`, '#ff8c00');
            drawPreviewLabel(ctx, (sH3.x + sH4.x)/2, (sH3.y + sH4.y)/2, `저항선 W: ${distM.toFixed(1)}m`, '#ff8c00');
            drawPreviewLabel(ctx, (sH1.x + sH3.x)/2, (sH1.y + sH3.y)/2, `공간격 S: ${sM.toFixed(1)}m`, '#00f3ff');
            drawPreviewLabel(ctx, (sH2.x + sH4.x)/2, (sH2.y + sH4.y)/2, `공간격 S: ${sM.toFixed(1)}m`, '#00f3ff');
        }
    }

    // 5c. Draw Instantiated Auto Patterns (W-S rectangles)
    if (state.autoPatterns && state.autoPatterns.length > 0) {
        state.autoPatterns.forEach(p => {
            const h1 = state.holes.find(h => h.id === p.h1Id);
            const h2 = state.holes.find(h => h.id === p.h2Id);
            const h3 = state.holes.find(h => h.id === p.h3Id);
            const h4 = state.holes.find(h => h.id === p.h4Id);
            
            if (h1 && h2 && h3 && h4) {
                const sH1 = w2s(h1.x, h1.y);
                const sH2 = w2s(h2.x, h2.y);
                const sH3 = w2s(h3.x, h3.y);
                const sH4 = w2s(h4.x, h4.y);
                
                const distM = getGeodesicDistance(h1, h2);
                const sM = getGeodesicDistance(h1, h3);
                
                // Draw connecting lines
                ctx.beginPath();
                ctx.moveTo(sH1.x, sH1.y);
                ctx.lineTo(sH2.x, sH2.y);
                ctx.strokeStyle = 'rgba(255, 140, 0, 0.45)'; // soft orange
                ctx.lineWidth = 2;
                ctx.stroke();
                
                ctx.beginPath();
                ctx.moveTo(sH3.x, sH3.y);
                ctx.lineTo(sH4.x, sH4.y);
                ctx.stroke();
                
                ctx.beginPath();
                ctx.moveTo(sH1.x, sH1.y);
                ctx.lineTo(sH3.x, sH3.y);
                ctx.strokeStyle = 'rgba(0, 243, 255, 0.45)'; // soft cyan
                ctx.stroke();
                
                ctx.beginPath();
                ctx.moveTo(sH2.x, sH2.y);
                ctx.lineTo(sH4.x, sH4.y);
                ctx.stroke();
                
                // Draw tags
                drawPreviewLabel(ctx, (sH1.x + sH2.x)/2, (sH1.y + sH2.y)/2, `저항선 W: ${distM.toFixed(1)}m`, '#ff8c00');
                drawPreviewLabel(ctx, (sH3.x + sH4.x)/2, (sH3.y + sH4.y)/2, `저항선 W: ${distM.toFixed(1)}m`, '#ff8c00');
                drawPreviewLabel(ctx, (sH1.x + sH3.x)/2, (sH1.y + sH3.y)/2, `공간격 S: ${sM.toFixed(1)}m`, '#00f3ff');
                drawPreviewLabel(ctx, (sH2.x + sH4.x)/2, (sH2.y + sH4.y)/2, `공간격 S: ${sM.toFixed(1)}m`, '#00f3ff');
            }
        });
    }

    // 5d. Draw active A-B Line drag preview
    if (state.selectedTool === 'ab-line' && state.tempABLine) {
        const l = state.tempABLine;
        const sStart = w2s(l.start.x, l.start.y);
        const sEnd = w2s(l.end.x, l.end.y);
        
        // Draw red A-B line
        ctx.beginPath();
        ctx.moveTo(sStart.x, sStart.y);
        ctx.lineTo(sEnd.x, sEnd.y);
        ctx.strokeStyle = '#ef4444'; // red
        ctx.lineWidth = 4;
        ctx.stroke();
        
        // Draw handles
        [sStart, sEnd].forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
            ctx.fillStyle = '#ef4444';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        });
        
        // Draw direction indicators (arrows) showing burden direction
        const dx = l.end.x - l.start.x;
        const dy = l.end.y - l.start.y;
        const lenProj = Math.sqrt(dx*dx + dy*dy);
        
        if (lenProj > 0) {
            const dir = state.abLineDirection;
            const nx = (-dy / lenProj) * dir;
            const ny = (dx / lenProj) * dir;
            
            // Draw 3 spacing arrows along the line
            const arrowLengthPx = 30;
            const arrowColor = 'rgba(239, 68, 68, 0.75)';
            
            for (let f = 0.25; f <= 0.75; f += 0.25) {
                const ax = sStart.x + (sEnd.x - sStart.x) * f;
                const ay = sStart.y + (sEnd.y - sStart.y) * f;
                
                // Perpendicular arrow direction in screen coordinates
                const angle = Math.atan2(sEnd.y - sStart.y, sEnd.x - sStart.x) + Math.PI/2 * dir;
                const targetX = ax + Math.cos(angle) * arrowLengthPx;
                const targetY = ay + Math.sin(angle) * arrowLengthPx;
                
                // Draw arrow shaft
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(targetX, targetY);
                ctx.strokeStyle = arrowColor;
                ctx.lineWidth = 2;
                ctx.stroke();
                
                // Draw arrowhead pointing away from line
                ctx.beginPath();
                ctx.moveTo(targetX, targetY);
                ctx.lineTo(targetX - 6 * Math.cos(angle - Math.PI/6), targetY - 6 * Math.sin(angle - Math.PI/6));
                ctx.lineTo(targetX - 6 * Math.cos(angle + Math.PI/6), targetY - 6 * Math.sin(angle + Math.PI/6));
                ctx.closePath();
                ctx.fillStyle = arrowColor;
                ctx.fill();
            }
            
            // Draw line distance tag in meters
            const lenM = getGeodesicDistance(l.start, l.end);
            const midX = (sStart.x + sEnd.x) / 2;
            const midY = (sStart.y + sEnd.y) / 2;
            drawPreviewLabel(ctx, midX, midY - 12, `A-B 라인: ${lenM.toFixed(1)}m`, '#ef4444');
        }
    }

    // 5f. Draw active manual hole preview (add-hole)
    if (state.selectedTool === 'add-hole' && state.tempHolePreview) {
        const fromH = state.holes.find(h => h.id === state.tempHolePreview.fromHoleId);
        if (fromH) {
            const sFrom = w2s(fromH.x, fromH.y);
            const sCur = w2s(state.tempHolePreview.currentPos.x, state.tempHolePreview.currentPos.y);
            
            // Draw spacing preview line (dashed)
            ctx.beginPath();
            ctx.moveTo(sFrom.x, sFrom.y);
            ctx.lineTo(sCur.x, sCur.y);
            ctx.strokeStyle = '#00f3ff'; // cyan
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Draw floating distance label
            const midX = (sFrom.x + sCur.x) / 2;
            const midY = (sFrom.y + sCur.y) / 2;
            const distM = getGeodesicDistance(fromH, state.tempHolePreview.currentPos);
            drawPreviewLabel(ctx, midX, midY - 12, `${distM.toFixed(1)}m`, '#00f3ff');
        }
    }

    // 5e. Draw Instantiated A-B lines (Hidden per user request: "생성하면 없어지게 해주고")
    /*
    if (state.abPatterns && state.abPatterns.length > 0) {
        state.abPatterns.forEach(p => {
            const sStart = w2s(p.start.x, p.start.y);
            const sEnd = w2s(p.end.x, p.end.y);
            
            ctx.beginPath();
            ctx.moveTo(sStart.x, sStart.y);
            ctx.lineTo(sEnd.x, sEnd.y);
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)'; // soft red
            ctx.lineWidth = 3;
            ctx.stroke();
            
            // Draw tiny end circles
            [sStart, sEnd].forEach(pt => {
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(239, 68, 68, 0.6)';
                ctx.fill();
            });
        });
    }
    */

    ctx.restore();

    // 기폭 애니메이션 진행 중(지속시간 안)이면 다음 프레임에 다시 그려 확대/페이드를 이어간다.
    // 지속시간이 지나면 자동으로 멈춘다 — setSimStep()이 다음 스텝에서 flashStartTime을 다시 세팅해 재시작.
    // requestAnimationFrame 대신 setTimeout을 쓰는 이유: 실사용 환경에서 브라우저가 rAF를 심하게
    // 쓰로틀링(탭이 백그라운드거나 절전/저전력 모드일 때 등)하면 rAF 체인이 500ms 동안 한 번도
    // 안 돌아 애니메이션이 반경 0(안 보임)에서 멈춰버리는 문제가 실측 확인됨 — setTimeout은 같은
    // 조건에서 훨씬 안정적으로 돈다.
    if (state.flashingHoleIds && state.flashingHoleIds.length > 0 &&
        performance.now() - (state.flashStartTime || 0) < EXPLOSION_DURATION_MS) {
        setTimeout(draw2D, 16);
    }
}

export function drawBackgroundGrid(ctx, w, h) {
    ctx.strokeStyle = 'rgba(15,23,42,0.04)';
    ctx.lineWidth = 1;
    const step = 50;
    
    for (let x = -w; x < w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, -h);
        ctx.lineTo(x, h);
        ctx.stroke();
    }
    
    for (let y = -h; y < h; y += step) {
        ctx.beginPath();
        ctx.moveTo(-w, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }
}

export function varColorSecondary() {
    return '#94a3b8';
}
