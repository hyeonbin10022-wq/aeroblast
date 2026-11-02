// 발파공 편집 아코디언 (구 플로팅 팝업) — 단일 선택(장약 방식/ANFO 중량/밀도/전색/기폭약 편집) + 다중 선택(일괄 수정)
// + 선택 공 좌표정보/txt 출력. 공 선택 시 자동 펼침 + 오른쪽 "벤치 단면도" 탭 자동 전환, 선택 해제 시 자동 접힘.
// 입력/계산 로직은 팝업 시절 events.js에 있던 것을 그대로 옮겼다(동작 변경 없음).
// 공 좌표는 holeToLonLat()이 GPS/캔버스 모드를 알아서 처리하므로 모드별 분기가 필요 없다.

import { state, dom, history } from '../../../core/state.js';
import { draw2D } from '../../../render/canvas2d.js';
import { update3DView } from '../../../render/canvas3d.js';
import { recalculateBurdenSpacing, renderLoadingSheetTable } from '../../../patterns/blastPatterns.js';
import { calculateHoleCharge, applyAnfoWeightEdit, applyColumnChargeWeightEdit, applyBatchUpdate, PRIMER } from '../../../core/blastEngine.js';
import { holeToLonLat } from '../../../utils/geoConvert.js';
import { updateDashboard, showToast, renderBlastSimPanel } from '../../../ui/events.js';
import { renderBenchProfileView } from '../../rightSidebar(오른쪽사이드바)/benchProfile(벤치단면도)/benchProfile(벤치단면도).js';

function reactToHoleEdit() {
    recalculateBurdenSpacing();
    updateDashboard();
    renderLoadingSheetTable();
    draw2D();
    if (state.three.active) update3DView();
}

// 선택된 공들의 좌표(위경도) + 발파 수치를 계산 — exportProjectCSV()와 동일한 GPS 변환/수치를 재사용.
function buildCoordInfoRows(ids) {
    return ids
        .map(id => state.holes.find(h => h.id === id))
        .filter(Boolean)
        .map(h => {
            const { lat, lon } = holeToLonLat(state, h);
            return {
                id: h.id,
                lat, lon,
                burden: h.burden,
                spacing: h.spacing,
                depth: h.depth_H,
                explosive: calculateHoleCharge(h).totalWeight
            };
        });
}

// "공 좌표정보" 펼침 목록을 최신 선택 상태로 갱신 (펼쳐져 있을 때만 다시 그림).
function updateCoordInfoSection(ids) {
    const list = document.getElementById('hole-coord-info-list');
    if (!list || list.classList.contains('hidden')) return;
    const rows = buildCoordInfoRows(ids);
    list.textContent = rows.length
        ? rows.map(r => `Hole #${r.id}: 위도 ${r.lat.toFixed(8)}, 경도 ${r.lon.toFixed(8)}`).join('\n')
        : '선택된 공이 없습니다.';
}

// 선택이 "바뀐" 순간에만 아코디언 펼침/접힘 + 단면도 탭 전환 — 입력 편집마다 재호출되므로
// 매번 강제하면 사용자가 다른 탭을 보고 있어도 계속 끌려온다.
let lastSelectionKey = '';

export function renderHoleEditPanel() {
    const section = document.querySelector('[data-accordion="hole-editor"]');
    const singleEl = document.getElementById('hole-editor-single');
    const batchEl = document.getElementById('hole-editor-batch');
    if (!section || !singleEl || !batchEl) return;

    const ids = state.selectedHoleIds;
    updateCoordInfoSection(ids);

    const key = ids.join(',');
    if (key !== lastSelectionKey) {
        lastSelectionKey = key;
        section.classList.toggle('open', ids.length > 0);
        if (ids.length > 0) document.getElementById('tab-bench-profile').click();
    }
    renderBenchProfileView();

    const empty = ids.length === 0;
    document.getElementById('hole-editor-empty').style.display = empty ? '' : 'none';
    document.getElementById('hole-coord-info-section').style.display = empty ? 'none' : '';
    document.getElementById('hole-editor-title').textContent = '';

    if (empty) {
        singleEl.style.display = 'none';
        batchEl.style.display = 'none';
        renderBlastSimPanel();
        return;
    }

    if (ids.length === 1) {
        const hole = state.holes.find(h => h.id === ids[0]);
        if (!hole) {
            state.selectedHoleIds = [];
            renderHoleEditPanel();
            return;
        }
        singleEl.style.display = '';
        batchEl.style.display = 'none';

        const isDual = hole.chargeMode === 'dual';
        document.getElementById('hole-editor-title').textContent = `[Hole #${hole.id}]`;
        const charge = calculateHoleCharge(hole);
        document.getElementById('input-hole-charge-mode').value = hole.chargeMode ?? 'single';
        document.getElementById('hole-anfo-weight-label').textContent = isDual ? '에멀젼 중량 (상부)' : 'ANFO 중량 (기폭약 별도)';
        document.getElementById('input-hole-anfo-weight').value = isDual ? charge.columnChargeWeight : charge.anfoWeight;
        document.getElementById('hole-column-ratio-row').style.display = isDual ? '' : 'none';
        document.getElementById('input-hole-column-ratio').value = hole.columnChargeRatio ?? 0.5;
        document.getElementById('hole-anfo-density-label').textContent = isDual ? '에멀젼 밀도 (하부)' : 'ANFO 밀도';
        document.getElementById('input-hole-anfo-density').value = hole.anfoDensity;
        document.getElementById('input-hole-stemming').value = hole.stemming_h0;
        document.getElementById('hole-primer-weight-row').style.display = isDual ? 'none' : '';
        document.getElementById('hole-primer-length-row').style.display = isDual ? 'none' : '';
        document.getElementById('input-hole-primer-weight').value = hole.primerWeight ?? PRIMER.weight;
        document.getElementById('input-hole-primer-length').value = hole.primerLength ?? PRIMER.length;
        renderBlastSimPanel();
        return;
    }

    // 다중 선택
    singleEl.style.display = 'none';
    batchEl.style.display = '';
    document.getElementById('hole-editor-batch-title').textContent = `${ids.length}개 공 선택됨`;
    renderBlastSimPanel();
}

function deselectAll() {
    if (state.selectedHoleIds.length === 0) return;
    state.selectedHoleIds = [];
    renderHoleEditPanel();
    draw2D();
}

export function initHoleEditor() {
    // 선택 해제 — 팝업의 닫기 버튼/바깥 클릭을 대체: ESC, 또는 이동/선택 도구로 빈 곳을 "클릭"(드래그 이동은 제외).
    // GPS 모드는 지도(editorMap)가, 캔버스 모드는 캔버스가 마우스를 받으므로 둘 다 듣는다.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) deselectAll();
    });
    let downAt = null;
    [dom.canvas, dom.editorMap].filter(Boolean).forEach(el => {
        el.addEventListener('mousedown', (e) => { downAt = [e.clientX, e.clientY]; });
        el.addEventListener('click', (e) => {
            const moved = !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4;
            if (!moved && state.selectedTool === 'pan' && !state.hoveredHoleId && !e.shiftKey && !e.ctrlKey) deselectAll();
        });
    });

    document.getElementById('input-hole-charge-mode').addEventListener('change', (e) => {
        const hole = state.holes.find(h => h.id === state.selectedHoleIds[0]);
        if (!hole) return;
        hole.chargeMode = e.target.value;
        if (hole.chargeMode === 'dual' && hole.columnChargeRatio === undefined) hole.columnChargeRatio = 0.5;
        hole.isModified = true;
        renderHoleEditPanel();
        reactToHoleEdit();
    });
    document.getElementById('input-hole-anfo-weight').addEventListener('input', (e) => {
        const hole = state.holes.find(h => h.id === state.selectedHoleIds[0]);
        const val = parseFloat(e.target.value);
        if (!hole || isNaN(val)) return;
        if (hole.chargeMode === 'dual') {
            applyColumnChargeWeightEdit(hole, val);
        } else {
            applyAnfoWeightEdit(hole, val);
        }
        renderHoleEditPanel();
        reactToHoleEdit();
    });
    document.getElementById('input-hole-column-ratio').addEventListener('input', (e) => {
        const hole = state.holes.find(h => h.id === state.selectedHoleIds[0]);
        const val = parseFloat(e.target.value);
        if (!hole || isNaN(val) || val <= 0) return;
        hole.columnChargeRatio = val;
        hole.isModified = true;
        renderHoleEditPanel();
        reactToHoleEdit();
    });
    document.getElementById('input-hole-anfo-density').addEventListener('input', (e) => {
        const hole = state.holes.find(h => h.id === state.selectedHoleIds[0]);
        const val = parseFloat(e.target.value);
        if (!hole || isNaN(val) || val <= 0) return;
        hole.anfoDensity = val;
        hole.isModified = true;
        renderHoleEditPanel();
        reactToHoleEdit();
    });
    document.getElementById('input-hole-stemming').addEventListener('input', (e) => {
        const hole = state.holes.find(h => h.id === state.selectedHoleIds[0]);
        const val = parseFloat(e.target.value);
        if (!hole || isNaN(val) || val < 0) return;
        hole.stemming_h0 = val;
        hole.isModified = true;
        renderHoleEditPanel();
        reactToHoleEdit();
    });
    document.getElementById('input-hole-primer-weight').addEventListener('input', (e) => {
        const hole = state.holes.find(h => h.id === state.selectedHoleIds[0]);
        const val = parseFloat(e.target.value);
        if (!hole || isNaN(val) || val < 0) return;
        hole.primerWeight = val;
        hole.isModified = true;
        renderHoleEditPanel();
        reactToHoleEdit();
    });
    document.getElementById('input-hole-primer-length').addEventListener('input', (e) => {
        const hole = state.holes.find(h => h.id === state.selectedHoleIds[0]);
        const val = parseFloat(e.target.value);
        if (!hole || isNaN(val) || val < 0) return;
        hole.primerLength = val;
        hole.isModified = true;
        renderHoleEditPanel();
        reactToHoleEdit();
    });
    document.getElementById('btn-batch-apply').addEventListener('click', () => {
        if (state.selectedHoleIds.length === 0) return;
        const patch = {};
        const density = parseFloat(document.getElementById('input-batch-anfo-density').value);
        const stemming = parseFloat(document.getElementById('input-batch-stemming').value);
        if (!isNaN(density) && density > 0) patch.anfoDensity = density;
        if (!isNaN(stemming) && stemming >= 0) patch.stemming_h0 = stemming;
        if (Object.keys(patch).length === 0) return;
        history.save();
        const appliedCount = state.selectedHoleIds.length;
        applyBatchUpdate(state.selectedHoleIds, patch);
        document.getElementById('input-batch-anfo-density').value = '';
        document.getElementById('input-batch-stemming').value = '';
        state.selectedHoleIds = [];
        renderHoleEditPanel();
        reactToHoleEdit();
        showToast(`${appliedCount}개 공 일괄 수정 완료`, 'check-circle');
    });

    document.getElementById('btn-toggle-coord-info').addEventListener('click', () => {
        const list = document.getElementById('hole-coord-info-list');
        list.classList.toggle('hidden');
        updateCoordInfoSection(state.selectedHoleIds);
    });
    document.getElementById('btn-coord-info-export').addEventListener('click', () => {
        if (state.selectedHoleIds.length === 0) {
            showToast('선택된 공이 없습니다.', 'warning');
            return;
        }
        const rows = buildCoordInfoRows(state.selectedHoleIds);
        let txtContent = 'Hole ID\t위도\t경도\t저항선(m)\t공간격(m)\t천공깊이(m)\t장약량(kg)\n';
        rows.forEach(r => {
            txtContent += `${r.id}\t${r.lat.toFixed(8)}\t${r.lon.toFixed(8)}\t${r.burden.toFixed(2)}\t${r.spacing.toFixed(2)}\t${r.depth.toFixed(1)}\t${r.explosive.toFixed(1)}\n`;
        });
        const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `aeroblast_selected_coords_${Date.now()}.txt`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showToast('선택 공 좌표 txt 내보내기 완료', 'check-circle');
    });
}
