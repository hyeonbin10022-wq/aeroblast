// AeroBlast Pro - Core Application State (전역 상태)
//
// state/dom은 앱 전체가 공유하는 단일 데이터 저장소이며, history는 실행취소/재실행 스택이다.
// history.applyStateChange()는 렌더링/패턴 재계산 모듈을 호출하므로 순환 참조가 발생하지만,
// 모두 함수 선언(hoisted) 또는 이벤트 콜백 내부 호출이라 ES 모듈 로딩 순서상 안전하다.

import { recalculateBurdenSpacing } from '../patterns/blastPatterns.js';
import { updateDashboard } from '../ui/events.js';
import { draw2D } from '../render/canvas2d.js';
import { update3DView } from '../render/canvas3d.js';
export const state = {
    // Auth: 현재 로그인한 Supabase 사용자 (비로그인 시 null)
    currentUser: null,
    // Auth: 로그인 사용자의 profiles 테이블 행 (name, tier) — 비로그인/로딩 전 null
    userProfile: null,

    // Design parameters (inputs)
    params: {
        targetSpacing: 3.2,     // m
        targetBurden: 2.5,      // m
        benchHeight: 10.0,      // m
        subdrill: 1.0,          // m
        holeDiameter: 76,       // mm
        holeAngle: 90,          // degrees (inclination)
        stemmingHeight: 2.2,    // m
        explosiveDensity: 1.15, // g/cm³
        rockDensity: 2.65,      // t/m³
        bsRatio: 1.25,          // W-S ratio (1 : S)
        chargeConcentration: 3.60, // kg/m — 신규 공 기본 ANFO/하부장약 밀도(lb). Langefors 자동 설계 실행 시 동기화된다.
        chargeMode: 'single',    // 'single'(ANFO) | 'dual'(에멀젼) — Langefors 폭약 종류 선택에서 동기화
        columnChargeRatio: 0.5,  // 이중장약 상부장약 비율 (lc/lb)
        designBMax: null         // 최근 Langefors 자동 설계의 이론상 최대저항선(B_max) — 이중장약 h_b=1.3×B_max 계산에 필요
    },
    // Graphics state
    canvasMode: false,          // true = GPS 지도 없이 빈 캔버스에서만 설계 (드론/GPS 무관, 로컬 x,y만 사용)
    modeDesigns: { canvas: null, gps: null }, // 비활성 모드의 설계(공/패턴/undo이력) 보관함 — applyCanvasMode()가 전환 시 스왑
    scaleFactor: 0.01,          // meters per pixel (default: 0.01m per user request)
    isScaleCalibrated: false,
    holes: [],                  // Array of blast holes
    freeFace: [],               // Array of points defining the face line [{x, y}, ...]
    rows: {},                   // Grouping of holes by row: { rowName: [holeId, ...] }
    rowColors: [
        '#00f3ff', // cyan
        '#10b981', // green
        '#f59e0b', // amber
        '#a855f7', // purple
        '#ec4899', // pink
        '#3b82f6'  // blue
    ],
    nextRowIndex: 1,
    customMeasurements: [],     // Custom persistent lines: [{ fromHoleId, toHoleId }]
    activeMeasurement: null,    // Dragging measurement: { fromHoleId, currentPos, toHoleId }
    hoveredHoleId: null,        // Hovered hole ID
    flashingHoleIds: [],        // 발파 시뮬레이션 재생 중 현재 기폭(폭발 애니메이션) 중인 공 ID 목록
    flashStartTime: 0,          // flashingHoleIds가 마지막으로 세팅된 시각(performance.now()) — 폭발 애니메이션 진행률 계산용
    simStepIndex: -1,           // 발파 시뮬레이션 현재 지발 스텝 인덱스(0-based). -1 = 아직 재생 안 함
    autoPatterns: [],           // Burden-Spacing auto pattern blocks: [{ id, h1Id, h2Id, h3Id, h4Id }]
    activeWSPattern: null,      // Dragging preview pattern: { h1Id, h1Pos, currentPos }
    tempABLine: null,           // Temporary line object while drawing: { start, end }
    abLineDirection: 1,         // Direction multiplier: 1 or -1
    abPatterns: [],             // Saved patterns from A-B lines: [{ id, start, end, burden, spacing, numRows, stagger }]
    tempFreeFace: [],           // Points being clicked for a new free-face polyline (not yet confirmed)
    tempFreeFaceCursor: null,   // Current mouse world position, for the rubber-band preview segment while drawing
    faceLineDirection: 1,       // Direction multiplier for free-face offset: 1 or -1
    freeFacePatterns: [],       // Saved patterns generated from the free face: [{ id, sourceFace, burden, spacing, numRows, stagger, direction, holeIds }]

    // 분석 도구: 진동(PPV) 해석 / 계측 회귀분석
    securityStructures: [],     // 보안물건: [{ id, name, category, lat, lng, allowedPPV }]
    nextSecurityStructureId: 1,
    testBlastSessions: [],      // 시험발파 회차 이력: [{ id, label, dataPoints:[{R,W,V}] }]
    nextTestBlastSessionId: 1,
    activeTestBlastSessionId: null,
    vibrationConstants: { K: 200, n: 1.6 }, // buildVibrationTable()이 참조하는 현재 적용 K,n (회귀분석 "적용" 시 갱신)

    // 분석 도구: 국토부 표준공법 분류 / 비산(Flyrock) 안전거리
    flyrockConstants: { k: 20 }, // Richards-Moore 암반정수 k (연암 13.5 ~ 경암 27, 화면에서 직접 보정)

    // 분석 도구: Kuz-Ram 파쇄도 (Lilly Blastability Index 입력값)
    kuzramInputs: {
        explosiveType: 'ANFO', // EXPLOSIVE_PRESETS 키 — RWS(상대중량강도) 조회용
        rmdCategory: 'blocky',  // 'powdery'(10) | 'blocky'(JF=JPS+JPA) | 'massive'(50)
        jps: 20,                // 절리 간격 등급: 10/20/80/50
        jpa: 30,                // 절리 방향 등급: 10/20/30/40
        ucs: 100,               // 일축압축강도 (MPa)
        youngsModulus: 30,      // 영률 E (GPa)
        drillDeviation: 0.05    // 천공 정밀도 편차 W (m)
    },

    // Active UI states
    selectedTool: 'pan',        // pan, calibrate, add-hole, ws-pattern, ab-line, draw-face, box-pattern
    selectedHoleId: null,
    selectedHoleIds: [],        // 다중 선택된 공 ID 목록 (Shift/Ctrl+클릭)
    draggingHoleId: null,       // 공 이동 툴로 현재 드래그 중인 공 ID
    tempBoxPattern: null,       // 박스 패턴 드래그 중 미리보기: { start: {x,y}, current: {x,y} }
    isBoxSelecting: false,      // Shift+드래그 박스 선택 진행 중 여부
    tempSelectionBox: null,     // 박스 선택 드래그 중 미리보기: { start: {x,y}, current: {x,y} }
    
    // Canvas Pan & Zoom state
    zoom: 1.0,
    panX: 0,
    panY: 0,
    isPanning: false,
    startX: 0,
    startY: 0,
    
    // Draw states for tools
    tempScaleLine: null,        // { start: {x,y}, end: {x,y} }
    tempHolePreview: null,      // { fromHoleId, currentPos }
    tempRowLine: null,          // { start: {x,y}, end: {x,y} }
    isDrawing: false,
    
    // Image loading
    bgImage: null,
    imageLoaded: false,
    
    // GIS Map Engine
    vworldApiKey: '',
    ngiiApiKey: '',
    baseMapType: 'ngii',
    map: null,
    geoTiffLayer: null,         // Active OpenLayers WebGLTile layer for GeoTIFF orthophotos
    currentTif: null,           // Current TIF metadata (extent, projection, dataUrl) for cloud saving
    isRightClickPanning: false, // Track state of right-click map panning in any tool mode
    startMapPanPixel: null,     // Starting mouse position for right-click panning
    startMapCenter: null,       // Starting map center coordinate for right-click panning
    
    // 3D Terrain Georeference Offset (default to Center of Korea in Web Mercator EPSG:3857)
    terrainOffset: { x: 14192661.12, y: 4369725.68 },

    three: {
        scene: null,
        camera: null,
        renderer: null,
        controls: null,
        objectsGroup: null,
        active: false,
        terrainMesh: null,       // loaded THREE.Mesh or THREE.Group
        terrainWireframe: null,  // wireframe overlay
        terrainIsSynthetic: false,
        heightGrid: null         // Store compiled point cloud elevation mapping grid
    }
};

// Helper to set terrainOffset with array and object compatibility (adds .x and .y to the coordinate array)
export function setTerrainOffset(coordArray) {
    if (Array.isArray(coordArray)) {
        state.terrainOffset = coordArray;
        state.terrainOffset.x = coordArray[0];
        state.terrainOffset.y = coordArray[1];
    } else if (coordArray) {
        state.terrainOffset = [coordArray.x, coordArray.y];
        state.terrainOffset.x = coordArray.x;
        state.terrainOffset.y = coordArray.y;
    }
}

export const dom = {
    canvas: document.getElementById('editor-canvas'),
    ctx: document.getElementById('editor-canvas').getContext('2d'),
    container2d: document.getElementById('container-2d'),
    container3d: document.getElementById('container-3d'),
    toggle2d: document.getElementById('toggle-2d'),
    toggle3d: document.getElementById('toggle-3d'),
    btnClearHoles: document.getElementById('btn-clear-holes'),
    btnScaleSave: document.getElementById('btn-scale-save'),
    btnScaleCancel: document.getElementById('btn-scale-cancel'),
    scaleModal: document.getElementById('scale-modal'),
    inputScaleDistance: document.getElementById('input-scale-distance'),
    scaleIndicator: document.getElementById('scale-indicator'),
    instructionText: document.getElementById('instruction-text'),
    gpsIndicator: document.getElementById('gps-indicator'),
    editorMap: document.getElementById('editor-map'),
    inputNgiiKey: document.getElementById('input-ngii-key'),
    inputVworldKey: document.getElementById('input-vworld-key'),
    selectBaseMap: document.getElementById('select-base-map'),
    dropZoneTif: document.getElementById('drop-zone-tif'),
    fileUploaderTif: document.getElementById('file-uploader-tif'),
    
    // Inputs
    inputTargetSpacing: document.getElementById('input-target-spacing'),
    inputTargetBurden: document.getElementById('input-target-burden'),
    inputBenchHeight: document.getElementById('input-bench-height'),
    inputSubdrill: document.getElementById('input-subdrill'),
    inputHoleDiameter: document.getElementById('input-hole-diameter'),
    inputHoleAngle: document.getElementById('input-hole-angle'),
    inputStemmingHeight: document.getElementById('input-stemming-height'),
    inputExplosiveDensity: document.getElementById('input-explosive-density'),
    inputRockDensity: document.getElementById('input-rock-density'),
    inputBsRatio: document.getElementById('input-bs-ratio'),
    
    // A-B Line Modal elements
    abModal: document.getElementById('abline-modal'),
    abInputBurden: document.getElementById('ab-input-burden'),
    abInputSpacing: document.getElementById('ab-input-spacing'),
    abInputRows: document.getElementById('ab-input-rows'),
    abInputStagger: document.getElementById('ab-input-stagger'),
    abInputAngle: document.getElementById('ab-input-angle'),
    abInputRowDelay: document.getElementById('ab-input-row-delay'),
    abInputSpacingDelay: document.getElementById('ab-input-spacing-delay'),
    btnAbFlip: document.getElementById('btn-ab-flip'),
    btnAbCancel: document.getElementById('btn-ab-cancel'),
    btnAbGenerate: document.getElementById('btn-ab-generate'),
    abInfoLength: document.getElementById('ab-info-length'),
    abInfoHoles: document.getElementById('ab-info-holes'),

    // Free Face Pattern Modal elements
    faceModal: document.getElementById('face-pattern-modal'),
    faceInputBurden: document.getElementById('face-input-burden'),
    faceInputSpacing: document.getElementById('face-input-spacing'),
    faceInputRows: document.getElementById('face-input-rows'),
    faceInputStagger: document.getElementById('face-input-stagger'),
    faceInputAngle: document.getElementById('face-input-angle'),
    faceInputRowDelay: document.getElementById('face-input-row-delay'),
    faceInputSpacingDelay: document.getElementById('face-input-spacing-delay'),
    faceBurdenAutoNote: document.getElementById('face-burden-auto-note'),
    btnFaceFlip: document.getElementById('btn-face-flip'),
    btnFaceCancel: document.getElementById('btn-face-cancel'),
    btnFaceGenerate: document.getElementById('btn-face-generate'),
    faceInfoLength: document.getElementById('face-info-length'),
    faceInfoHoles: document.getElementById('face-info-holes'),

    // Dashboards
    valTotalHoles: document.getElementById('val-total-holes'),
    valAvgSpacing: document.getElementById('val-avg-spacing'),
    valAvgBurden: document.getElementById('val-avg-burden'),
    valTotalDrillLength: document.getElementById('val-total-drill-length'),
    valTotalVolume: document.getElementById('val-total-volume'),
    valTotalTonnage: document.getElementById('val-total-tonnage'),
    valExplosivePerHole: document.getElementById('val-explosive-per-hole'),
    valTotalExplosive: document.getElementById('val-total-explosive'),
    valPowderFactor: document.getElementById('val-powder-factor'),
    valPfStatus: document.getElementById('val-pf-status'),

    // Materials
    matBulkExplosive: document.getElementById('mat-bulk-explosive'),
    matBooster: document.getElementById('mat-booster'),
    matDetonator: document.getElementById('mat-detonator'),
    matTrunkline: document.getElementById('mat-trunkline'),
    
    // Tab switching
    tabSummary: document.getElementById('tab-summary'),
    tabLoadingSheet: document.getElementById('tab-loading-sheet'),
    tabContentSummary: document.getElementById('tab-content-summary'),
    tabContentLoadingSheet: document.getElementById('tab-content-loading-sheet'),
    loadingSheetTbody: document.getElementById('loading-sheet-tbody'),

    // Print & Projects
    btnPrintReport: document.getElementById('btn-print-report'),
    btnNewProject: document.getElementById('btn-new-project'),
    btnExportJson: document.getElementById('btn-export-json'),
    btnExportCsv: document.getElementById('btn-export-csv'),
    importFile: document.getElementById('import-file'),

    // 3D Terrain Loader Elements
    dropZone3D: document.getElementById('drop-zone-3d'),
    fileUploader3D: document.getElementById('file-uploader-3d'),
    btnLoadDemo3D: document.getElementById('btn-load-demo-3d'),
    chkRealScale3D: document.getElementById('chk-real-scale-3d'),
    
    // LAZ Point Cloud Loader Elements
    dropZoneLaz: document.getElementById('drop-zone-laz'),
    fileUploaderLaz: document.getElementById('file-uploader-laz'),

    // 3D Terrain GPS Modal Elements
    terrainGpsModal: document.getElementById('terrain-gps-modal'),
    inputTerrainLat: document.getElementById('terrain-lat'),
    inputTerrainLon: document.getElementById('terrain-lon'),
    selectTerrainCoordType: document.getElementById('terrain-coord-type'),
    terrainScaleInfo: document.getElementById('terrain-scale-info'),
    btnTerrainGpsCancel: document.getElementById('btn-terrain-gps-cancel'),
    btnTerrainGpsApply: document.getElementById('btn-terrain-gps-apply')
};

export const history = {
    undoStack: [],
    redoStack: [],
    save() {
        this.undoStack.push(this._snapshot());
        if (this.undoStack.length > 50) this.undoStack.shift();
        this.redoStack = []; // Clear redo stack on new action
        this.updateButtons();
    },
    undo() {
        if (this.undoStack.length === 0) return;
        this.redoStack.push(this._snapshot());
        this._restore(this.undoStack.pop());
        this.applyStateChange();
        this.updateButtons();
    },
    redo() {
        if (this.redoStack.length === 0) return;
        this.undoStack.push(this._snapshot());
        this._restore(this.redoStack.pop());
        this.applyStateChange();
        this.updateButtons();
    },
    // 실행취소/재실행 대상이 되는 모든 활동(발파공, 자유면, 각종 패턴, 측정선 등)을 한 곳에서 스냅샷/복원
    _snapshot() {
        return {
            holes: JSON.parse(JSON.stringify(state.holes)),
            freeFace: JSON.parse(JSON.stringify(state.freeFace)),
            freeFacePatterns: JSON.parse(JSON.stringify(state.freeFacePatterns)),
            abPatterns: JSON.parse(JSON.stringify(state.abPatterns)),
            autoPatterns: JSON.parse(JSON.stringify(state.autoPatterns)),
            customMeasurements: JSON.parse(JSON.stringify(state.customMeasurements)),
            rows: JSON.parse(JSON.stringify(state.rows)),
            nextRowIndex: state.nextRowIndex,
            scaleFactor: state.scaleFactor,
            isScaleCalibrated: state.isScaleCalibrated
        };
    },
    _restore(snapshot) {
        state.holes = snapshot.holes;
        state.freeFace = snapshot.freeFace;
        state.freeFacePatterns = snapshot.freeFacePatterns || [];
        state.abPatterns = snapshot.abPatterns || [];
        state.autoPatterns = snapshot.autoPatterns || [];
        state.customMeasurements = snapshot.customMeasurements || [];
        state.rows = snapshot.rows;
        state.nextRowIndex = snapshot.nextRowIndex;
        state.scaleFactor = snapshot.scaleFactor;
        state.isScaleCalibrated = snapshot.isScaleCalibrated;
    },
    applyStateChange() {
        if (state.isScaleCalibrated) {
            dom.scaleIndicator.textContent = `기준자 설정됨 (1px = ${state.scaleFactor.toFixed(4)}m)`;
            dom.scaleIndicator.parentElement.style.borderLeftColor = 'var(--accent-green)';
        } else {
            dom.scaleIndicator.textContent = `스케일 미설정 (기본: 1px = ${state.scaleFactor.toFixed(4)}m)`;
            dom.scaleIndicator.parentElement.style.borderLeftColor = 'var(--accent-purple)';
        }
        recalculateBurdenSpacing();
        updateDashboard();
        draw2D();
        if (state.three.active) update3DView();
    },
    updateButtons() {
        const btnUndo = document.getElementById('btn-undo');
        const btnRedo = document.getElementById('btn-redo');
        if (btnUndo) {
            if (this.undoStack.length > 0) {
                btnUndo.removeAttribute('disabled');
                btnUndo.style.opacity = '1';
                btnUndo.style.cursor = 'pointer';
            } else {
                btnUndo.setAttribute('disabled', 'true');
                btnUndo.style.opacity = '0.5';
                btnUndo.style.cursor = 'not-allowed';
            }
        }
        if (btnRedo) {
            if (this.redoStack.length > 0) {
                btnRedo.removeAttribute('disabled');
                btnRedo.style.opacity = '1';
                btnRedo.style.cursor = 'pointer';
            } else {
                btnRedo.setAttribute('disabled', 'true');
                btnRedo.style.opacity = '0.5';
                btnRedo.style.cursor = 'not-allowed';
            }
        }
    }
};
