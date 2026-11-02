// AeroBlast Pro - "국토부/비장약량" 전체화면 오버레이 렌더링 + 이벤트 바인딩
//
// vibrationTable.js(W_max)·blastEngine.js(실제 설계 요약치)·flyrockEngine.js(국토부 Type/비산공식)를
// 조합해 국토부 표준공법 Type 분류표와 비산(Flyrock) 안전거리 카드를 그린다. state.flyrockConstants.k가
// 단일 소스이며, 여기서 바꾸면 updateDashboard() 경유로 이 화면이 즉시 재계산된다.

import { state } from '../core/state.js';
import { calculateWMax } from '../core/vibrationTable.js';
import { getDesignSummary } from '../core/blastEngine.js';
import { classifyMoctType, calculateFlyrock } from '../core/flyrockEngine.js';
import { getHolesCentroidLonLat, getDistanceMeters } from '../utils/geoConvert.js';

export function renderMoctAnalysisView() {
    const { wMax } = calculateWMax(state.holes);
    const moct = classifyMoctType(wMax);

    document.getElementById('ov-moct-wmax').textContent = wMax.toFixed(2);
    document.getElementById('ov-moct-type-badge').textContent = `TYPE ${moct.type}`;
    document.getElementById('ov-moct-type-label').textContent = moct.label;

    document.getElementById('ov-moct-type-tbody').innerHTML = moct.table.map(row => {
        const isActive = row.type === moct.type;
        const rangeLabel = row.max === Infinity ? `${moct.table[moct.table.indexOf(row) - 1]?.max ?? 0} 이상` : `< ${row.max}`;
        return `
            <tr style="${isActive ? 'background: color-mix(in srgb, var(--accent-green) 12%, transparent);' : ''}">
                <td>${isActive ? `<span class="badge badge-safe">TYPE ${row.type}</span>` : `TYPE ${row.type}`}</td>
                <td>${row.label}</td>
                <td>${rangeLabel} kg/delay</td>
            </tr>
        `;
    }).join('');

    const summary = getDesignSummary(state.holes, state.params.benchHeight);
    const k = state.flyrockConstants.k;
    document.getElementById('ov-moct-input-k').value = k;

    const flyrock = calculateFlyrock({
        m: state.params.chargeConcentration,
        B: summary.avgBurden || state.params.targetBurden,
        SH: state.params.stemmingHeight,
        thetaDeg: state.params.holeAngle,
        q: summary.q,
        holeDiameterMm: state.params.holeDiameter,
        k,
    });

    document.getElementById('ov-moct-face-burst').textContent = flyrock.faceBurst.toFixed(1);
    document.getElementById('ov-moct-cratering').textContent = flyrock.cratering.toFixed(1);
    document.getElementById('ov-moct-stemming').textContent = flyrock.stemmingEjection.toFixed(1);
    document.getElementById('ov-moct-lmax').textContent = flyrock.lmaxDesign.toFixed(1);
    document.getElementById('ov-moct-equip-clearance').textContent = flyrock.equipmentClearance.toFixed(1);
    document.getElementById('ov-moct-personnel-clearance').textContent = flyrock.personnelClearance.toFixed(1);

    document.getElementById('ov-moct-lundborg-l').textContent = flyrock.lundborgApplicable ? flyrock.lundborgL.toFixed(1) : '— (q≤0.2, 미적용)';
    document.getElementById('ov-moct-lundborg-phi').textContent = flyrock.lundborgPhi.toFixed(2);
    document.getElementById('ov-moct-lundborg-lmax').textContent = flyrock.lundborgLmax.toFixed(1);

    // 가장 가까운 보안물건까지 거리와 이격거리 기준 비교
    const centroid = getHolesCentroidLonLat(state);
    let nearestDistance = null;
    if (centroid && state.securityStructures.length > 0) {
        nearestDistance = Math.min(...state.securityStructures.map(s => getDistanceMeters([centroid.lon, centroid.lat], [s.lng, s.lat])));
    }
    const clearanceStatusEl = document.getElementById('ov-moct-clearance-status');
    if (nearestDistance === null) {
        clearanceStatusEl.innerHTML = `<span class="sub-text">등록된 보안물건이 없어 이격거리 판정을 생략합니다.</span>`;
    } else {
        const safeEquip = nearestDistance >= flyrock.equipmentClearance;
        const safePersonnel = nearestDistance >= flyrock.personnelClearance;
        clearanceStatusEl.innerHTML = `
            가장 가까운 보안물건까지 <strong>${nearestDistance.toFixed(1)}m</strong> —
            장비기준 <span class="badge ${safeEquip ? 'badge-safe' : 'badge-danger'}">${safeEquip ? '안전' : '초과'}</span>
            작업자기준 <span class="badge ${safePersonnel ? 'badge-safe' : 'badge-danger'}">${safePersonnel ? '안전' : '초과'}</span>
        `;
    }
}

export function initMoctAnalysisEvents() {
    document.getElementById('ov-moct-input-k').addEventListener('input', (e) => {
        const k = parseFloat(e.target.value);
        if (!(k > 0)) return;
        state.flyrockConstants.k = k;
        renderMoctAnalysisView();
    });
    document.getElementById('ov-moct-btn-soft').addEventListener('click', () => {
        state.flyrockConstants.k = 13.5;
        renderMoctAnalysisView();
    });
    document.getElementById('ov-moct-btn-hard').addEventListener('click', () => {
        state.flyrockConstants.k = 27;
        renderMoctAnalysisView();
    });
}
