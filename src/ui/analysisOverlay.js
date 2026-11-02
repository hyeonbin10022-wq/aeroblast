// AeroBlast Pro - "분석 도구" 전체화면 오버레이 공통 셸 (열기/닫기/ESC + 실시간 갱신 훅)
//
// 사이드바 4버튼 → 해당 오버레이 표시, 닫기버튼/ESC → 복귀. updateDashboard()가 매번
// refreshActiveAnalysisOverlay()를 호출해, 오버레이가 열려있는 동안에도 발파공/설계값 변경이
// 새로고침 없이 즉시 반영되도록 한다(신규 옵저버 프레임워크 없이 기존 갱신 지점에 훅만 추가).

import { renderVibrationAnalysisView, initVibrationAnalysisEvents } from '../render/vibrationAnalysisView.js';
import { renderRegressionAnalysisView, initRegressionAnalysisEvents } from '../render/regressionAnalysisView.js';
import { renderMoctAnalysisView, initMoctAnalysisEvents } from '../render/moctAnalysisView.js';
import { renderKuzramAnalysisView, initKuzramAnalysisEvents } from '../render/kuzramAnalysisView.js';

const OVERLAY_KEYS = ['vibration', 'regression', 'moct', 'kuzram'];
let activeOverlayKey = null;

export function getActiveOverlay() {
    return activeOverlayKey;
}

export function openAnalysisOverlay(key) {
    if (!OVERLAY_KEYS.includes(key)) return;
    activeOverlayKey = key;
    OVERLAY_KEYS.forEach(k => {
        document.getElementById(`overlay-${k}`).classList.toggle('hidden', k !== key);
    });
    refreshActiveAnalysisOverlay();
}

export function closeAnalysisOverlay() {
    if (!activeOverlayKey) return;
    document.getElementById(`overlay-${activeOverlayKey}`).classList.add('hidden');
    activeOverlayKey = null;
}

export function refreshActiveAnalysisOverlay() {
    if (activeOverlayKey === 'vibration') renderVibrationAnalysisView();
    else if (activeOverlayKey === 'regression') renderRegressionAnalysisView();
    else if (activeOverlayKey === 'moct') renderMoctAnalysisView();
    else if (activeOverlayKey === 'kuzram') renderKuzramAnalysisView();
}

document.querySelectorAll('.analysis-tool-btn').forEach(btn => {
    btn.addEventListener('click', () => openAnalysisOverlay(btn.dataset.overlay));
});

document.querySelectorAll('[data-close-overlay]').forEach(btn => {
    btn.addEventListener('click', () => closeAnalysisOverlay());
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeOverlayKey) closeAnalysisOverlay();
});

initVibrationAnalysisEvents();
initRegressionAnalysisEvents();
initMoctAnalysisEvents();
initKuzramAnalysisEvents();
