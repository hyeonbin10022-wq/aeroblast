// 설계 모드 (GPS 모드 ↔ 캔버스 모드) 전용 로직.
// 다른 조각들과 달리 이벤트 바인딩을 src/ui/events.js의 공유 클로저에 얹지 않고
// 이 파일 하나에 모아둔다 — 상태(state.canvasMode)와 DOM 반영이 이 기능 안에서 닫혀 있어
// 공유 클로저 의존성이 없기 때문.
//
// 캔버스 모드 = state.map은 그대로 살려두되(재생성 비용 회피) 타일 레이어만 비우고,
// editor-canvas의 pointer-events를 auto로 돌려 지도 대신 캔버스가 직접 마우스/휠 입력을
// 받게 한다 (switchView('2d')가 GPS 모드에서 이미 하는 것과 동일한 토글).
// screenToWorld/worldToScreen 등은 state.canvasMode를 보고 로컬 픽셀(scaleFactor) 좌표계로
// 자동 전환되므로(이미 구현됨), 여기서는 화면 요소 표시/숨김만 책임진다.

import { state, dom, history } from '../../../core/state.js';
import { draw2D } from '../../../render/canvas2d.js';
import { updateDashboard } from '../../../ui/events.js';

// 캔버스 모드 ↔ GPS 모드가 "같은 설계를 보는 관점"이 아니라 서로 독립된 설계가 되도록,
// 모드 전환 시 여기 나열된 필드를 통째로 스왑한다. history._snapshot()이 실행취소 대상으로
// 잡는 필드와 동일한 목록 — 즉 "설계"로 취급되는 범위를 undo와 동일하게 맞춘 것.
const DESIGN_FIELDS = ['holes', 'freeFace', 'freeFacePatterns', 'abPatterns', 'autoPatterns', 'customMeasurements', 'rows', 'nextRowIndex', 'scaleFactor', 'isScaleCalibrated'];

function captureDesign() {
    const snap = { undoStack: history.undoStack, redoStack: history.redoStack };
    DESIGN_FIELDS.forEach(f => { snap[f] = state[f]; });
    return snap;
}

function restoreDesign(snap) {
    if (snap) {
        DESIGN_FIELDS.forEach(f => { state[f] = snap[f]; });
        history.undoStack = snap.undoStack;
        history.redoStack = snap.redoStack;
    } else {
        // 해당 모드로 처음 전환 — 빈 설계로 시작 (scaleFactor/보정 여부는 이어받아 둔다)
        state.holes = [];
        state.freeFace = [];
        state.freeFacePatterns = [];
        state.abPatterns = [];
        state.autoPatterns = [];
        state.customMeasurements = [];
        state.rows = {};
        state.nextRowIndex = 1;
        history.undoStack = [];
        history.redoStack = [];
    }
    history.updateButtons();
}

export function applyCanvasMode(enabled, { initMap } = {}) {
    if (state.canvasMode !== enabled) {
        state.modeDesigns[state.canvasMode ? 'canvas' : 'gps'] = captureDesign();
        restoreDesign(state.modeDesigns[enabled ? 'canvas' : 'gps']);
    }
    state.canvasMode = enabled;

    dom.canvas.style.pointerEvents = enabled ? 'auto' : 'none';

    const droneSection = document.querySelector('[data-accordion="drone-data"]');
    if (droneSection) droneSection.style.display = enabled ? 'none' : '';

    const gpsOverlay = document.querySelector('.gps-overlay');
    if (gpsOverlay) gpsOverlay.style.display = enabled ? 'none' : '';

    document.getElementById('mode-btn-gps')?.classList.toggle('active', !enabled);
    document.getElementById('mode-btn-canvas')?.classList.toggle('active', enabled);

    if (enabled) {
        if (state.map) state.map.setLayers([]); // 타일 제거 → .workspace-area 다크 배경 + 캔버스 그리드 노출
        // GPS 지도 모드에서는 draw2D()가 매 프레임 state.scaleFactor를 지도 해상도(예: 도시 축소뷰의
        // 수십 m/px)로 덮어쓴다 — 사용자가 캔버스 모드에서 따로 스케일을 보정(calibrate)한 적이 없다면
        // 그 지도용 값이 그대로 남아 그리드/라벨이 서브픽셀 간격으로 찌그러진다. 기본값으로 되돌린다.
        if (!state.isScaleCalibrated) state.scaleFactor = 0.01;
        // 원점(0,0)이 화면 정중앙에 오도록 pan을 리셋 — worldToScreen(0,0) = (panX, panY)이므로
        // 캔버스 모드 진입 시마다 항상 원점이 바로 보이게 한다. zoom도 최소값(0.2, events.js
        // 휠줌 클램프 하한과 동일)으로 낮춰 원점+자유면 가이드선(Y=-6m)이 한 화면에 다 들어오게 한다.
        state.zoom = 0.2;
        state.panX = dom.canvas.width / 2;
        state.panY = dom.canvas.height / 2;
    } else if (initMap) {
        initMap(); // GPS 모드 복귀: 베이스맵/GeoTIFF 레이어 복원
    }

    updateDashboard(); // 스왑된 설계(공 개수 등)로 오른쪽 사이드바/발파 시뮬 패널 즉시 갱신
    draw2D();
}

export function initDesignMode({ initMap }) {
    document.getElementById('mode-btn-gps')?.addEventListener('click', () => applyCanvasMode(false, { initMap }));
    document.getElementById('mode-btn-canvas')?.addEventListener('click', () => applyCanvasMode(true, { initMap }));
}
