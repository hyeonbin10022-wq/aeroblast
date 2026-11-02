// AeroBlast Pro - "Kuz-Ram 파쇄도" 전체화면 오버레이 렌더링 + 이벤트 바인딩
//
// blastEngine.js(실제 설계 요약치: 비장약량 q, 평균 저항선/공간격/장약장)와 EXPLOSIVE_PRESETS(RWS)를
// kuzramEngine.js(Lilly BI → Kuznetsov x_m → Cunningham n → Rosin-Rammler 입도분포)에 그대로 대입한다.
// state.kuzramInputs가 단일 소스이며, 여기서 값을 바꾸면 updateDashboard() 경유로 즉시 재계산된다.

import { state } from '../core/state.js';
import { getDesignSummary } from '../core/blastEngine.js';
import { EXPLOSIVE_PRESETS } from '../utils/blastCalculator.js';
import {
    JPS_TABLE, JPA_TABLE,
    calculateBlastabilityIndex, calculateKuznetsovXm, calculateUniformityIndex, calculateFragmentationStats, rosinRammlerPassing,
} from '../core/kuzramEngine.js';

const CURVE_SAMPLE_SIZES_CM = [1, 2.5, 5, 10, 20, 30, 50, 75, 100];

export function renderKuzramAnalysisView() {
    const inputs = state.kuzramInputs;

    document.getElementById('ov-kz-select-explosive').value = inputs.explosiveType;
    document.getElementById('ov-kz-select-rmd').value = inputs.rmdCategory;
    document.getElementById('ov-kz-input-ucs').value = inputs.ucs;
    document.getElementById('ov-kz-input-e').value = inputs.youngsModulus;
    document.getElementById('ov-kz-input-w').value = inputs.drillDeviation;
    document.getElementById('ov-kz-rock-density-readout').textContent = state.params.rockDensity.toFixed(2);

    const jointRow = document.getElementById('ov-kz-joint-row');
    jointRow.style.display = inputs.rmdCategory === 'blocky' ? 'flex' : 'none';
    document.getElementById('ov-kz-select-jps').innerHTML = JPS_TABLE.map(r => `<option value="${r.value}" ${r.value === inputs.jps ? 'selected' : ''}>${r.label}</option>`).join('');
    document.getElementById('ov-kz-select-jpa').innerHTML = JPA_TABLE.map(r => `<option value="${r.value}" ${r.value === inputs.jpa ? 'selected' : ''}>${r.label}</option>`).join('');

    const bi = calculateBlastabilityIndex({
        rmdCategory: inputs.rmdCategory,
        jps: inputs.jps,
        jpa: inputs.jpa,
        rockDensityTPerM3: state.params.rockDensity,
        ucs: inputs.ucs,
        youngsModulus: inputs.youngsModulus,
    });
    document.getElementById('ov-kz-result-rmd').textContent = bi.rmd;
    document.getElementById('ov-kz-result-rdi').textContent = bi.rdi;
    document.getElementById('ov-kz-result-hf').textContent = bi.hf;
    document.getElementById('ov-kz-result-a').textContent = bi.A;

    const summary = getDesignSummary(state.holes, state.params.benchHeight);
    const preset = EXPLOSIVE_PRESETS[inputs.explosiveType];
    document.getElementById('ov-kz-readout-q').textContent = summary.q.toFixed(3);
    document.getElementById('ov-kz-readout-charge').textContent = summary.avgChargePerHole.toFixed(1);
    document.getElementById('ov-kz-readout-rws').textContent = preset.rws;

    const xm = calculateKuznetsovXm(bi.A, summary.q, summary.avgChargePerHole, preset.rws);
    const n = calculateUniformityIndex({
        B: summary.avgBurden || state.params.targetBurden,
        S: summary.avgSpacing || state.params.targetSpacing,
        D: state.params.holeDiameter,
        W: inputs.drillDeviation,
        chargeLength: summary.avgChargeLength,
        H: state.params.benchHeight,
    });
    const stats = calculateFragmentationStats(xm, n);

    document.getElementById('ov-kz-result-xm').textContent = stats.d50;
    document.getElementById('ov-kz-result-d80').textContent = stats.d80;
    document.getElementById('ov-kz-result-n').textContent = n;
    document.getElementById('ov-kz-result-oversize').textContent = stats.oversizePct;
    document.getElementById('ov-kz-result-undersize').textContent = stats.undersizePct;

    document.getElementById('ov-kz-curve-tbody').innerHTML = CURVE_SAMPLE_SIZES_CM.map(x => {
        const passing = rosinRammlerPassing(x, xm, n) * 100;
        return `<tr><td>${x}</td><td>${passing.toFixed(1)}%</td></tr>`;
    }).join('');

    document.getElementById('ov-kz-curve-svg').innerHTML = buildCurveSvg(xm, n, stats.d80);
}

/** Rosin-Rammler 통과율(%) 곡선을 로그 x축 SVG로 그린다. 차트 라이브러리 없이 순수 SVG 문자열 조립. */
function buildCurveSvg(xm, n, d80) {
    const W = 560, H = 260;
    const left = 45, right = 15, top = 15, bottom = 35;
    const plotW = W - left - right, plotH = H - top - bottom;

    if (!(xm > 0) || !(n > 0)) {
        return `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="var(--text-secondary)" font-size="13">데이터 없음</text>`;
    }

    const xMin = 0.5;
    const xMax = Math.max(100, d80 * 1.5);
    const logMin = Math.log(xMin), logMax = Math.log(xMax);
    const toSvgX = x => left + (Math.log(x) - logMin) / (logMax - logMin) * plotW;
    const toSvgY = pct => top + (1 - pct / 100) * plotH;

    const STEPS = 40;
    const points = Array.from({ length: STEPS + 1 }, (_, i) => {
        const x = Math.exp(logMin + (logMax - logMin) * i / STEPS);
        const passing = rosinRammlerPassing(x, xm, n) * 100;
        return `${toSvgX(x).toFixed(1)},${toSvgY(passing).toFixed(1)}`;
    }).join(' ');

    const hGrid = [0, 25, 50, 75, 100].map(p => {
        const y = toSvgY(p);
        return `<line x1="${left}" y1="${y}" x2="${W - right}" y2="${y}" stroke="var(--border-color)" />
                <text x="${left - 8}" y="${y + 4}" text-anchor="end" fill="var(--text-secondary)" font-size="10">${p}%</text>`;
    }).join('');

    const vGrid = [1, 2.5, 10, 50, 100, 200].filter(x => x >= xMin && x <= xMax).map(x => {
        const sx = toSvgX(x);
        return `<line x1="${sx}" y1="${top}" x2="${sx}" y2="${H - bottom}" stroke="var(--border-color)" opacity="0.5" />
                <text x="${sx}" y="${H - bottom + 16}" text-anchor="middle" fill="var(--text-secondary)" font-size="10">${x}</text>`;
    }).join('');

    const d50X = toSvgX(xm), d50Y = toSvgY(50);
    const d80X = toSvgX(d80), d80Y = toSvgY(80);

    return `
        ${hGrid}
        ${vGrid}
        <polyline points="${points}" fill="none" stroke="var(--accent-orange)" stroke-width="2" />
        <line x1="${d50X}" y1="${d50Y}" x2="${d50X}" y2="${H - bottom}" stroke="var(--accent-tertiary)" stroke-dasharray="3,3" />
        <circle cx="${d50X}" cy="${d50Y}" r="3" fill="var(--accent-tertiary)" />
        <text x="${d50X}" y="${top - 4}" text-anchor="middle" fill="var(--accent-tertiary)" font-size="10">D50</text>
        <line x1="${d80X}" y1="${d80Y}" x2="${d80X}" y2="${H - bottom}" stroke="var(--accent-amber)" stroke-dasharray="3,3" />
        <circle cx="${d80X}" cy="${d80Y}" r="3" fill="var(--accent-amber)" />
        <text x="${d80X}" y="${top - 4}" text-anchor="middle" fill="var(--accent-amber)" font-size="10">D80</text>
        <text x="${W / 2}" y="${H - 6}" text-anchor="middle" fill="var(--text-secondary)" font-size="10">입경 x (cm, log scale)</text>
    `;
}

export function initKuzramAnalysisEvents() {
    document.getElementById('ov-kz-select-explosive').addEventListener('change', (e) => {
        state.kuzramInputs.explosiveType = e.target.value;
        renderKuzramAnalysisView();
    });
    document.getElementById('ov-kz-select-rmd').addEventListener('change', (e) => {
        state.kuzramInputs.rmdCategory = e.target.value;
        renderKuzramAnalysisView();
    });
    document.getElementById('ov-kz-select-jps').addEventListener('change', (e) => {
        state.kuzramInputs.jps = parseFloat(e.target.value);
        renderKuzramAnalysisView();
    });
    document.getElementById('ov-kz-select-jpa').addEventListener('change', (e) => {
        state.kuzramInputs.jpa = parseFloat(e.target.value);
        renderKuzramAnalysisView();
    });
    document.getElementById('ov-kz-input-ucs').addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        if (!(v > 0)) return;
        state.kuzramInputs.ucs = v;
        renderKuzramAnalysisView();
    });
    document.getElementById('ov-kz-input-e').addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        if (!(v > 0)) return;
        state.kuzramInputs.youngsModulus = v;
        renderKuzramAnalysisView();
    });
    document.getElementById('ov-kz-input-w').addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        if (!(v >= 0)) return;
        state.kuzramInputs.drillDeviation = v;
        renderKuzramAnalysisView();
    });
}
