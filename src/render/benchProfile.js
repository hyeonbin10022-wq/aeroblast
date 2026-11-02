// AeroBlast Pro - Langefors 벤치 단면도 & 추천 제원표 렌더링
//
// blastCalculator.js의 계산 결과(calculateBlastDesign/generateSpecTable)를 받아
// 2D 벤치 단면도 캔버스와 추천 제원표(K=8~20m)를 그린다.
// 배색은 canvas2d.js(메인 패턴 캔버스)의 다크 + 네온 악센트 팔레트를 그대로 따른다.

import { generateSpecTable } from '../utils/blastCalculator.js';

export const COL = {
    // 색상 3원칙: (1) 장약 종류만 색으로 구분(ANFO=노랑/에멀젼=시안), (2) 기폭약만 레드 포인트,
    // (3) 나머지(벤치 외곽선/치수선/설계 외곽선)는 전부 무채색.
    bg: '#12161d',
    outline: '#475569',      // 벤치 외곽선(지표/자유면/바닥)
    dim: '#94a3b8',          // 저항선(B)/벤치높이(K)/천공장(H) 치수선 + Langefors 설계 외곽선 공용
    stem: '#cbc7c7',         // 전색(스테밍)
    anfo: '#fdf47c',         // ANFO(단일) 모드 장약 — 노랑
    column: '#72fcf3',       // 에멀젼(이중) 모드 장약(상부·하부 공용) — 시안
    bottom: '#fd685d',       // 기폭약 전용 — ANFO 모드에만 사용(에멀젼은 자체 기폭이라 미사용)
    textPrimary: '#F8FAFC'
};

function round2(n) {
    return Math.round(n * 100) / 100;
}

// 끝 틱이 달린 치수선. 세로 치수선은 중앙에 "기호/값" 2줄 라벨을 선을 끊고 얹는다.
function drawDim(ctx, x1, y1, x2, y2, symbol, value) {
    const vertical = x1 === x2;
    ctx.strokeStyle = COL.dim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    [[x1, y1], [x2, y2]].forEach(([x, y]) => {
        if (vertical) { ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); }
        else { ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); }
    });
    ctx.stroke();

    ctx.font = '600 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (vertical) {
        const my = (y1 + y2) / 2;
        const tw = ctx.measureText(value).width + 6;
        ctx.fillStyle = COL.bg;
        ctx.fillRect(x1 - tw / 2, my - 13, tw, 26);
        ctx.fillStyle = COL.dim;
        ctx.fillText(symbol, x1, my - 6);
        ctx.fillText(value, x1, my + 6);
    } else {
        ctx.fillStyle = COL.dim;
        ctx.fillText(`${symbol} ${value}`, (x1 + x2) / 2, y1 - 9);
    }
}

// 벤치 단면도 — 벤치 외곽선(지표/자유면/바닥) + 천공 막대(전색/장약/기폭약) + Langefors 설계 외곽선(점선)
// + B/K/H 치수선 + 구간 라벨. designH가 주어지면 그 길이로 설계 외곽선을 그려, 선택 공 보기에서
// 실제 공 길이와 설계 천공장의 편차가 드러나게 한다. 클릭 편집용 구간 히트박스를 canvas.segmentHits에 남긴다.
export function drawBenchProfile(result, input, canvasId = 'bench-profile-canvas', designH) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const W = canvas.width;
    const Hc = canvas.height;

    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, W, Hc);

    const isSingle = result.chargeMode === 'single';
    const K = input.K;
    const B = result.B > 0 ? result.B : 0;
    const hasEnvelope = designH > 0;

    const faceX = 56;        // 자유면 x (왼쪽은 K 치수선 여백)
    const topY = 50;         // 지표면 y (위는 B 치수선 여백)
    const bottomArea = 34;   // 범례 여백
    const barW = 26;
    const maxDepth = Math.max(result.H, K, hasEnvelope ? designH : 0);
    // 가로/세로 동일 축척 — 오른쪽 라벨(~95px) + H 치수선을 라벨 바로 옆으로 붙이므로 여백을 줄여
    // 막대가 더 오른쪽(중앙에 가깝게)으로 밀리도록 함
    const scaleV = (Hc - topY - bottomArea - 6) / maxDepth;
    const scaleH = B > 0 ? (W - faceX - barW / 2 - 100) / B : Infinity;
    const scale = Math.max(1, Math.min(scaleV, scaleH));
    const cx = faceX + (B > 0 ? B * scale : 30);
    const floorY = topY + K * scale;
    const barBottomY = topY + result.H * scale;

    // 1. 벤치 외곽선 — 지표(자유면→오른쪽), 수직 자유면, 바닥(자유면→왼쪽, 깊이 K)
    ctx.strokeStyle = COL.outline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W, topY);
    ctx.lineTo(faceX, topY);
    ctx.lineTo(faceX, floorY);
    ctx.lineTo(0, floorY);
    ctx.stroke();

    // 2. 천공 막대 — 구간별 평면 사각형(저알파 틴트 + 1px 동색 외곽선)
    const segments = [];
    let y = topY;
    const addSegment = (key, h, color) => {
        if (!(h > 0)) return null;
        const seg = { key, y0: y, y1: y + h * scale, color };
        ctx.beginPath();
        ctx.roundRect(cx - barW / 2, seg.y0, barW, seg.y1 - seg.y0, 3);
        ctx.fillStyle = color;
        ctx.fill();
        segments.push(seg);
        y = seg.y1;
        return seg;
    };

    const labels = [];
    const stem = addSegment('stemming', result.h_o, COL.stem);
    if (stem) labels.push({ seg: stem, text: `전색 ${round2(result.h_o)}m` });

    if (isSingle) {
        const anfo = addSegment('charge', result.h_c + result.h_b, COL.anfo);
        if (anfo) labels.push({ seg: anfo, text: `ANFO ${round2(result.Q_c + result.Q_b)}kg` });
        const primer = addSegment('primer', result.primerLength ?? 0, COL.bottom);
        if (primer) {
            ctx.beginPath();
            ctx.arc(cx, (primer.y0 + primer.y1) / 2, 3, 0, Math.PI * 2);
            ctx.fillStyle = COL.textPrimary;
            ctx.fill();
            labels.push({ seg: primer, text: `기폭약 ${round2(result.primerWeight)}kg` });
        }
    } else {
        // 에멀젼은 상부/하부 같은 색 — 경계선 + 자체기폭 링 마커로 구분(기폭약 구간 없음)
        const upper = addSegment('charge', result.h_c, COL.column);
        const lower = addSegment('lower', result.h_b, COL.column);
        if (upper) labels.push({ seg: upper, text: `상부장약 ${round2(result.Q_c)}kg` });
        if (lower) {
            if (upper) {
                ctx.beginPath();
                ctx.moveTo(cx - barW / 2, lower.y0);
                ctx.lineTo(cx + barW / 2, lower.y0);
                ctx.strokeStyle = 'rgba(255,255,255,0.35)';
                ctx.stroke();
            }
            const my = (lower.y0 + lower.y1) / 2;
            ctx.beginPath();
            ctx.arc(cx, my, 4, 0, Math.PI * 2);
            ctx.strokeStyle = COL.textPrimary;
            ctx.lineWidth = 1.2;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(cx, my, 1.5, 0, Math.PI * 2);
            ctx.fillStyle = COL.textPrimary;
            ctx.fill();
            labels.push({ seg: lower, text: `하부장약 ${round2(result.Q_b)}kg` });
        }
    }

    // 3. Langefors 설계 외곽선 — 막대를 감싸는 점선 라운드 박스(높이 = 설계 H)
    if (hasEnvelope) {
        ctx.beginPath();
        ctx.roundRect(cx - barW / 2 - 5, topY - 5, barW + 10, designH * scale + 10, 5);
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = COL.dim;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // 4. 치수선 — B(지표 위, 자유면→공 중심), K(자유면 왼쪽, 지표→바닥), H(라벨 바로 옆, 지표→공 바닥)
    const lx = cx + barW / 2 + 22;
    ctx.font = '600 11px "Noto Sans KR"';
    const maxLabelW = labels.reduce((m, l) => Math.max(m, ctx.measureText(l.text).width), 0);
    const hX = lx + maxLabelW + 14; // 라벨 폭만큼만 띄워 H를 라벨에 바짝 붙임(기존: 캔버스 우측 끝 고정)
    if (B > 0) drawDim(ctx, faceX, topY - 18, cx, topY - 18, 'B', `${round2(B)}m`);
    drawDim(ctx, faceX - 26, topY, faceX - 26, floorY, 'K', `${round2(K)}m`);
    drawDim(ctx, hX, topY, hX, barBottomY, 'H', `${round2(result.H)}m`);

    // 5. 구간 라벨 — 막대 오른쪽, 점선 리더. 얇은 구간(기폭약)끼리 겹치지 않게 아래로 밀어냄
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let prevY = -Infinity;
    const hits = segments.map(s => ({ key: s.key, x0: cx - barW / 2 - 6, x1: cx + barW / 2 + 6, y0: s.y0, y1: s.y1 }));
    labels.forEach(({ seg, text }) => {
        const segY = (seg.y0 + seg.y1) / 2;
        const ly = Math.max(segY, prevY + 16);
        prevY = ly;
        ctx.beginPath();
        ctx.moveTo(cx + barW / 2 + 2, segY);
        ctx.lineTo(lx - 4, ly);
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = COL.dim;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = seg.color;
        ctx.fillText(text, lx, ly);
        hits.push({ key: seg.key, x0: lx - 4, x1: lx + ctx.measureText(text).width + 4, y0: ly - 8, y1: ly + 8 });
    });
    canvas.segmentHits = hits;

    // 6. 범례
    if (hasEnvelope) {
        const ly = Hc - 14;
        ctx.beginPath();
        ctx.roundRect(12, ly - 5, 16, 10, 3);
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = COL.dim;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '10px "Noto Sans KR"';
        ctx.fillStyle = COL.dim;
        ctx.fillText('점선 = Langefors 설계값', 34, ly);
    }
}

export function generateAndRenderSpecTable(baseInput) {
    if (typeof generateSpecTable !== 'function') return;

    const tableData = generateSpecTable(baseInput);
    const tbody = document.getElementById('spec-table-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    tableData.forEach(row => {
        const tr = document.createElement('tr');

        let qClass = '';
        if (row.q < 0.3 || row.q > 0.8) qClass = 'style="color: var(--text-error); font-weight: bold;"';

        tr.innerHTML = `
            <td><strong>${row.K.toFixed(1)}</strong></td>
            <td>${row.H.toFixed(2)}</td>
            <td>${row.B.toFixed(2)}</td>
            <td>${row.S.toFixed(2)}</td>
            <td>${row.Q_tot.toFixed(2)}</td>
            <td ${qClass}>${row.q.toFixed(2)}</td>
            <td>${row.b ? row.b.toFixed(3) : "—"}</td>
        `;
        tbody.appendChild(tr);
    });
}
