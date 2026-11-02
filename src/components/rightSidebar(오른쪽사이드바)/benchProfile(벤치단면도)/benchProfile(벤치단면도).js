// 벤치 단면도 탭 — [설계 기준 | 선택 공] 보기 전환 + 구간 클릭 → 좌측 "발파공 편집" 입력창 포커스.
// 선택 0개 = Langefors 설계 단면, 1개 = 그 공으로 자동 전환(buildHoleBenchProfileData),
// 2개 이상 = "N개 선택됨" 표시 + 설계 단면 유지. 선택 공 보기에서도 설계 천공장(H)을 점선 외곽선으로 겹쳐
// 편차가 드러나게 한다. 공 좌표(x,y)를 쓰지 않으므로 GPS/캔버스 모드 구분 없이 동일하게 동작한다.

import { state } from '../../../core/state.js';
import { buildHoleBenchProfileData } from '../../../core/blastEngine.js';
import { drawBenchProfile, COL } from '../../../render/benchProfile.js';

// 구간 키 → 좌측 발파공 편집 입력창 (에멀젼 하부장약은 "에멀젼 밀도 (하부)" 입력으로 연결)
const SEGMENT_INPUTS = {
    stemming: 'input-hole-stemming',
    charge: 'input-hole-anfo-weight',
    lower: 'input-hole-anfo-density',
    primer: 'input-hole-primer-weight'
};

let forceDesign = false;   // 1개 선택 중 사용자가 [설계 기준]을 직접 누른 경우
let lastSelectionKey = '';
let showingHole = false;

export function renderBenchProfileView() {
    const btnDesign = document.getElementById('bench-view-design');
    const btnHole = document.getElementById('bench-view-hole');
    if (!btnDesign || !btnHole) return;

    const ids = state.selectedHoleIds;
    const key = ids.join(',');
    if (key !== lastSelectionKey) {
        lastSelectionKey = key;
        forceDesign = false; // 선택이 바뀌면 자동 전환 규칙으로 복귀
    }
    const hole = ids.length === 1 ? state.holes.find(h => h.id === ids[0]) : null;
    showingHole = !!hole && !forceDesign;

    btnHole.textContent = ids.length > 1 ? `${ids.length}개 선택됨` : hole ? `선택 공 ${hole.id}` : '선택 공';
    btnHole.disabled = !hole;
    btnHole.style.opacity = hole ? '' : '0.5';
    btnDesign.classList.toggle('active', !showingHole);
    btnHole.classList.toggle('active', showingHole);

    const design = window.lastLangeforsResult;
    if (showingHole) {
        const { result, input } = buildHoleBenchProfileData(hole);
        drawBenchProfile(result, input, 'bench-profile-canvas', design?.H);
    } else if (design) {
        drawBenchProfile(design, window.lastLangeforsInput, 'bench-profile-canvas', design.H);
    } else {
        drawEmpty();
    }
}

// 아직 Langefors 계산을 한 번도 안 돌린 상태 — 이전 그림(선택 공 등)이 남지 않도록 비우고 안내만 표시
function drawEmpty() {
    const canvas = document.getElementById('bench-profile-canvas');
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '11px "Noto Sans KR"';
    ctx.fillStyle = COL.dim;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Langefors 자동 설계 값을 입력하세요', canvas.width / 2, canvas.height / 2);
    canvas.segmentHits = [];
}

function hitSegment(canvas, e) {
    if (!showingHole) return null;
    return (canvas.segmentHits || []).find(h => e.offsetX >= h.x0 && e.offsetX <= h.x1 && e.offsetY >= h.y0 && e.offsetY <= h.y1) || null;
}

export function initBenchProfileView() {
    document.getElementById('bench-view-design').addEventListener('click', () => {
        forceDesign = true;
        renderBenchProfileView();
    });
    document.getElementById('bench-view-hole').addEventListener('click', () => {
        forceDesign = false;
        renderBenchProfileView();
    });

    const canvas = document.getElementById('bench-profile-canvas');
    canvas.addEventListener('mousemove', (e) => {
        canvas.style.cursor = hitSegment(canvas, e) ? 'pointer' : '';
    });
    canvas.addEventListener('click', (e) => {
        const hit = hitSegment(canvas, e);
        const input = hit && document.getElementById(SEGMENT_INPUTS[hit.key]);
        if (!input) return;
        input.closest('.accordion-section')?.classList.add('open');
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.focus({ preventScroll: true });
        input.select();
        input.closest('.param-row').animate(
            [{ boxShadow: '0 0 0 2px #3B82F6' }, { boxShadow: '0 0 0 2px transparent' }], // --accent-primary
            { duration: 1400, easing: 'ease-out' }
        );
    });
}
