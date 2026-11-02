// AeroBlast Pro - 뇌관 시차(MS) 순서에 따른 2D 캔버스 순차 기폭(폭발 애니메이션) 재생 엔진
//
// "현재 스텝 인덱스" 기반: setSimStep(i)이 상태를 그 스텝으로 즉시 세팅하므로, 재생(setInterval로
// 스텝을 전진)과 타임라인 슬라이더 스크러빙(같은 함수를 직접 호출)이 로직을 공유한다.
// delayIndex 그룹핑 자체(calculateWMax/groupHolesByDelay)는 core/vibrationTable.js를 그대로 재사용 —
// "진동(PPV) 해석" 분석도구와 공용 데이터 구조이므로 여기서 새로 만들지 않는다.

import { state } from '../../../core/state.js';
import { calculateWMax } from '../../../core/vibrationTable.js';
import { draw2D } from '../../../render/canvas2d.js';
import { showToast, syncSimTimelineUI } from '../../../ui/events.js';

let playTimer = null;
let audioCtx = null;

/** 지발 그룹이 터질 때 나는 "펑~" 소리 — 오디오 파일 없이 Web Audio API로 즉석 합성(짧은 사인파 하강 + 빠른 감쇠). */
function playPopSound() {
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        const t0 = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(500, t0);
        osc.frequency.exponentialRampToValueAtTime(70, t0 + 0.13);
        gain.gain.setValueAtTime(0.35, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.15);
    } catch { /* AudioContext 미지원 환경은 무음 처리 */ }
}

/** 지발(delayIndex) 그룹을 MS 순서대로 반환: [{ delayIndex, totalWeight, holeIds }, ...]. MS 그룹 요약 표·타임라인 슬라이더가 공용으로 쓴다. */
export function getDelayGroups() {
    return calculateWMax(state.holes).groups;
}

export function isSimPlaying() {
    return playTimer !== null;
}

/** 스텝 인덱스(0-based)로 즉시 이동 — 재생 없이 슬라이더 스크러빙에도 그대로 쓴다. */
export function setSimStep(stepIndex) {
    const groups = getDelayGroups();
    if (groups.length === 0) return;
    const clamped = Math.max(0, Math.min(stepIndex, groups.length - 1));
    state.simStepIndex = clamped;
    state.flashingHoleIds = groups[clamped].holeIds;
    state.flashStartTime = performance.now();
    playPopSound();
    draw2D();
    syncSimTimelineUI();
}

export function pauseDelaySimulation() {
    if (playTimer) {
        clearInterval(playTimer);
        playTimer = null;
    }
}

/** stepMs 간격으로 지발 그룹을 순서대로 재생한다. 마지막 스텝에서 멈춰 있었으면 처음부터 다시 재생. */
export function playDelaySimulation(stepMs = 200) {
    if (playTimer) return;
    const groups = getDelayGroups();
    if (groups.length === 0) {
        showToast('시뮬레이션할 발파공이 없습니다', 'alert-triangle');
        return;
    }

    let i = state.simStepIndex >= groups.length - 1 ? -1 : state.simStepIndex;
    const advance = () => {
        i++;
        if (i >= groups.length) {
            pauseDelaySimulation();
            syncSimTimelineUI();
            showToast('발파 시뮬레이션 재생 완료', 'check-circle');
            return;
        }
        setSimStep(i);
    };
    advance();
    playTimer = setInterval(advance, stepMs);
}
