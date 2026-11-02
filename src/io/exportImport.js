// AeroBlast Pro - Project File I/O (JSON/CSV export, JSON import, print report)
//
// 발파 프로젝트 데이터를 파일로 내보내거나(JSON/CSV), 불러오거나(JSON), 인쇄용 보고서를
// 생성하는 모듈. app.js가 소유한 공유 상태(state, dom, history)와 헬퍼 함수를 주입받아 동작한다.

import { applyCanvasMode } from '../components/leftSidebar(왼쪽사이드바)/designMode(설계모드)/designMode(설계모드).js';

/**
 * @param {Object} ctx
 * @param {Object} ctx.state - app.js의 공유 상태 객체
 * @param {Object} ctx.dom - app.js의 DOM 참조 캐시
 * @param {Object} ctx.history - undo/redo 히스토리 스택
 * @param {Function} ctx.calculateHoleCharge
 * @param {Function} ctx.showToast
 * @param {Function} ctx.recalculateBurdenSpacing
 * @param {Function} ctx.updateDashboard
 * @param {Function} ctx.draw2D
 * @returns {{exportProjectJSON: Function, exportProjectCSV: Function, importProjectJSON: Function, printReport: Function}}
 */
export function createExportImport({ state, dom, history, calculateHoleCharge, showToast, recalculateBurdenSpacing, updateDashboard, draw2D, initMap }) {

    // Export design data structure as JSON file
    function exportProjectJSON() {
        const exportData = {
            params: state.params,
            scaleFactor: state.scaleFactor,
            isScaleCalibrated: state.isScaleCalibrated,
            canvasMode: state.canvasMode,
            freeFace: state.freeFace,
            holes: state.holes,
            rows: state.rows,
            nextRowIndex: state.nextRowIndex,
            customMeasurements: state.customMeasurements, // Export custom measurements
            autoPatterns: state.autoPatterns, // Export auto patterns
            abPatterns: state.abPatterns, // Export A-B line patterns
            freeFacePatterns: state.freeFacePatterns, // Export free-face patterns
            securityStructures: state.securityStructures, // Export 보안물건 (진동 영향성 검토용)
            nextSecurityStructureId: state.nextSecurityStructureId,
            testBlastSessions: state.testBlastSessions, // Export 시험발파 실측 이력 (계측 회귀분석)
            nextTestBlastSessionId: state.nextTestBlastSessionId,
            activeTestBlastSessionId: state.activeTestBlastSessionId,
            vibrationConstants: state.vibrationConstants // 현재 적용 중인 K,n
        };

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData));
        const dlAnchorElem = document.createElement('a');
        dlAnchorElem.setAttribute("href",     dataStr     );
        dlAnchorElem.setAttribute("download", `aeroblast_project_${Date.now()}.json`);
        dlAnchorElem.click();
    }

    // Export all pin coordinates as CSV file (using actual GPS longitude/latitude)
    function exportProjectCSV() {
        if (state.holes.length === 0) {
            showToast("내보낼 발파공이 없습니다.", "warning");
            return;
        }

        let csvContent = "﻿"; // BOM for Korean Excel compatibility
        csvContent += "Hole ID,Row,Longitude (경도),Latitude (위도),Burden (저항선 m),Spacing (공간격 m),Depth (천공깊이 m),Explosive (폭약량 kg)\n";

        state.holes.forEach(h => {
            let lat, lon;
            if (state.map && !state.canvasMode) {
                const lonLat = ol.proj.toLonLat([h.x, h.y], state.map.getView().getProjection());
                lon = lonLat[0];
                lat = lonLat[1];
            } else {
                // Calculate coordinate offsets based on user-entered GPS anchor
                const latAnchor = state.terrainOffset.y; // Entered Latitude (e.g. 36.5)
                const lonAnchor = state.terrainOffset.x; // Entered Longitude (e.g. 127.5)

                // 1 degree of Latitude is ~111,111 meters
                // 1 degree of Longitude is ~111,111 * cos(latitude) meters
                const latOffsetDeg = (h.y * state.scaleFactor) / 111111;
                const lonOffsetDeg = (h.x * state.scaleFactor) / (111111 * Math.cos(latAnchor * Math.PI / 180));

                lat = latAnchor + latOffsetDeg;
                lon = lonAnchor + lonOffsetDeg;
            }

            const depth = h.depth_H;
            const explosiveWeight = calculateHoleCharge(h).totalWeight;

            csvContent += `"${h.id}","${h.rowName}",${lon.toFixed(8)},${lat.toFixed(8)},${h.burden.toFixed(2)},${h.spacing.toFixed(2)},${depth.toFixed(1)},${explosiveWeight.toFixed(1)}\n`;
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `aeroblast_holes_gps_${Date.now()}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showToast("발파공 GPS CSV 파일 내보내기 완료", "check-circle");
    }

    // Import design data structure from JSON file
    function importProjectJSON(e) {
        const files = e.target.files;
        if (files.length <= 0) return;

        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const data = JSON.parse(event.target.result);

                if (data.params) state.params = data.params;
                if (data.scaleFactor) state.scaleFactor = data.scaleFactor;
                if (data.isScaleCalibrated !== undefined) state.isScaleCalibrated = data.isScaleCalibrated;
                applyCanvasMode(!!data.canvasMode, { initMap }); // 불러온 프로젝트의 설계 모드(GPS/캔버스) 그대로 복원
                if (data.freeFace) state.freeFace = data.freeFace;
                if (data.holes) state.holes = data.holes;
                if (data.rows) state.rows = data.rows;
                if (data.nextRowIndex) state.nextRowIndex = data.nextRowIndex;
                if (data.customMeasurements) state.customMeasurements = data.customMeasurements;
                else state.customMeasurements = [];
                if (data.autoPatterns) state.autoPatterns = data.autoPatterns;
                else state.autoPatterns = [];
                if (data.abPatterns) state.abPatterns = data.abPatterns;
                else state.abPatterns = [];
                if (data.freeFacePatterns) state.freeFacePatterns = data.freeFacePatterns;
                else state.freeFacePatterns = [];
                if (data.securityStructures) state.securityStructures = data.securityStructures;
                else state.securityStructures = [];
                state.nextSecurityStructureId = data.nextSecurityStructureId || 1;
                if (data.testBlastSessions) state.testBlastSessions = data.testBlastSessions;
                else state.testBlastSessions = [];
                state.nextTestBlastSessionId = data.nextTestBlastSessionId || 1;
                state.activeTestBlastSessionId = data.activeTestBlastSessionId || null;
                state.vibrationConstants = data.vibrationConstants || { K: 200, n: 1.6 };

                // Sync values to UI inputs
                if (dom.inputTargetSpacing) dom.inputTargetSpacing.value = state.params.targetSpacing;
                if (dom.inputTargetBurden) dom.inputTargetBurden.value = state.params.targetBurden;
                if (dom.inputBenchHeight) dom.inputBenchHeight.value = state.params.benchHeight;
                if (dom.inputSubdrill) dom.inputSubdrill.value = state.params.subdrill;
                if (dom.inputHoleDiameter) dom.inputHoleDiameter.value = state.params.holeDiameter;
                if (dom.inputHoleAngle) dom.inputHoleAngle.value = state.params.holeAngle;
                if (dom.inputStemmingHeight) dom.inputStemmingHeight.value = state.params.stemmingHeight;
                if (dom.inputExplosiveDensity) dom.inputExplosiveDensity.value = state.params.explosiveDensity;
                if (dom.inputRockDensity) dom.inputRockDensity.value = state.params.rockDensity;
                if (dom.inputBsRatio) dom.inputBsRatio.value = state.params.bsRatio || 1.25;

                if (state.isScaleCalibrated) {
                    dom.scaleIndicator.textContent = `기준자 설정됨 (1px = ${state.scaleFactor.toFixed(4)}m)`;
                    dom.scaleIndicator.parentElement.style.borderLeftColor = 'var(--accent-green)';
                } else {
                    dom.scaleIndicator.textContent = `스케일 미설정 (기본: 1px = ${state.scaleFactor.toFixed(4)}m)`;
                    dom.scaleIndicator.parentElement.style.borderLeftColor = 'var(--accent-purple)';
                }

                recalculateBurdenSpacing();
                updateDashboard();
                draw2D();

                // Reset history stacks and save imported state
                history.undoStack = [];
                history.redoStack = [];
                history.save();

                alert("프로젝트 데이터를 성공적으로 불러왔습니다.");
            } catch (err) {
                alert("올바르지 않은 JSON 프로젝트 파일입니다: " + err.message);
            }
        };
        reader.readAsText(files[0]);
    }

    // 12. Printable Report Generator
    function printReport() {
        // 1. Set current date
        const dateSp = document.getElementById('print-date');
        const now = new Date();
        dateSp.textContent = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

        // 2. Render print table
        const printTbody = document.getElementById('print-sheet-tbody');
        printTbody.innerHTML = "";

        if (state.holes.length === 0) {
            printTbody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-row">지정된 발파공이 없습니다.</td>
                </tr>
            `;
        } else {
            const depth = state.params.benchHeight + state.params.subdrill;
            const radiusM = (state.params.holeDiameter / 2) / 1000;
            const holeArea = Math.PI * (radiusM ** 2);
            const explosiveHeight = Math.max(0, depth - state.params.stemmingHeight);
            const explosiveWeight = holeArea * explosiveHeight * state.params.explosiveDensity * 1000;

            const sortedHoles = [...state.holes].sort((a, b) => {
                if (a.rowName !== b.rowName) return a.rowName.localeCompare(b.rowName, undefined, {numeric: true});
                return a.id.localeCompare(b.id, undefined, {numeric: true});
            });

            sortedHoles.forEach(h => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${h.id}</strong></td>
                    <td>${h.rowName}</td>
                    <td>${depth.toFixed(1)}</td>
                    <td>${h.burden.toFixed(2)}</td>
                    <td>${h.spacing.toFixed(2)}</td>
                    <td>${explosiveWeight.toFixed(1)}</td>
                    <td>${state.params.stemmingHeight.toFixed(1)}</td>
                `;
                printTbody.appendChild(tr);
            });
        }

        // 3. Open print window
        window.print();
    }

    return { exportProjectJSON, exportProjectCSV, importProjectJSON, printReport };
}
