// AeroBlast Pro - 3D Subsurface Visualization Engine (Three.js 기반 3D 벤치/발파공 시각화)
//
// 3D 지형 위에 발파공 실린더, 저항선/공간격 3D 라벨, 드로잉 프리뷰를 렌더링하고
// 3D 캔버스에서의 마우스 인터랙션(발파공 배치, W-S/A-B 패턴 드로잉)을 처리한다.

import { state, dom, history } from '../core/state.js';
import { getTerrainHeightAt } from '../main.js';
import { getGeodesicDistance, recalculateBurdenSpacing, updateABModalStats } from '../patterns/blastPatterns.js';
import { selectTool, showToast, updateDashboard } from '../ui/events.js';
import { draw2D } from './canvas2d.js';
import { createHoleChargeDefaults } from '../core/blastEngine.js';
export function createTextSprite3D(text, color = '#00f3ff') {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    // Draw bubble background
    ctx.fillStyle = 'rgba(10, 13, 20, 0.85)';
    ctx.fillRect(8, 8, 112, 48);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, 112, 48);
    
    // Draw text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px Outfit';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 32);
    
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }); // depthTest false keeps it on top of mesh
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(6, 3, 1); // Aspect ratio
    return sprite;
}

export function init3DView() {
    const container = document.getElementById('three-canvas-holder');
    container.innerHTML = ""; // clean up
    
    const rect = dom.container3d.getBoundingClientRect();
    
    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8fafc);
    state.three.scene = scene;
    
    // Camera
    const camera = new THREE.PerspectiveCamera(45, rect.width / rect.height, 1, 1000);
    camera.position.set(0, 45, 60);
    state.three.camera = camera;
    
    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(rect.width, rect.height);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);
    state.three.renderer = renderer;

    // Controls
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.01; // don't go below floor
    if (state.three.terrainMesh) {
        controls.target.set(0, 0, 0);
    } else {
        controls.target.set(0, state.params.benchHeight/2, 0);
    }
    state.three.controls = controls;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
    dirLight.position.set(20, 60, 20);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    scene.add(dirLight);

    const dirLight2 = new THREE.DirectionalLight(0x00f3ff, 0.3); // blueish tech highlight
    dirLight2.position.set(-20, 10, -20);
    scene.add(dirLight2);

    // Group to hold dynamic geometry
    state.three.objectsGroup = new THREE.Group();
    scene.add(state.three.objectsGroup);

    // Group to hold temporary drawing guides (e.g. preview lines) for maximum FPS during drag
    state.three.previewGroup = new THREE.Group();
    scene.add(state.three.previewGroup);

    update3DView();

    // 3D Canvas Interactions (Raycasting for Drawing in 3D Mode)
    const canvas3d = renderer.domElement;
    
    // Set initial controls state based on tool selection
    controls.enabled = (state.selectedTool === 'pan');
    
    const get3DIntersection = (clientX, clientY) => {
        if (!state.three.terrainMesh) return null;
        
        const rect = canvas3d.getBoundingClientRect();
        const mouseX = ((clientX - rect.left) / rect.width) * 2 - 1;
        const mouseY = -((clientY - rect.top) / rect.height) * 2 + 1;
        
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), camera);
        
        if (state.three.terrainMesh instanceof THREE.Points) {
            raycaster.params.Points.threshold = 1.5; // 1.5 meters threshold for clicking point clouds
        }
        
        const intersects = raycaster.intersectObject(state.three.terrainMesh, true);
        if (intersects.length > 0) {
            const pt = intersects[0].point;
            // Map local 3D coordinates back to world EPSG:3857 coordinates
            const wx = pt.x + state.terrainOffset.x;
            const wy = state.terrainOffset.y - pt.z; // canvas Y is 3D Z
            return { x: wx, y: wy };
        }
        return null;
    };

    canvas3d.addEventListener('mousedown', (e) => {
        if (state.selectedTool === 'pan' || e.button !== 0) return; // Only handle left clicks
        
        const worldPos = get3DIntersection(e.clientX, e.clientY);
        if (!worldPos) return;
        
        if (state.selectedTool === 'add-hole') {
            history.save();
            const rowName = `Row ${state.nextRowIndex}`;
            const newHoleId = `H-${state.nextRowIndex}-${(state.rows[rowName]?.length || 0) + 1}`;
            
            const newHole = {
                id: newHoleId,
                x: worldPos.x,
                y: worldPos.y,
                rowName: rowName,
                spacing: 0,
                burden: 0,
                ...createHoleChargeDefaults()
            };
            
            state.holes.push(newHole);
            if (!state.rows[rowName]) {
                state.rows[rowName] = [];
            }
            state.rows[rowName].push(newHoleId);
            
            // Set/Update preview starting point to the newly placed hole
            state.tempHolePreview = {
                fromHoleId: newHoleId,
                currentPos: worldPos
            };
            
            recalculateBurdenSpacing();
            updateDashboard();
            draw2D();
            update3DView();
            showToast(`발파공 ${newHoleId} 추가 완료 (3D)`, "check-circle");
        } else if (state.selectedTool === 'ws-pattern') {
            if (!state.activeWSPattern) {
                // First click: Place first hole & start pattern preview
                history.save();
                const rowName = `WS Row ${state.nextRowIndex}`;
                state.rows[rowName] = [];
                
                const h1Id = `H-WS-${state.nextRowIndex}-1`;
                const h1 = {
                    id: h1Id,
                    x: worldPos.x,
                    y: worldPos.y,
                    rowName: rowName,
                    spacing: 0,
                    burden: 0,
                    ...createHoleChargeDefaults()
                };
                
                state.holes.push(h1);
                state.rows[rowName].push(h1Id);
                state.activeWSPattern = {
                    h1Id: h1Id,
                    h1Pos: { x: worldPos.x, y: worldPos.y },
                    currentPos: { x: worldPos.x, y: worldPos.y }
                };
                draw2D();
                update3DView();
            } else {
                // Second click: Complete the pattern
                const active = state.activeWSPattern;
                const h1 = state.holes.find(h => h.id === active.h1Id);
                
                if (h1) {
                    const h2Pos = { x: worldPos.x, y: worldPos.y };
                    const dx = h2Pos.x - h1.x;
                    const dy = h2Pos.y - h1.y;
                    const wLen = Math.sqrt(dx*dx + dy*dy);
                    
                    if (wLen > 2) {
                        const px = -dy / wLen;
                        const py = dx / wLen;
                        const sDistPx = wLen * state.params.bsRatio;
                        
                        const h2Id = `H-WS-${state.nextRowIndex}-2`;
                        const h3Id = `H-WS-${state.nextRowIndex}-3`;
                        const h4Id = `H-WS-${state.nextRowIndex}-4`;
                        
                        const h2 = { id: h2Id, x: h2Pos.x, y: h2Pos.y, rowName: h1.rowName, spacing: wLen, burden: 0, ...createHoleChargeDefaults() };
                        const h3 = { id: h3Id, x: h1.x + px * sDistPx, y: h1.y + py * sDistPx, rowName: h1.rowName, spacing: wLen, burden: sDistPx, ...createHoleChargeDefaults() };
                        const h4 = { id: h4Id, x: h2.x + px * sDistPx, y: h2.y + py * sDistPx, rowName: h1.rowName, spacing: wLen, burden: sDistPx, ...createHoleChargeDefaults() };
                        
                        state.holes.push(h2, h3, h4);
                        state.rows[h1.rowName].push(h2Id, h3Id, h4Id);
                        
                        state.autoPatterns.push({
                            id: `P-${Date.now()}`,
                            h1Id: h1.id, h2Id: h2Id, h3Id: h3Id, h4Id: h4Id
                        });
                        
                        state.nextRowIndex++;
                        showToast("W-S 자동 패턴 배치 완료 (3D)", "check-circle");
                    } else {
                        // Too close, delete the first hole
                        state.holes = state.holes.filter(h => h.id !== h1.id);
                        delete state.rows[h1.rowName];
                    }
                }
                state.activeWSPattern = null;
                selectTool('pan');
                recalculateBurdenSpacing();
                updateDashboard();
                draw2D();
                update3DView();
            }
        } else if (state.selectedTool === 'ab-line') {
            // Drag and drop for A-B line matching 2D behavior
            state.tempABLine = {
                start: { x: worldPos.x, y: worldPos.y },
                end: { x: worldPos.x, y: worldPos.y }
            };
            state.isDrawing = true;
            draw2D();
            update3DView();
        }
    });

    canvas3d.addEventListener('mouseup', (e) => {
        if (state.selectedTool === 'pan' || !state.isDrawing) return;
        state.isDrawing = false;
        
        const worldPos = get3DIntersection(e.clientX, e.clientY);
        if (!worldPos) return;
        
        if (state.selectedTool === 'ab-line' && state.tempABLine) {
            state.tempABLine.end = { x: worldPos.x, y: worldPos.y };
            
            const dx = state.tempABLine.end.x - state.tempABLine.start.x;
            const dy = state.tempABLine.end.y - state.tempABLine.start.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist > 2) {
                dom.abModal.classList.remove('hidden');
                updateABModalStats();
            } else {
                state.tempABLine = null;
                selectTool('pan');
                draw2D();
                update3DView();
            }
        }
    });

    canvas3d.addEventListener('mousemove', (e) => {
        if (state.selectedTool === 'pan') return;
        
        const worldPos = get3DIntersection(e.clientX, e.clientY);
        if (!worldPos) return;
        
        let needsUpdate = false;
        
        if (state.selectedTool === 'add-hole' && state.tempHolePreview) {
            state.tempHolePreview.currentPos = { x: worldPos.x, y: worldPos.y };
            needsUpdate = true;
        } else if (state.selectedTool === 'ws-pattern' && state.activeWSPattern) {
            state.activeWSPattern.currentPos = { x: worldPos.x, y: worldPos.y };
            needsUpdate = true;
        } else if (state.selectedTool === 'ab-line' && state.isDrawing && state.tempABLine) {
            state.tempABLine.end = { x: worldPos.x, y: worldPos.y };
            needsUpdate = true;
        }
        
        if (needsUpdate) {
            draw2D();
            update3DPreviewGuides();
        }
    });

    canvas3d.addEventListener('dblclick', (e) => {
        if (state.selectedTool === 'add-hole') {
            e.preventDefault();
            
            // Revert the double-click second click
            history.undo();
            history.redoStack = [];
            history.updateButtons();
            
            state.nextRowIndex++;
            selectTool('pan');
            
            recalculateBurdenSpacing();
            updateDashboard();
            draw2D();
            update3DView();
            
            showToast(`수동 천공 배치 완료 (Row ${state.nextRowIndex - 1} 종료)`, 'check-circle');
        }
    });

    // Animation Loop
    function animate() {
        if (!state.three.active) return;
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }
    
    animate();
}

export function update3DView() {
    const group = state.three.objectsGroup;
    if (!group) return;
    
    // Clear previous geometries
    while(group.children.length > 0){
        const obj = group.children[0];
        group.remove(obj);
    }

    const bh = state.params.benchHeight;
    const sub = state.params.subdrill;
    const totalDepth = bh + sub;

    // 1. Build simulated 3D Quarry Bench Mesh or render Terrain Mesh
    let minX = -10, maxX = 10, minY = -10, maxY = 10;
    if (state.holes.length > 0) {
        minX = Math.min(...state.holes.map(h => h.x)) - 100;
        maxX = Math.max(...state.holes.map(h => h.x)) + 100;
        minY = Math.min(...state.holes.map(h => h.y)) - 100;
        maxY = Math.max(...state.holes.map(h => h.y)) + 100;
    }
    
    const scale = 1.0;
    let scaleX, scaleY;
    
    if (state.three.terrainMesh) {
        scaleX = (x) => x - state.terrainOffset.x;
        scaleY = (y) => state.terrainOffset.y - y;
        
        // Add loaded terrain
        group.add(state.three.terrainMesh);
        if (state.three.terrainWireframe) {
            group.add(state.three.terrainWireframe);
        }
    } else {
        scaleX = (x) => (x - (minX + maxX)/2) * scale;
        scaleY = (y) => (y - (minY + maxY)/2) * scale;
        
        // Draw default flat block if no terrain is loaded
        const rockGeo = new THREE.BoxGeometry((maxX - minX)*scale, bh, (maxY - minY)*scale);
        const rockMat = new THREE.MeshStandardMaterial({
            color: 0x1e293b,
            roughness: 0.8,
            metalness: 0.1,
            transparent: true,
            opacity: 0.5,
            wireframe: false
        });
        
        const rockBlock = new THREE.Mesh(rockGeo, rockMat);
        rockBlock.position.set(0, bh/2, 0);
        rockBlock.receiveShadow = true;
        group.add(rockBlock);
    
        // Let's draw wireframe edges to make it look techy
        const rockWire = new THREE.LineSegments(
            new THREE.EdgesGeometry(rockGeo),
            new THREE.LineBasicMaterial({ color: 0x475569, linewidth: 1 })
        );
        rockWire.position.copy(rockBlock.position);
        group.add(rockWire);
    }

    // 2. Draw 3D Cylinders for drill holes
    const holeRadius = (state.params.holeDiameter / 1000) * 1.5; // exaggerated slightly for 3D visibility
    const stemmingH = state.params.stemmingHeight;
    const chargeH = Math.max(0, totalDepth - stemmingH);
    
    state.holes.forEach((h, hIdx) => {
        const rowIdx = Object.keys(state.rows).indexOf(h.rowName);
        const rowColor = state.rowColors[rowIdx >= 0 ? rowIdx % state.rowColors.length : 0];
        
        const hX = scaleX(h.x);
        const hZ = scaleY(h.y); // Canvas Y maps to 3D Z
        const hY = getTerrainHeightAt(h.x, h.y); // dynamic vertical alignment based on terrain
        
        // Trajectory parameters
        const theta = (state.params.holeAngle * Math.PI) / 180;
        const isVertical = state.params.holeAngle === 90;
        
        // Let's build group for this hole
        const holeGroup = new THREE.Group();
        holeGroup.position.set(hX, hY, hZ);
        
        // 2a. Draw Stemming Section (Top)
        if (stemmingH > 0) {
            const stemGeo = new THREE.CylinderGeometry(holeRadius, holeRadius, stemmingH, 16);
            const stemMat = new THREE.MeshStandardMaterial({
                color: 0xe2e8f0, // white gravel
                roughness: 0.7
            });
            const stemMesh = new THREE.Mesh(stemGeo, stemMat);
            stemMesh.position.y = -stemmingH/2;
            holeGroup.add(stemMesh);
        }
        
        // 2b. Draw Explosive Charge Section (Bottom)
        if (chargeH > 0) {
            const chargeGeo = new THREE.CylinderGeometry(holeRadius, holeRadius, chargeH, 16);
            const chargeMat = new THREE.MeshStandardMaterial({
                color: 0xef4444, // red explosive
                roughness: 0.5,
                emissive: 0xef4444,
                emissiveIntensity: 0.15
            });
            const chargeMesh = new THREE.Mesh(chargeGeo, chargeMat);
            chargeMesh.position.y = -stemmingH - chargeH/2;
            holeGroup.add(chargeMesh);
        }

        // Draw sub-drill marker at the bottom tip
        if (sub > 0) {
            const subGeo = new THREE.CylinderGeometry(holeRadius * 1.05, holeRadius * 1.05, sub, 16);
            const subMat = new THREE.MeshStandardMaterial({
                color: 0xf59e0b, // amber
                roughness: 0.5
            });
            const subMesh = new THREE.Mesh(subGeo, subMat);
            subMesh.position.y = -totalDepth + sub/2;
            holeGroup.add(subMesh);
        }

        // Draw collar ring at the top
        const collarGeo = new THREE.RingGeometry(holeRadius * 1.1, holeRadius * 2.0, 16);
        const collarMat = new THREE.MeshBasicMaterial({ color: rowColor, side: THREE.DoubleSide });
        const collarMesh = new THREE.Mesh(collarGeo, collarMat);
        collarMesh.rotation.x = -Math.PI / 2;
        collarMesh.position.y = 0.05; // tiny offset above ground
        holeGroup.add(collarMesh);

        // Apply hole tilt if sloped
        if (!isVertical) {
            holeGroup.rotation.z = -(Math.PI/2 - theta);
        }

        group.add(holeGroup);
    });

    // 2c. Draw spacing lines between consecutive holes in the same row in 3D
    Object.keys(state.rows).forEach((rowName, rowIdx) => {
        const rowColorStr = state.rowColors[rowIdx % state.rowColors.length];
        const rowColor = new THREE.Color(rowColorStr);
        const holeIds = state.rows[rowName];
        const rowHoles = state.holes.filter(h => holeIds.includes(h.id));
        
        // Sort row holes for rendering sequence line
        rowHoles.sort((a, b) => a.id.localeCompare(b.id, undefined, {numeric: true}));
        
        for (let i = 0; i < rowHoles.length - 1; i++) {
            const h1 = rowHoles[i];
            const h2 = rowHoles[i+1];
            
            const p1 = new THREE.Vector3(scaleX(h1.x), getTerrainHeightAt(h1.x, h1.y) + 0.1, scaleY(h1.y));
            const p2 = new THREE.Vector3(scaleX(h2.x), getTerrainHeightAt(h2.x, h2.y) + 0.1, scaleY(h2.y));
            
            const pts = [p1, p2];
            const geo = new THREE.BufferGeometry().setFromPoints(pts);
            const mat = new THREE.LineBasicMaterial({ color: rowColor, linewidth: 2 });
            const line = new THREE.Line(geo, mat);
            group.add(line);
            
            // Draw floating 3D distance spacing label!
            const spVal = h1.spacing;
            if (spVal > 0) {
                const midPoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
                const sprite = createTextSprite3D(spVal.toFixed(1) + 'm', rowColorStr);
                sprite.position.set(midPoint.x, midPoint.y + 1.2, midPoint.z);
                group.add(sprite);
            }
        }
    });

    // 2d. Draw burden lines between parallel rows in auto-patterns in 3D
    state.autoPatterns.forEach(p => {
        const h1 = state.holes.find(h => h.id === p.h1Id);
        const h3 = state.holes.find(h => h.id === p.h3Id);
        const h2 = state.holes.find(h => h.id === p.h2Id);
        const h4 = state.holes.find(h => h.id === p.h4Id);
        
        if (h1 && h3) {
            const p1 = new THREE.Vector3(scaleX(h1.x), getTerrainHeightAt(h1.x, h1.y) + 0.1, scaleY(h1.y));
            const p3 = new THREE.Vector3(scaleX(h3.x), getTerrainHeightAt(h3.x, h3.y) + 0.1, scaleY(h3.y));
            const pts = [p1, p3];
            const geo = new THREE.BufferGeometry().setFromPoints(pts);
            const mat = new THREE.LineBasicMaterial({ color: 0xff8c00, linewidth: 1.5 }); // orange
            const line = new THREE.Line(geo, mat);
            group.add(line);
            
            // Draw floating 3D burden label!
            const distM = getGeodesicDistance(h1, h3);
            const midPoint = new THREE.Vector3().addVectors(p1, p3).multiplyScalar(0.5);
            const sprite = createTextSprite3D(distM.toFixed(1) + 'm', '#ff8c00');
            sprite.position.set(midPoint.x, midPoint.y + 1.2, midPoint.z);
            group.add(sprite);
        }
        if (h2 && h4) {
            const p2 = new THREE.Vector3(scaleX(h2.x), getTerrainHeightAt(h2.x, h2.y) + 0.1, scaleY(h2.y));
            const p4 = new THREE.Vector3(scaleX(h4.x), getTerrainHeightAt(h4.x, h4.y) + 0.1, scaleY(h4.y));
            const pts = [p2, p4];
            const geo = new THREE.BufferGeometry().setFromPoints(pts);
            const mat = new THREE.LineBasicMaterial({ color: 0xff8c00, linewidth: 1.5 }); // orange
            const line = new THREE.Line(geo, mat);
            group.add(line);
        }
    });

    // 2e. Draw active drawing guidelines in 3D (W-S pattern, A-B line, or manual hole preview)
    // Update preview guides as well
    update3DPreviewGuides();
}

export function update3DPreviewGuides() {
    if (!state.three.active || !state.three.previewGroup) return;
    const pGroup = state.three.previewGroup;
    pGroup.clear();
    
    // Scale functions mapping coordinate differences
    const scaleX = (x) => (x - state.terrainOffset.x);
    const scaleY = (y) => (state.terrainOffset.y - y); // canvas Y is 3D Z
    
    // 1. Render tempHolePreview guide in 3D
    if (state.selectedTool === 'add-hole' && state.tempHolePreview) {
        const fromH = state.holes.find(h => h.id === state.tempHolePreview.fromHoleId);
        if (fromH) {
            const sX = scaleX(fromH.x);
            const sZ = scaleY(fromH.y);
            const sY = getTerrainHeightAt(fromH.x, fromH.y) + 0.2;
            
            const eX = scaleX(state.tempHolePreview.currentPos.x);
            const eZ = scaleY(state.tempHolePreview.currentPos.y);
            const eY = getTerrainHeightAt(state.tempHolePreview.currentPos.x, state.tempHolePreview.currentPos.y) + 0.2;
            
            const p1 = new THREE.Vector3(sX, sY, sZ);
            const p2 = new THREE.Vector3(eX, eY, eZ);
            
            const pts = [p1, p2];
            const geo = new THREE.BufferGeometry().setFromPoints(pts);
            const mat = new THREE.LineBasicMaterial({ color: 0x00f3ff, linewidth: 2 }); // cyan
            const line = new THREE.Line(geo, mat);
            pGroup.add(line);
            
            // Spacing preview distance label
            const distM = getGeodesicDistance(fromH, state.tempHolePreview.currentPos);
            const midPoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
            const sprite = createTextSprite3D(`${distM.toFixed(1)}m`, '#00f3ff');
            sprite.position.set(midPoint.x, midPoint.y + 1.2, midPoint.z);
            pGroup.add(sprite);
        }
    }
    
    // 2. Render activeWSPattern guide in 3D
    if (state.selectedTool === 'ws-pattern' && state.activeWSPattern) {
        const active = state.activeWSPattern;
        const h1 = active.h1Pos;
        const h2 = active.currentPos;
        
        const hX1 = scaleX(h1.x);
        const hZ1 = scaleY(h1.y);
        const hY1 = getTerrainHeightAt(h1.x, h1.y) + 0.2;
        
        const hX2 = scaleX(h2.x);
        const hZ2 = scaleY(h2.y);
        const hY2 = getTerrainHeightAt(h2.x, h2.y) + 0.2;
        
        const dx = h2.x - h1.x;
        const dy = h2.y - h1.y;
        const wLen = Math.sqrt(dx*dx + dy*dy);
        
        if (wLen > 0) {
            const px = -dy / wLen;
            const py = dx / wLen;
            const sDistPx = wLen * state.params.bsRatio;
            
            const h3 = { x: h1.x + px * sDistPx, y: h1.y + py * sDistPx };
            const h4 = { x: h2.x + px * sDistPx, y: h2.y + py * sDistPx };
            
            const hX3 = scaleX(h3.x);
            const hZ3 = scaleY(h3.y);
            const hY3 = getTerrainHeightAt(h3.x, h3.y) + 0.2;
            
            const hX4 = scaleX(h4.x);
            const hZ4 = scaleY(h4.y);
            const hY4 = getTerrainHeightAt(h4.x, h4.y) + 0.2;
            
            const p1 = new THREE.Vector3(hX1, hY1, hZ1);
            const p2 = new THREE.Vector3(hX2, hY2, hZ2);
            const p3 = new THREE.Vector3(hX3, hY3, hZ3);
            const p4 = new THREE.Vector3(hX4, hY4, hZ4);
            
            // Draw orange box outline for WS pattern preview in 3D
            const pts = [p1, p2, p4, p3, p1];
            const geo = new THREE.BufferGeometry().setFromPoints(pts);
            const mat = new THREE.LineBasicMaterial({ color: 0xff8c00, linewidth: 3 }); // orange
            const line = new THREE.Line(geo, mat);
            pGroup.add(line);
            
            // Labels W and S
            const distM = getGeodesicDistance(h1, h2);
            const sM = distM * state.params.bsRatio;
            
            const midW = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
            const spriteW = createTextSprite3D(`W: ${distM.toFixed(1)}m`, '#ff8c00');
            spriteW.position.set(midW.x, midW.y + 1.2, midW.z);
            pGroup.add(spriteW);
            
            const midS = new THREE.Vector3().addVectors(p1, p3).multiplyScalar(0.5);
            const spriteS = createTextSprite3D(`S: ${sM.toFixed(1)}m`, '#00f3ff');
            spriteS.position.set(midS.x, midS.y + 1.2, midS.z);
            pGroup.add(spriteS);
        }
    }
    
    // 3. Render tempABLine guide in 3D
    if (state.selectedTool === 'ab-line' && state.tempABLine) {
        const l = state.tempABLine;
        const sX = scaleX(l.start.x);
        const sZ = scaleY(l.start.y);
        const sY = getTerrainHeightAt(l.start.x, l.start.y) + 0.2;
        
        const eX = scaleX(l.end.x);
        const eZ = scaleY(l.end.y);
        const eY = getTerrainHeightAt(l.end.x, l.end.y) + 0.2;
        
        const p1 = new THREE.Vector3(sX, sY, sZ);
        const p2 = new THREE.Vector3(eX, eY, eZ);
        
        const pts = [p1, p2];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({ color: 0xef4444, linewidth: 3 }); // red
        const line = new THREE.Line(geo, mat);
        pGroup.add(line);
        
        // A-B distance label
        const distM = getGeodesicDistance(l.start, l.end);
        const midPoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
        const sprite = createTextSprite3D(`A-B: ${distM.toFixed(1)}m`, '#ef4444');
        sprite.position.set(midPoint.x, midPoint.y + 1.2, midPoint.z);
        pGroup.add(sprite);
    }
}
