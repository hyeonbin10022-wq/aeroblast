// AeroBlast Pro - "계측 회귀분석" 전체화면 오버레이 렌더링 + 이벤트 바인딩
//
// 시험발파 회차별 실측치(R,W,V)를 관리하고 regressionEngine.js로 로그-로그 최소자승 회귀를 실행한다.
// "설계에 즉시 적용" 클릭 시 state.vibrationConstants(단일 소스)를 갱신 → updateDashboard()가
// 오른쪽 사이드바 요약 카드와 진동(PPV) 해석 오버레이를 함께 재계산하도록 만든다.

import { state } from '../core/state.js';
import { fitLogLogRegression } from '../core/regressionEngine.js';
import { showToast, updateDashboard } from '../ui/events.js';

function getActiveSession() {
    return state.testBlastSessions.find(s => s.id === state.activeTestBlastSessionId) || null;
}

export function renderRegressionAnalysisView() {
    if (!getActiveSession() && state.testBlastSessions.length > 0) {
        state.activeTestBlastSessionId = state.testBlastSessions[0].id;
    }
    const session = getActiveSession();

    const select = document.getElementById('ov-reg-session-select');
    select.innerHTML = state.testBlastSessions.length === 0
        ? `<option value="">회차 없음 — 새 시험발파 회차를 생성하세요</option>`
        : state.testBlastSessions.map(s => `<option value="${s.id}" ${s.id === state.activeTestBlastSessionId ? 'selected' : ''}>${s.label} (${s.dataPoints.length}개)</option>`).join('');

    const tbody = document.getElementById('ov-reg-datapoints-tbody');
    const applyBtn = document.getElementById('ov-reg-btn-apply');

    if (!session) {
        tbody.innerHTML = `<tr><td colspan="4" class="empty-row">시험발파 회차를 먼저 생성하세요</td></tr>`;
        document.getElementById('ov-reg-result-k').textContent = '—';
        document.getElementById('ov-reg-result-n').textContent = '—';
        document.getElementById('ov-reg-result-r2').textContent = '—';
        document.getElementById('ov-reg-result-k95').textContent = '—';
        document.getElementById('ov-reg-result-formula').textContent = '데이터를 2개 이상 입력하면 회귀식이 표시됩니다.';
        document.getElementById('ov-reg-fit-tbody').innerHTML = `<tr><td colspan="4" class="empty-row">데이터가 없습니다</td></tr>`;
        applyBtn.disabled = true;
        return;
    }

    tbody.innerHTML = session.dataPoints.length === 0
        ? `<tr><td colspan="4" class="empty-row">데이터가 없습니다</td></tr>`
        : session.dataPoints.map((p, i) => `
            <tr>
                <td>${p.R}</td>
                <td>${p.W}</td>
                <td>${p.V}</td>
                <td><button type="button" class="btn btn-danger-outline" style="padding:4px 10px;font-size:11px;" data-remove-point="${i}">삭제</button></td>
            </tr>
        `).join('');

    const fit = fitLogLogRegression(session.dataPoints);
    if (!fit.ok) {
        document.getElementById('ov-reg-result-k').textContent = '—';
        document.getElementById('ov-reg-result-n').textContent = '—';
        document.getElementById('ov-reg-result-r2').textContent = '—';
        document.getElementById('ov-reg-result-k95').textContent = '—';
        document.getElementById('ov-reg-result-formula').textContent = '데이터를 2개 이상(환산거리가 서로 달라야 함) 입력하면 회귀식이 표시됩니다.';
        document.getElementById('ov-reg-fit-tbody').innerHTML = `<tr><td colspan="4" class="empty-row">데이터가 부족합니다</td></tr>`;
        applyBtn.disabled = true;
        return;
    }

    document.getElementById('ov-reg-result-k').textContent = fit.K;
    document.getElementById('ov-reg-result-n').textContent = fit.nExp;
    document.getElementById('ov-reg-result-r2').textContent = fit.r2;
    document.getElementById('ov-reg-result-k95').textContent = fit.kUpper95;
    document.getElementById('ov-reg-result-formula').textContent = `V = ${fit.K} · (R/√W)^-${fit.nExp}  (n=${fit.count}, R²=${fit.r2})`;

    document.getElementById('ov-reg-fit-tbody').innerHTML = fit.predictions.map(p => {
        const errorPct = p.measuredV > 0 ? (Math.abs(p.predictedV - p.measuredV) / p.measuredV * 100).toFixed(1) : '—';
        return `
            <tr>
                <td>${p.SD}</td>
                <td>${p.measuredV}</td>
                <td>${p.predictedV}</td>
                <td>${errorPct}%</td>
            </tr>
        `;
    }).join('');

    applyBtn.disabled = false;
}

export function initRegressionAnalysisEvents() {
    document.getElementById('ov-reg-session-select').addEventListener('change', (e) => {
        state.activeTestBlastSessionId = parseInt(e.target.value, 10) || null;
        renderRegressionAnalysisView();
    });

    document.getElementById('ov-reg-btn-new-session').addEventListener('click', () => {
        const id = state.nextTestBlastSessionId++;
        state.testBlastSessions.push({ id, label: `회차 ${id}`, dataPoints: [] });
        state.activeTestBlastSessionId = id;
        renderRegressionAnalysisView();
    });

    document.getElementById('ov-reg-btn-delete-session').addEventListener('click', () => {
        const session = getActiveSession();
        if (!session) return;
        state.testBlastSessions = state.testBlastSessions.filter(s => s.id !== session.id);
        state.activeTestBlastSessionId = state.testBlastSessions.length > 0 ? state.testBlastSessions[0].id : null;
        renderRegressionAnalysisView();
    });

    document.getElementById('ov-reg-btn-add-point').addEventListener('click', () => {
        const session = getActiveSession();
        if (!session) {
            showToast('먼저 시험발파 회차를 생성하세요.', 'alert-triangle');
            return;
        }
        const R = parseFloat(document.getElementById('ov-reg-new-r').value);
        const W = parseFloat(document.getElementById('ov-reg-new-w').value);
        const V = parseFloat(document.getElementById('ov-reg-new-v').value);
        if (!(R > 0) || !(W > 0) || !(V > 0)) {
            showToast('거리, 장약량, 실측PPV를 모두 0보다 크게 입력하세요.', 'alert-triangle');
            return;
        }
        session.dataPoints.push({ R, W, V });
        document.getElementById('ov-reg-new-r').value = '';
        document.getElementById('ov-reg-new-w').value = '';
        document.getElementById('ov-reg-new-v').value = '';
        renderRegressionAnalysisView();
    });

    document.getElementById('ov-reg-datapoints-tbody').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-remove-point]');
        if (!btn) return;
        const session = getActiveSession();
        if (!session) return;
        session.dataPoints.splice(parseInt(btn.dataset.removePoint, 10), 1);
        renderRegressionAnalysisView();
    });

    document.getElementById('ov-reg-btn-apply').addEventListener('click', () => {
        const session = getActiveSession();
        if (!session) return;
        const fit = fitLogLogRegression(session.dataPoints);
        if (!fit.ok) return;
        state.vibrationConstants.K = fit.K;
        state.vibrationConstants.n = fit.nExp;
        updateDashboard();
        showToast(`설계에 적용됨: K=${fit.K}, n=${fit.nExp}`, 'check-circle');
    });
}
