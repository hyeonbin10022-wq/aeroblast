// AeroBlast Pro - "진동(PPV) 해석" 전체화면 오버레이 렌더링 + 이벤트 바인딩
//
// vibrationTable.js(W_max/PPV 예측)와 geoConvert.js(GPS 거리)를 재사용해, 보안물건별
// 진동 영향성 검토표와 거리별 감쇠 예측 카드를 그린다. state.vibrationConstants가 단일 소스이므로
// 여기서 K/n을 바꾸면 오른쪽 사이드바 요약 카드에도 즉시 반영된다(updateDashboard 경유).

import { state } from '../core/state.js';
import { buildVibrationTable, calculatePPV, DEFAULT_DISTANCES_M, SAFE_THRESHOLD_CM_S } from '../core/vibrationTable.js';
import { holeToLonLat, getHolesCentroidLonLat, getDistanceMeters } from '../utils/geoConvert.js';
import { showToast, updateDashboard } from '../ui/events.js';

const CATEGORY_LABELS = {
    Residential: '주거', Bridge: '교량', Livestock: '축사', Cultural: '문화재', Other: '기타'
};

export function renderVibrationAnalysisView() {
    const { K, n } = state.vibrationConstants;
    document.getElementById('ov-vib-input-k').value = K;
    document.getElementById('ov-vib-input-n').value = n;

    const vibTable = buildVibrationTable(state.holes, DEFAULT_DISTANCES_M, K, n);
    document.getElementById('ov-vib-wmax').textContent = vibTable.wMax.toFixed(1);
    document.getElementById('ov-vib-wmax-delay').textContent = vibTable.wMaxDelayIndex || '—';

    const centroid = getHolesCentroidLonLat(state);

    const tbody = document.getElementById('ov-vib-structures-tbody');
    if (state.securityStructures.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="empty-row">등록된 보안물건이 없습니다</td></tr>`;
    } else {
        tbody.innerHTML = state.securityStructures.map(s => {
            let distance = null, ppv = null;
            if (centroid && vibTable.wMax > 0) {
                distance = getDistanceMeters([centroid.lon, centroid.lat], [s.lng, s.lat]);
                ppv = calculatePPV(distance, vibTable.wMax, K, n);
            }
            const safe = ppv !== null ? ppv <= s.allowedPPV : true;
            const factor = (ppv !== null && ppv > 0) ? (s.allowedPPV / ppv).toFixed(2) + 'x' : '—';
            return `
                <tr>
                    <td>${s.name}</td>
                    <td>${CATEGORY_LABELS[s.category] || s.category}</td>
                    <td>${s.lat.toFixed(6)}</td>
                    <td>${s.lng.toFixed(6)}</td>
                    <td>${s.allowedPPV.toFixed(2)}</td>
                    <td>${distance !== null ? distance.toFixed(1) : '—'}</td>
                    <td>${ppv !== null ? ppv.toFixed(3) : '—'}</td>
                    <td>${factor}</td>
                    <td><span class="badge ${safe ? 'badge-safe' : 'badge-danger'}">${safe ? '안전' : '주의/초과'}</span></td>
                    <td><button type="button" class="btn btn-danger-outline" style="padding:4px 10px;font-size:11px;" data-remove-structure="${s.id}">삭제</button></td>
                </tr>
            `;
        }).join('');
    }

    document.getElementById('ov-vib-distance-cards').innerHTML = vibTable.rows.map(row => `
        <div class="metric-box">
            <span class="metric-label">${row.D}m</span>
            <span class="metric-value" style="color: ${row.safe ? 'var(--accent-green)' : 'var(--accent-red)'};">${row.V.toFixed(3)}</span>
            <span class="metric-unit">kine</span>
        </div>
    `).join('');
}

export function initVibrationAnalysisEvents() {
    document.getElementById('ov-vib-input-k').addEventListener('input', (e) => {
        const k = parseFloat(e.target.value);
        if (!(k > 0)) return;
        state.vibrationConstants.K = k;
        updateDashboard();
    });
    document.getElementById('ov-vib-input-n').addEventListener('input', (e) => {
        const nVal = parseFloat(e.target.value);
        if (!(nVal > 0)) return;
        state.vibrationConstants.n = nVal;
        updateDashboard();
    });

    document.getElementById('ov-vib-btn-add-structure').addEventListener('click', () => {
        const name = document.getElementById('ov-vib-new-name').value.trim();
        const category = document.getElementById('ov-vib-new-category').value;
        const lat = parseFloat(document.getElementById('ov-vib-new-lat').value);
        const lng = parseFloat(document.getElementById('ov-vib-new-lng').value);
        const allowedPPV = parseFloat(document.getElementById('ov-vib-new-allowed').value);

        if (!name || isNaN(lat) || isNaN(lng) || isNaN(allowedPPV) || allowedPPV <= 0) {
            showToast('보안물건명, 위경도, 허용PPV를 모두 올바르게 입력하세요.', 'alert-triangle');
            return;
        }

        state.securityStructures.push({ id: state.nextSecurityStructureId++, name, category, lat, lng, allowedPPV });
        document.getElementById('ov-vib-new-name').value = '';
        document.getElementById('ov-vib-new-lat').value = '';
        document.getElementById('ov-vib-new-lng').value = '';
        document.getElementById('ov-vib-new-allowed').value = '';
        renderVibrationAnalysisView();
    });

    document.getElementById('ov-vib-structures-tbody').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-remove-structure]');
        if (!btn) return;
        const id = parseInt(btn.dataset.removeStructure, 10);
        state.securityStructures = state.securityStructures.filter(s => s.id !== id);
        renderVibrationAnalysisView();
    });
}
