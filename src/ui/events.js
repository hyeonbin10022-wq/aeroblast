// AeroBlast Pro - UI Event Wiring & Global State Orchestration (전역 UI 이벤트 바인딩)
//
// 툴바/모달/캔버스 마우스 인터랙션 등 모든 DOM 이벤트를 이 모듈에서 바인딩한다.
// 파일 I/O(exportImport)·클라우드 동기화(supabaseSync) 모듈도 여기서 state/dom 등
// 공유 컨텍스트를 주입해 최종 배선하고, 아코디언/드롭다운/탭 전환 등 1회성 UI 바인딩
// 블록은 모듈 로드 시 즉시 실행되어 기존 app.js의 실행 타이밍과 동일하게 유지된다.

import { calculateBlastDesign } from '../utils/blastCalculator.js';
import { state, dom, history } from '../core/state.js';
import { draw2D, screenToWorld, worldToScreen } from '../render/canvas2d.js';
import { init3DView, update3DView } from '../render/canvas3d.js';
import { generateAndRenderSpecTable } from '../render/benchProfile.js';
import { recalculateBurdenSpacing, getGeodesicDistance, recalculateAutoPatterns, updateABModalStats, generateABLinePattern, updateFreeFaceModalStats, generateFreeFacePattern, renderLoadingSheetTable, generateBoxPattern, getMapCosLat, syncPatternsToDesignBurdenSpacing, getDefaultDelayPreset } from '../patterns/blastPatterns.js';
import { createHoleChargeDefaults, calculateHoleCharge, applyBatchUpdate, calculateCorrectedPitch, estimateBoundingBoxCount } from '../core/blastEngine.js';
import { buildVibrationTable, calculatePPV, SAFE_THRESHOLD_CM_S } from '../core/vibrationTable.js';
import { getDelayGroups, isSimPlaying, setSimStep, playDelaySimulation, pauseDelaySimulation } from '../components/leftSidebar(왼쪽사이드바)/blastSimulation(발파시뮬레이션)/delaySimulator.js';
import { renderHoleEditPanel } from '../components/leftSidebar(왼쪽사이드바)/holeEditor(발파공편집)/holeEditor(발파공편집).js';
import { renderBenchProfileView } from '../components/rightSidebar(오른쪽사이드바)/benchProfile(벤치단면도)/benchProfile(벤치단면도).js';
import { createExportImport } from '../io/exportImport.js';
import { createSupabaseSync } from '../backend(백엔드)/cloud(클라우드연동)/supabaseSync.js';
import { createAuthManager } from '../backend(백엔드)/auth(인증)/authManager.js';
import { canUseFeature, TIERS } from '../backend(백엔드)/billing(요금제티어)/tierConfig.js';
import { initMap, loadGeoTIFFFile, applyTifExtent, parseTFW, load3DModelFile, loadLAZFile, loadDemo3DTerrain } from '../main.js';
import { refreshActiveAnalysisOverlay } from './analysisOverlay.js';

// 자유면 모달에서 공간격(S)을 사용자가 직접 입력했는지 추적 — 켜져 있으면 저항선(B) 입력
// 리스너가 S를 'B×1.25'로 자동 재계산하지 않는다. 모달이 새로 열릴 때(자유면을 새로 그릴 때) 꺼진다.
let faceSpacingManuallyEdited = false;

export function initEvents() {
    // Project File I/O (JSON/CSV export, JSON import, print report)
    // 구현은 src/io/exportImport.js 참고. initEvents() 호출 시점(DOMContentLoaded 이후)에는
    // 전체 모듈 그래프 평가가 끝나 있으므로 여기서 state/dom/history를 안전하게 읽을 수 있다.
    const { exportProjectJSON, exportProjectCSV, importProjectJSON, printReport } = createExportImport({
        state, dom, history, calculateHoleCharge, showToast, recalculateBurdenSpacing, updateDashboard, draw2D, initMap
    });

    // Supabase Cloud Sync Integration — 구현은 src/cloud/supabaseSync.js 참고.
    const { saveProjectToCloud, loadCloudProjectList, deleteProjectFromCloud, loadProjectFromCloud } = createSupabaseSync({
        state, dom, showToast, recalculateBurdenSpacing, updateDashboard, draw2D, update3DView,
        onUpgradeNeeded: () => openPricingModal()
    });

    // 요금제 모달 — 구현은 src/billing/tierConfig.js의 TIERS 참고.
    function openPricingModal() {
        document.querySelectorAll('#pricing-cards-container .pricing-card').forEach(card => {
            const badge = card.querySelector('.pricing-card-badge');
            const isCurrent = state.userProfile && state.userProfile.tier === card.dataset.tier;
            badge.style.display = isCurrent ? 'block' : 'none';
        });
        document.getElementById('pricing-modal').classList.remove('hidden');
    }

    function closePricingModal() {
        document.getElementById('pricing-modal').classList.add('hidden');
    }

    document.getElementById('btn-pricing').addEventListener('click', () => openPricingModal());
    document.getElementById('btn-pricing-close').addEventListener('click', closePricingModal);
    document.querySelectorAll('.btn-upgrade-tier').forEach(btn => {
        btn.addEventListener('click', () => {
            showToast('사업자 등록 완료 후 결제가 가능합니다.', 'lock');
        });
    });

    // Supabase Auth Integration — 구현은 src/auth/authManager.js 참고.
    // 클라우드 저장/불러오기는 로그인한 회원만 이용 가능한 프리미엄 기능이며,
    // 미로그인 상태에서 버튼을 누르면 로그인 모달로 유도하고, 로그인 성공 시 원래 하려던 동작을 이어서 연다.
    let authMode = 'login'; // 'login' | 'signup'
    let pendingCloudAction = null; // 'save' | 'list' | null
    let pendingVerifyEmail = null; // 회원가입 인증번호 확인 대기 중인 이메일

    const { initAuth, signUp, signIn, signOut, verifySignupOtp, resendSignupOtp } = createAuthManager({
        state,
        onAuthStateChange: updateAuthUI
    });

    function updateAuthUI(user) {
        const loginBtn = document.getElementById('btn-auth-login');
        const userInfo = document.getElementById('auth-user-info');
        const userEmail = document.getElementById('auth-user-email');
        const userTier = document.getElementById('auth-user-tier');
        if (user) {
            loginBtn.style.display = 'none';
            userInfo.style.display = 'flex';
            userEmail.textContent = user.email;
            const tier = state.userProfile ? state.userProfile.tier : 'free';
            userTier.textContent = (TIERS[tier] || TIERS.free).label;
            userTier.style.display = 'inline-block';
        } else {
            loginBtn.style.display = 'flex';
            userInfo.style.display = 'none';
            userEmail.textContent = '';
            userTier.style.display = 'none';
        }
    }

    function openAuthModal(mode) {
        authMode = mode;
        pendingVerifyEmail = null;
        const title = document.getElementById('auth-modal-title');
        const submitBtn = document.getElementById('btn-auth-submit');
        const toggleText = document.getElementById('auth-toggle-text');
        const toggleLink = document.getElementById('auth-toggle-link');
        const errorMsg = document.getElementById('auth-error-msg');
        const nameField = document.getElementById('auth-name-field');
        errorMsg.style.display = 'none';
        document.getElementById('auth-input-password').value = '';
        document.getElementById('auth-input-name').value = '';

        document.getElementById('auth-credentials-fields').style.display = 'flex';
        document.getElementById('auth-otp-step').style.display = 'none';
        document.getElementById('auth-credentials-buttons').style.display = 'flex';
        document.getElementById('auth-otp-buttons').style.display = 'none';
        document.getElementById('auth-toggle-row').style.display = 'block';

        if (mode === 'signup') {
            title.textContent = '📝 회원가입';
            submitBtn.textContent = '회원가입';
            toggleText.textContent = '이미 계정이 있으신가요?';
            toggleLink.textContent = '로그인';
            nameField.style.display = 'flex';
        } else {
            title.textContent = '🔒 로그인';
            submitBtn.textContent = '로그인';
            toggleText.textContent = '계정이 없으신가요?';
            toggleLink.textContent = '회원가입';
            nameField.style.display = 'none';
        }
        document.getElementById('auth-modal').classList.remove('hidden');
        document.getElementById('auth-input-email').focus();
    }

    function openOtpStep(email) {
        pendingVerifyEmail = email;
        const errorMsg = document.getElementById('auth-error-msg');
        errorMsg.style.display = 'none';
        document.getElementById('auth-input-otp').value = '';
        document.getElementById('auth-otp-email').textContent = email;

        document.getElementById('auth-modal-title').textContent = '📩 이메일 인증';
        document.getElementById('auth-credentials-fields').style.display = 'none';
        document.getElementById('auth-otp-step').style.display = 'flex';
        document.getElementById('auth-credentials-buttons').style.display = 'none';
        document.getElementById('auth-otp-buttons').style.display = 'flex';
        document.getElementById('auth-toggle-row').style.display = 'none';

        document.getElementById('auth-modal').classList.remove('hidden');
        document.getElementById('auth-input-otp').focus();
    }

    function closeAuthModal() {
        document.getElementById('auth-modal').classList.add('hidden');
        pendingCloudAction = null;
        pendingVerifyEmail = null;
    }

    function resumePendingCloudAction() {
        document.getElementById('auth-modal').classList.add('hidden');
        if (pendingCloudAction === 'save') {
            document.getElementById('cloud-save-modal').classList.remove('hidden');
            document.getElementById('cloud-project-name').focus();
        } else if (pendingCloudAction === 'list') {
            document.getElementById('cloud-list-modal').classList.remove('hidden');
            loadCloudProjectList();
        }
        pendingCloudAction = null;
    }

    document.getElementById('btn-auth-login').addEventListener('click', () => openAuthModal('login'));
    document.getElementById('btn-auth-cancel').addEventListener('click', closeAuthModal);
    document.getElementById('auth-toggle-link').addEventListener('click', (e) => {
        e.preventDefault();
        openAuthModal(authMode === 'login' ? 'signup' : 'login');
    });
    document.getElementById('btn-auth-logout').addEventListener('click', async () => {
        await signOut();
        showToast('로그아웃되었습니다.', 'log-out');
    });
    // 버튼을 연타하거나 클릭이 중복 발생해도 요청이 두 번 나가지 않도록 막는 재진입 방지 래퍼.
    // (이메일이 두 통씩 발송되던 문제 — 같은 요청이 끝나기 전에 다시 눌려서 signUp/resend가 중복 호출됐었음)
    function guardClick(btn, handler) {
        let inFlight = false;
        btn.addEventListener('click', async (e) => {
            if (inFlight) return;
            inFlight = true;
            btn.disabled = true;
            try {
                await handler(e);
            } finally {
                inFlight = false;
                btn.disabled = false;
            }
        });
    }

    guardClick(document.getElementById('btn-auth-submit'), async () => {
        const email = document.getElementById('auth-input-email').value.trim();
        const password = document.getElementById('auth-input-password').value;
        const name = document.getElementById('auth-input-name').value.trim();
        const errorMsg = document.getElementById('auth-error-msg');
        errorMsg.style.display = 'none';

        if (!email || !password || (authMode === 'signup' && !name)) {
            errorMsg.textContent = authMode === 'signup'
                ? '이름, 이메일, 비밀번호를 모두 입력해 주세요.'
                : '이메일과 비밀번호를 모두 입력해 주세요.';
            errorMsg.style.display = 'block';
            return;
        }

        try {
            if (authMode === 'signup') {
                const result = await signUp(email, password, name);
                if (result.session) {
                    // Supabase 프로젝트의 "Confirm email"이 꺼져 있으면 가입과 동시에 세션이 즉시 발급된다 —
                    // 이 경우 인증번호 입력 단계 자체가 불필요하므로 건너뛴다.
                    showToast('회원가입이 완료되었습니다!', 'check-circle');
                    resumePendingCloudAction();
                } else {
                    showToast('인증번호를 이메일로 발송했습니다.', 'mail');
                    openOtpStep(email);
                }
            } else {
                await signIn(email, password);
                showToast('로그인되었습니다.', 'check-circle');
                resumePendingCloudAction();
            }
        } catch (err) {
            errorMsg.textContent = err.message || '요청 처리 중 오류가 발생했습니다.';
            errorMsg.style.display = 'block';
        }
    });

    document.getElementById('btn-otp-cancel').addEventListener('click', closeAuthModal);
    guardClick(document.getElementById('btn-otp-resend'), async (e) => {
        e.preventDefault();
        if (!pendingVerifyEmail) return;
        try {
            await resendSignupOtp(pendingVerifyEmail);
            showToast('인증번호를 다시 보냈습니다.', 'mail');
        } catch (err) {
            const errorMsg = document.getElementById('auth-error-msg');
            errorMsg.textContent = err.message || '재전송 중 오류가 발생했습니다.';
            errorMsg.style.display = 'block';
        }
    });
    guardClick(document.getElementById('btn-otp-verify'), async () => {
        const token = document.getElementById('auth-input-otp').value.trim();
        const errorMsg = document.getElementById('auth-error-msg');
        errorMsg.style.display = 'none';

        if (!token) {
            errorMsg.textContent = '인증번호를 입력해 주세요.';
            errorMsg.style.display = 'block';
            return;
        }

        try {
            await verifySignupOtp(pendingVerifyEmail, token);
            showToast('이메일 인증이 완료되었습니다!', 'check-circle');
            resumePendingCloudAction();
        } catch (err) {
            errorMsg.textContent = err.message || '인증번호가 올바르지 않습니다.';
            errorMsg.style.display = 'block';
        }
    });

    initAuth();

    // View Toggles
    dom.toggle2d.addEventListener('click', () => switchView('2d'));
    dom.toggle3d.addEventListener('click', () => {
        const tier = state.userProfile ? state.userProfile.tier : 'free';
        if (!canUseFeature(tier, 'view3D')) {
            showToast('3D 뷰어는 프로 등급부터 이용 가능합니다.', 'lock');
            openPricingModal();
            return;
        }
        switchView('3d');
    });

    // Toolbar Selection
    const tools = ['pan', 'delete-hole', 'move-hole', 'add-hole', 'ws-pattern', 'ab-line', 'draw-face', 'box-pattern'];
    tools.forEach(tool => {
        const btn = document.getElementById(`tool-${tool}`);
        if (btn) {
            btn.addEventListener('click', (e) => {
                if (tool === 'ab-line') {
                    const tier = state.userProfile ? state.userProfile.tier : 'free';
                    if (!canUseFeature(tier, 'abLineTool')) {
                        showToast('A-B Line 자동 패턴 도구는 프로 등급부터 이용 가능합니다.', 'lock');
                        openPricingModal();
                        return;
                    }
                }
                selectTool(tool);
            });
        }
    });

    // Action buttons
    dom.btnClearHoles.addEventListener('click', clearHoles);
    document.getElementById('btn-clear-measurements').addEventListener('click', () => {
        if (state.customMeasurements.length > 0) {
            history.save();
            state.customMeasurements = [];
            draw2D();
            showToast("측정선이 모두 초기화되었습니다.", "trash-2");
        }
    });
    dom.btnNewProject.addEventListener('click', newProject);
    dom.btnExportJson.addEventListener('click', exportProjectJSON);
    dom.btnExportCsv.addEventListener('click', exportProjectCSV);
    dom.importFile.addEventListener('change', importProjectJSON);
    dom.btnPrintReport.addEventListener('click', printReport);
    
    // Supabase Cloud integration event bindings
    const btnCloudSave = document.getElementById('btn-cloud-save');
    const btnCloudList = document.getElementById('btn-cloud-list');
    const btnCloudSaveCancel = document.getElementById('btn-cloud-save-cancel');
    const btnCloudSaveConfirm = document.getElementById('btn-cloud-save-confirm');
    const btnCloudListClose = document.getElementById('btn-cloud-list-close');

    if (btnCloudSave) {
        btnCloudSave.addEventListener('click', () => {
            document.getElementById('cloud-save-modal').classList.remove('hidden');
            document.getElementById('cloud-project-name').focus();
        });
    }
    if (btnCloudSaveCancel) {
        btnCloudSaveCancel.addEventListener('click', () => {
            document.getElementById('cloud-save-modal').classList.add('hidden');
        });
    }
    if (btnCloudSaveConfirm) {
        guardClick(btnCloudSaveConfirm, async () => {
            const name = document.getElementById('cloud-project-name').value.trim();
            if (!name) {
                showToast("프로젝트명을 입력해 주세요.", "warning");
                return;
            }
            await saveProjectToCloud(name);
        });
    }
    if (btnCloudList) {
        btnCloudList.addEventListener('click', () => {
            document.getElementById('cloud-list-modal').classList.remove('hidden');
            loadCloudProjectList();
        });
    }
    if (btnCloudListClose) {
        btnCloudListClose.addEventListener('click', () => {
            document.getElementById('cloud-list-modal').classList.add('hidden');
        });
    }
    
    // Undo / Redo click bindings
    document.getElementById('btn-undo').addEventListener('click', () => history.undo());
    document.getElementById('btn-redo').addEventListener('click', () => history.redo());

    // Keyboard shortcuts (including ESC cancel)
    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            // 자유면을 그리는 도중이면 전역 undo 대신 마지막으로 찍은 점 하나만 제거
            if (state.selectedTool === 'draw-face' && state.tempFreeFace.length > 0) {
                state.tempFreeFace.pop();
                state.tempFreeFaceCursor = null;
                draw2D();
            } else {
                history.undo();
            }
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            history.redo();
        }
        if (e.key === 'Escape') {
            if (state.activeWSPattern) {
                // Cancel current drawing of W-S auto pattern and remove first hole
                const h1Id = state.activeWSPattern.h1Id;
                state.holes = state.holes.filter(h => h.id !== h1Id);
                const rowName = `WS Row ${state.nextRowIndex}`;
                delete state.rows[rowName];
                state.activeWSPattern = null;
                selectTool('pan');
                draw2D();
                showToast("W-S 패턴 작성이 취소되었습니다.", "info");
            }
            if (state.tempABLine) {
                dom.abModal.classList.add('hidden');
                state.tempABLine = null;
                selectTool('pan');
                draw2D();
                showToast("A-B 라인 패턴 작성이 취소되었습니다.", "info");
            }
            if (state.tempFreeFace.length > 0) {
                dom.faceModal.classList.add('hidden');
                state.tempFreeFace = [];
                state.tempFreeFaceCursor = null;
                selectTool('pan');
                draw2D();
                showToast("자유면 그리기가 취소되었습니다.", "info");
            }
        }
        // Enter key finalizes the free-face polyline currently being drawn
        if (e.key === 'Enter' && state.selectedTool === 'draw-face' && state.tempFreeFace.length >= 2) {
            e.preventDefault();
            finalizeFreeFaceDrawing();
        }
    });

    // A-B Line Modal Events
    if (dom.abInputBurden) {
        dom.abInputBurden.addEventListener('input', () => {
            const burden = parseFloat(dom.abInputBurden.value) || 2.5;
            dom.abInputSpacing.value = (burden * 1.25).toFixed(3);
            updateABModalStats();
        });
        dom.abInputSpacing.addEventListener('input', updateABModalStats);
        dom.abInputRows.addEventListener('input', updateABModalStats);
        dom.abInputStagger.addEventListener('change', () => {
            const preset = getDefaultDelayPreset(dom.abInputStagger.checked);
            if (dom.abInputRowDelay) dom.abInputRowDelay.value = preset.rowDelayMs;
            if (dom.abInputSpacingDelay) dom.abInputSpacingDelay.value = preset.spacingDelayMs;
            updateABModalStats();
        });
        if (dom.abInputAngle) {
            dom.abInputAngle.addEventListener('input', updateABModalStats);
        }
        
        dom.btnAbFlip.addEventListener('click', () => {
            state.abLineDirection *= -1;
            draw2D();
        });
        
        dom.btnAbCancel.addEventListener('click', () => {
            dom.abModal.classList.add('hidden');
            state.tempABLine = null;
            selectTool('pan');
            draw2D();
        });
        
        dom.btnAbGenerate.addEventListener('click', generateABLinePattern);
    }

    // Free Face Pattern Modal Events
    if (dom.faceInputBurden) {
        dom.faceInputBurden.addEventListener('input', () => {
            const burden = parseFloat(dom.faceInputBurden.value) || 2.5;
            if (!faceSpacingManuallyEdited) {
                dom.faceInputSpacing.value = (burden * 1.25).toFixed(3);
            }
            updateFreeFaceModalStats();
            draw2D();
        });
        dom.faceInputSpacing.addEventListener('input', () => {
            faceSpacingManuallyEdited = true;
            updateFreeFaceModalStats();
        });
        dom.faceInputRows.addEventListener('input', updateFreeFaceModalStats);
        dom.faceInputStagger.addEventListener('change', () => {
            const preset = getDefaultDelayPreset(dom.faceInputStagger.checked);
            if (dom.faceInputRowDelay) dom.faceInputRowDelay.value = preset.rowDelayMs;
            if (dom.faceInputSpacingDelay) dom.faceInputSpacingDelay.value = preset.spacingDelayMs;
            updateFreeFaceModalStats();
        });
        if (dom.faceInputAngle) {
            dom.faceInputAngle.addEventListener('input', updateFreeFaceModalStats);
        }

    }

    // 글로벌 이벤트 위임: 모달이 존재하는 시점과 무관하게 작동
    document.addEventListener('click', (e) => {
        if (e.target.id === 'btn-face-flip') {
            state.faceLineDirection *= -1;
            draw2D();
        } else if (e.target.id === 'btn-face-cancel') {
            dom.faceModal.classList.add('hidden');
            state.freeFace = [];
            selectTool('pan');
            draw2D();
        } else if (e.target.id === 'btn-face-generate') {
            generateFreeFacePattern();
        }
    });

    if (dom.inputVworldKey) {
        dom.inputVworldKey.addEventListener('input', () => {
            initMap();
        });
    }
    if (dom.inputNgiiKey) {
        dom.inputNgiiKey.addEventListener('input', () => {
            initMap();
        });
    }
    if (dom.selectBaseMap) {
        dom.selectBaseMap.addEventListener('change', () => {
            initMap();
        });
    }

    // 2D GeoTIFF Loader Events
    if (dom.dropZoneTif) {
        dom.dropZoneTif.addEventListener('click', () => dom.fileUploaderTif.click());
        dom.fileUploaderTif.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                loadGeoTIFFFile(e.target.files[0]);
            }
        });
        dom.dropZoneTif.addEventListener('dragover', (e) => {
            e.preventDefault();
            dom.dropZoneTif.classList.add('dragover');
        });
        dom.dropZoneTif.addEventListener('dragleave', () => {
            dom.dropZoneTif.classList.remove('dragover');
        });
        dom.dropZoneTif.addEventListener('drop', (e) => {
            e.preventDefault();
            dom.dropZoneTif.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                loadGeoTIFFFile(e.dataTransfer.files[0]);
            }
        });
    }

    // TIF GPS Calibration Modal Events
    const tabTifTfw = document.getElementById('tab-tif-tfw');
    const tabTifManual = document.getElementById('tab-tif-manual');
    const panelTifTfw = document.getElementById('panel-tif-tfw');
    const panelTifManual = document.getElementById('panel-tif-manual');
    const dropZoneTfw = document.getElementById('drop-zone-tfw');
    const fileUploaderTfw = document.getElementById('file-uploader-tfw');
    const btnTifGpsCancel = document.getElementById('btn-tif-gps-cancel');
    const btnTifGpsApply = document.getElementById('btn-tif-gps-apply');

    let activeTab = 'tfw'; // 'tfw' or 'manual'

    if (tabTifTfw && tabTifManual) {
        tabTifTfw.addEventListener('click', () => {
            activeTab = 'tfw';
            tabTifTfw.style.borderBottom = '2px solid var(--accent-cyan)';
            tabTifTfw.style.color = '#fff';
            tabTifManual.style.borderBottom = 'none';
            tabTifManual.style.color = 'var(--text-muted)';
            panelTifTfw.classList.remove('hidden');
            panelTifManual.classList.add('hidden');
        });

        tabTifManual.addEventListener('click', () => {
            activeTab = 'manual';
            tabTifManual.style.borderBottom = '2px solid var(--accent-cyan)';
            tabTifManual.style.color = '#fff';
            tabTifTfw.style.borderBottom = 'none';
            tabTifTfw.style.color = 'var(--text-muted)';
            panelTifManual.classList.remove('hidden');
            panelTifTfw.classList.add('hidden');
        });
    }

    if (dropZoneTfw) {
        dropZoneTfw.addEventListener('click', () => fileUploaderTfw.click());
        fileUploaderTfw.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleTFWFile(e.target.files[0]);
            }
        });
        dropZoneTfw.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZoneTfw.classList.add('dragover');
        });
        dropZoneTfw.addEventListener('dragleave', () => {
            dropZoneTfw.classList.remove('dragover');
        });
        dropZoneTfw.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZoneTfw.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                handleTFWFile(e.dataTransfer.files[0]);
            }
        });
    }

    function handleTFWFile(tfwFile) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            const tfwData = parseTFW(text);
            if (tfwData) {
                if (!state.tempTifFile) state.tempTifFile = {};
                state.tempTifFile.tfw = tfwData;
                showToast("TFW 파일 분석 성공!", "check-circle");
                const dropText = dropZoneTfw.querySelector('p');
                if (dropText) {
                    dropText.textContent = `TFW 분석 완료 (원점: ${tfwData.xOrigin.toFixed(1)}, ${tfwData.yOrigin.toFixed(1)})`;
                }
                
                // Auto-detect projection based on xOrigin range
                const projSelect = document.getElementById('select-tfw-projection');
                if (projSelect) {
                    if (tfwData.xOrigin > 800000) {
                        projSelect.value = "EPSG:5179"; // UTM-K
                    } else if (tfwData.xOrigin > 280000) {
                        projSelect.value = "EPSG:5187"; // East Belt
                    } else {
                        projSelect.value = "EPSG:5186"; // Central Belt
                    }
                }
            } else {
                showToast("올바른 TFW 형식 파일이 아닙니다.", "alert-triangle");
            }
        };
        reader.readAsText(tfwFile);
    }

    if (btnTifGpsCancel) {
        btnTifGpsCancel.addEventListener('click', () => {
            document.getElementById('tif-gps-modal').classList.add('hidden');
            state.tempTifFile = null;
        });
    }

    if (btnTifGpsApply) {
        btnTifGpsApply.addEventListener('click', () => {
            if (!state.tempTifFile) {
                showToast("보정할 TIF 파일 정보가 유실되었습니다. 다시 올려주십시오.", "warning");
                return;
            }

            if (activeTab === 'tfw') {
                if (!state.tempTifFile.tfw) {
                    showToast("TFW 파일을 먼저 업로드해 주십시오.", "warning");
                    return;
                }
                const tfw = state.tempTifFile.tfw;
                const epsgCode = document.getElementById('select-tfw-projection').value || 'EPSG:5179';
                
                const minX = tfw.xOrigin;
                const maxY = tfw.yOrigin;
                const maxX = minX + state.tempTifFile.width * tfw.xScale;
                const minY = maxY + state.tempTifFile.height * tfw.yScale; // yScale is negative
                
                const extent = [minX, minY, maxX, maxY];
                const centerX = minX + (state.tempTifFile.width * tfw.xScale) / 2;
                const centerY = maxY + (state.tempTifFile.height * tfw.yScale) / 2;
                
                applyTifExtent(state.tempTifFile.file, extent, epsgCode, [centerX, centerY]);
            } else {
                const latInput = document.getElementById('input-tif-lat');
                const lonInput = document.getElementById('input-tif-lon');
                const resInput = document.getElementById('input-tif-resolution');
                
                const lat = parseFloat(latInput.value);
                const lon = parseFloat(lonInput.value);
                const res = parseFloat(resInput.value) || 0.25;
                
                if (isNaN(lat) || isNaN(lon)) {
                    showToast("올바른 GPS 위도/경도를 입력해 주십시오.", "warning");
                    return;
                }
                
                const center = ol.proj.fromLonLat([lon, lat]);
                const halfWidth = (state.tempTifFile.width * res) / 2;
                const halfHeight = (state.tempTifFile.height * res) / 2;
                
                const extent = [
                    center[0] - halfWidth,
                    center[1] - halfHeight,
                    center[0] + halfWidth,
                    center[1] + halfHeight
                ];
                
                applyTifExtent(state.tempTifFile.file, extent, 'EPSG:3857', center);
            }
        });
    }

    // 3D Terrain Loader Events
    if (dom.dropZone3D) {
        dom.dropZone3D.addEventListener('click', () => dom.fileUploader3D.click());
        dom.fileUploader3D.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                load3DModelFile(e.target.files[0]);
            }
        });
        dom.dropZone3D.addEventListener('dragover', (e) => {
            e.preventDefault();
            dom.dropZone3D.classList.add('dragover');
        });
        dom.dropZone3D.addEventListener('dragleave', () => dom.dropZone3D.classList.remove('dragover'));
        dom.dropZone3D.addEventListener('drop', (e) => {
            e.preventDefault();
            dom.dropZone3D.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                load3DModelFile(e.dataTransfer.files[0]);
            }
        });
    }

    // LAZ Point Cloud Loader Events
    if (dom.dropZoneLaz) {
        dom.dropZoneLaz.addEventListener('click', () => dom.fileUploaderLaz.click());
        dom.fileUploaderLaz.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                loadLAZFile(e.target.files[0]);
            }
        });
        dom.dropZoneLaz.addEventListener('dragover', (e) => {
            e.preventDefault();
            dom.dropZoneLaz.classList.add('dragover');
        });
        dom.dropZoneLaz.addEventListener('dragleave', () => dom.dropZoneLaz.classList.remove('dragover'));
        dom.dropZoneLaz.addEventListener('drop', (e) => {
            e.preventDefault();
            dom.dropZoneLaz.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                loadLAZFile(e.dataTransfer.files[0]);
            }
        });
    }

    if (dom.btnLoadDemo3D) {
        dom.btnLoadDemo3D.addEventListener('click', loadDemo3DTerrain);
    }

    // 3D Terrain GPS Modal event listeners
    const updateModalScalePreview = () => {
        const lat = parseFloat(dom.inputTerrainLat.value) || 36.5;
        const type = dom.selectTerrainCoordType.value;
        let scale = 1.0;
        if (type === 'mercator') {
            scale = Math.cos(lat * Math.PI / 180);
        }
        dom.terrainScaleInfo.textContent = `${scale.toFixed(6)} (1단위 = ${scale.toFixed(2)}m)`;
    };
    
    dom.inputTerrainLat.addEventListener('input', updateModalScalePreview);
    dom.selectTerrainCoordType.addEventListener('change', updateModalScalePreview);
    
    dom.btnTerrainGpsCancel.addEventListener('click', () => {
        state.scaleFactor = 1.0;
        state.isScaleCalibrated = true;
        dom.scaleIndicator.textContent = "기본 실측 스케일 적용됨 (1단위 = 1.00m)";
        dom.scaleIndicator.parentElement.style.borderLeftColor = 'var(--accent-cyan)';
        dom.terrainGpsModal.classList.add('hidden');
        
        recalculateBurdenSpacing();
        updateDashboard();
        draw2D();
        if (state.three.active) update3DView();
    });
    
    dom.btnTerrainGpsApply.addEventListener('click', () => {
        const lat = parseFloat(dom.inputTerrainLat.value) || 36.5;
        const lon = parseFloat(dom.inputTerrainLon.value) || 127.5;
        const type = dom.selectTerrainCoordType.value;
        
        let scale = 1.0;
        if (type === 'mercator') {
            scale = Math.cos(lat * Math.PI / 180);
            state.scaleFactor = scale;
            state.isScaleCalibrated = true;
            dom.scaleIndicator.textContent = `Mercator 보정 적용됨 (위도: ${lat}°, 1단위 = ${scale.toFixed(4)}m)`;
            dom.scaleIndicator.parentElement.style.borderLeftColor = 'var(--accent-cyan)';
        } else {
            state.scaleFactor = 1.0;
            state.isScaleCalibrated = true;
            dom.scaleIndicator.textContent = "Local/UTM 실측 1:1 적용됨 (1단위 = 1.00m)";
            dom.scaleIndicator.parentElement.style.borderLeftColor = 'var(--accent-cyan)';
        }
        
        state.terrainOffset = { x: lon, y: lat };
        
        dom.terrainGpsModal.classList.add('hidden');
        
        recalculateBurdenSpacing();
        updateDashboard();
        draw2D();
        if (state.three.active) update3DView();
        
        showToast(`좌표계 및 스케일 보정 완료 (위도: ${lat}°, 경도: ${lon}°, 스케일 배율: ${state.scaleFactor.toFixed(5)})`, 'check-circle');
    });

    history.updateButtons();

    // Inputs bindings to update calculations in real-time
    const inputElements = [
        dom.inputTargetSpacing, dom.inputTargetBurden, dom.inputBenchHeight,
        dom.inputSubdrill, dom.inputHoleDiameter, dom.inputHoleAngle,
        dom.inputStemmingHeight, dom.inputExplosiveDensity, dom.inputRockDensity,
        dom.inputBsRatio
    ];
    inputElements.forEach(input => {
        if (!input) return;
        input.addEventListener('input', () => {
            updateParamsFromInputs();
            recalculateAutoPatterns(); // Recalculate auto patterns when BS ratio or other inputs change
            updateDashboard();
            if (state.three.active) update3DView();
            draw2D();
        });
    });

    // Scale Dialog Actions
    dom.btnScaleCancel.addEventListener('click', () => {
        dom.scaleModal.classList.add('hidden');
        state.tempScaleLine = null;
        draw2D();
    });
    
    dom.btnScaleSave.addEventListener('click', () => {
        const distance = parseFloat(dom.inputScaleDistance.value);
        if (distance > 0 && state.tempScaleLine) {
            history.save(); // Save history before scale calibration changes
            const dx = state.tempScaleLine.end.x - state.tempScaleLine.start.x;
            const dy = state.tempScaleLine.end.y - state.tempScaleLine.start.y;
            const pixelLen = Math.sqrt(dx * dx + dy * dy);
            state.scaleFactor = distance / pixelLen;
            state.isScaleCalibrated = true;
            dom.scaleIndicator.textContent = `보정됨 (1px = ${state.scaleFactor.toFixed(4)}m)`;
            dom.scaleIndicator.parentElement.style.borderLeftColor = 'var(--accent-green)';
            
            // Recalculate everything
            recalculateBurdenSpacing();
            updateDashboard();
        }
        dom.scaleModal.classList.add('hidden');
        state.tempScaleLine = null;
        selectTool('pan');
        draw2D();
    });

    // Tab Switching
    dom.tabSummary.addEventListener('click', () => switchTab('summary'));
    dom.tabLoadingSheet.addEventListener('click', () => switchTab('loading-sheet'));

    // 2D Canvas Editor Draw and Pan interactions
    dom.canvas.addEventListener('mousedown', handleMouseDown);
    dom.canvas.addEventListener('mousemove', handleMouseMove);
    dom.canvas.addEventListener('mouseup', handleMouseUp);
    dom.canvas.addEventListener('dblclick', handleDoubleClick);
    dom.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.canvas.addEventListener('wheel', handleCanvasWheel, { passive: false });

    // Map Viewport Draw interactions (delegated to editorMap when pointer-events: none is on canvas)
    if (dom.editorMap) {
        dom.editorMap.addEventListener('mousedown', handleMouseDown);
        dom.editorMap.addEventListener('mousemove', handleMouseMove);
        dom.editorMap.addEventListener('mouseup', handleMouseUp);
        dom.editorMap.addEventListener('dblclick', handleDoubleClick);
        dom.editorMap.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // 발파 시뮬레이션 (왼쪽 사이드바 "발파 시뮬레이션" 아코디언) — 재생/일시정지, 타임라인 스크러빙, 시차 편집
    document.getElementById('btn-blast-sim-play').addEventListener('click', () => {
        if (isSimPlaying()) {
            pauseDelaySimulation();
        } else {
            if (state.three.active) switchView('2d');
            const stepMs = parseInt(document.getElementById('input-blast-sim-step-ms').value, 10) || 200;
            playDelaySimulation(stepMs);
        }
        syncSimTimelineUI();
    });
    document.getElementById('input-blast-sim-timeline').addEventListener('input', (e) => {
        pauseDelaySimulation();
        setSimStep(parseInt(e.target.value, 10));
        syncSimTimelineUI();
    });
    document.getElementById('input-blast-sim-delay').addEventListener('input', (e) => {
        const ids = state.selectedHoleIds;
        const val = e.target.value.trim();
        if (ids.length === 0 || !val) return;
        if (ids.length === 1) {
            const hole = state.holes.find(h => h.id === ids[0]);
            if (!hole) return;
            hole.delayIndex = val;
            hole.isModified = true;
        } else {
            applyBatchUpdate(ids, { delayIndex: val });
        }
        reactToHoleEdit();
        renderBlastSimPanel();
    });
    document.getElementById('btn-blast-sim-apply-row-spacing').addEventListener('click', () => {
        const ids = state.selectedHoleIds;
        if (ids.length === 0) {
            showToast('시차를 적용할 공을 먼저 선택하세요.', 'alert-triangle');
            return;
        }
        const rowDelayMs = parseFloat(document.getElementById('input-blast-sim-row-delay').value) || 0;
        const spacingDelayMs = parseFloat(document.getElementById('input-blast-sim-spacing-delay').value) || 0;

        // 선택된 공들을 기존 행(row) 구조(hole.rowName / state.rows) 기준으로 재구성한다 — 패턴 생성 시
        // assignDelayTiming()이 쓰는 것과 동일한 행 개념을 그대로 재사용 (새 기하 판별 로직을 만들지 않음).
        const byRow = new Map();
        ids.forEach(id => {
            const hole = state.holes.find(h => h.id === id);
            if (!hole) return;
            if (!byRow.has(hole.rowName)) byRow.set(hole.rowName, []);
            byRow.get(hole.rowName).push(hole);
        });
        const selectedRowNames = Object.keys(state.rows).filter(rn => byRow.has(rn));

        history.save();
        selectedRowNames.forEach((rowName, rIdx) => {
            // 행 안 순서 = state.rows[rowName]의 배치 순서(패턴 생성/공 생성 순서) 중 선택된 공만 추림
            const rowHoles = state.rows[rowName]
                .map(id => byRow.get(rowName).find(h => h.id === id))
                .filter(Boolean);
            rowHoles.forEach((hole, cIdx) => {
                hole.delayIndex = String(Math.round(rowDelayMs * rIdx + spacingDelayMs * cIdx));
                hole.isModified = true;
            });
        });
        reactToHoleEdit();
        renderBlastSimPanel();
        showToast(`${ids.length}개 공에 행/공간 시차 적용 완료`, 'check-circle');
    });
    document.getElementById('input-custom-distance').addEventListener('input', (e) => {
        const D = parseFloat(e.target.value);
        const statusEl = document.getElementById('val-custom-ppv-status');
        const valEl = document.getElementById('val-custom-ppv');
        if (isNaN(D) || D <= 0) {
            valEl.textContent = '—';
            statusEl.textContent = '';
            return;
        }
        const { wMax } = buildVibrationTable(state.holes);
        const V = calculatePPV(D, wMax, state.vibrationConstants.K, state.vibrationConstants.n);
        valEl.textContent = V.toFixed(3);
        if (wMax <= 0) {
            statusEl.textContent = '발파공을 배치하세요';
            statusEl.style.color = 'var(--text-muted)';
        } else if (V <= SAFE_THRESHOLD_CM_S) {
            statusEl.textContent = '안전 (주택 기준 만족)';
            statusEl.style.color = 'var(--accent-green)';
        } else {
            statusEl.textContent = '주의 / 기준 초과';
            statusEl.style.color = 'var(--accent-red)';
        }
    });
}

export function switchView(view) {
    if (view === '2d') {
        dom.toggle2d.classList.add('active');
        dom.toggle3d.classList.remove('active');
        dom.container2d.classList.add('active');
        dom.container3d.classList.add('hidden');
        dom.container3d.classList.remove('active');
        state.three.active = false;
        
        if (state.map && !state.canvasMode) {
            dom.canvas.style.pointerEvents = 'none';
            setTimeout(() => {
                if (state.map) state.map.updateSize();
            }, 50);
        } else {
            dom.canvas.style.pointerEvents = 'auto';
        }
        
        draw2D();
    } else {
        dom.toggle2d.classList.remove('active');
        dom.toggle3d.classList.add('active');
        dom.container2d.classList.remove('active');
        dom.container3d.classList.remove('hidden');
        dom.container3d.classList.add('active');
        state.three.active = true;
        init3DView();
    }
}

export function switchTab(tab) {
    if (tab === 'summary') {
        dom.tabSummary.classList.add('active');
        dom.tabLoadingSheet.classList.remove('active');
        dom.tabContentSummary.classList.add('active');
        dom.tabContentLoadingSheet.classList.remove('active');
    } else {
        dom.tabSummary.classList.remove('active');
        dom.tabLoadingSheet.classList.add('active');
        dom.tabContentSummary.classList.remove('active');
        dom.tabContentLoadingSheet.classList.add('active');
        renderLoadingSheetTable();
    }
}

export function selectTool(toolName) {
    state.selectedTool = toolName;
    
    // Toggle OpenLayers DragPan interaction based on tool
    if (state.map) {
        state.map.getInteractions().forEach(interaction => {
            if (interaction instanceof ol.interaction.DragPan) {
                interaction.setActive(toolName === 'pan');
            }
        });
    }
    
    // Toggle Three.js OrbitControls active state
    if (state.three.controls) {
        state.three.controls.enabled = (toolName === 'pan');
    }
    
    // Update toolbar active states
    // Cancel active drawing of W-S auto pattern if switching tools
    if (state.activeWSPattern && toolName !== 'ws-pattern') {
        const h1Id = state.activeWSPattern.h1Id;
        state.holes = state.holes.filter(h => h.id !== h1Id);
        const rowName = `WS Row ${state.nextRowIndex}`;
        delete state.rows[rowName];
        state.activeWSPattern = null;
    }
    // Cancel A-B Line if switching tools
    if (state.tempABLine && toolName !== 'ab-line') {
        state.tempABLine = null;
        dom.abModal.classList.add('hidden');
    }
    // Clear free-face pattern when entering draw-face mode to start fresh
    if (toolName === 'draw-face') {
        const oldPatterns = [...state.freeFacePatterns];
        state.freeFacePatterns = [];
        // Remove holes that belong to free-face patterns
        oldPatterns.forEach(p => {
            state.holes = state.holes.filter(h => !p.holeIds.includes(h.id));
            p.holeIds.forEach(id => {
                Object.keys(state.rows).forEach(rowName => {
                    state.rows[rowName] = state.rows[rowName].filter(hid => hid !== id);
                });
            });
        });
        // Clean up empty rows
        Object.keys(state.rows).forEach(rowName => {
            if (state.rows[rowName].length === 0) {
                delete state.rows[rowName];
            }
        });
        state.freeFace = [];
        state.tempFreeFace = [];
        state.tempFreeFaceCursor = null;
        dom.faceModal.classList.add('hidden');
    }
    // Cancel in-progress free-face drawing if switching tools
    if (state.tempFreeFace.length > 0 && toolName !== 'draw-face') {
        state.tempFreeFace = [];
        state.tempFreeFaceCursor = null;
        dom.faceModal.classList.add('hidden');
    }
    // Increment nextRowIndex if switching away from add-hole and that row has holes to prevent index clash
    if (state.selectedTool === 'add-hole' && toolName !== 'add-hole') {
        const rowName = `Row ${state.nextRowIndex}`;
        if (state.rows[rowName] && state.rows[rowName].length > 0) {
            state.nextRowIndex++;
        }
    }
    // Cancel Manual Hole Preview if switching tools
    if (state.tempHolePreview && toolName !== 'add-hole') {
        state.tempHolePreview = null;
    }
    // Cancel box-pattern drag preview if switching tools
    if (state.tempBoxPattern && toolName !== 'box-pattern') {
        state.tempBoxPattern = null;
    }

    // Clear 3D drawing previews group
    if (state.three.previewGroup) {
        state.three.previewGroup.clear();
    }

    const tools = ['pan', 'delete-hole', 'move-hole', 'add-hole', 'ws-pattern', 'ab-line', 'draw-face', 'box-pattern'];
    tools.forEach(t => {
        const btn = document.getElementById(`tool-${t}`);
        if (btn) {
            if (t === toolName) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });

    // Instructions display update
    let inst = "마우스 드래그: 지도 이동 | 휠: 확대/축소";
    if (toolName === 'delete-hole') {
        inst = "삭제할 발파공 위에 마우스를 올리거나 클릭하세요.";
    } else if (toolName === 'move-hole') {
        inst = "이동할 발파공을 마우스로 눌러 드래그한 후 놓으세요.";
    } else if (toolName === 'add-hole') {
        inst = "지도를 클릭하면 해당 위치에 새로운 발파공(핀)이 배치됩니다.";
    } else if (toolName === 'ws-pattern') {
        inst = "지도를 클릭해 1번 공을 배치한 후, 마우스를 이동해 저항선(W) 방향과 거리를 지정해 클릭하면 4공 패턴이 자동 완성됩니다. (ESC로 취소)";
    } else if (toolName === 'ab-line') {
        inst = "지도를 마우스로 드래그하여 기준선(A-B Line)을 그리세요. 마우스를 놓으면 다중 열 패턴 설정창이 뜹니다.";
    } else if (toolName === 'draw-face') {
        inst = "지도를 클릭해 자유면을 따라 점을 여러 개 찍으세요. 더블클릭 또는 Enter로 완료, ESC로 취소.";
    } else if (toolName === 'box-pattern') {
        inst = "지도를 드래그해 박스 영역을 지정하세요. 마우스를 놓으면 그 자리에 격자 패턴이 생성됩니다.";
    }
    dom.instructionText.textContent = inst;

    // Cancel drawing status
    state.isDrawing = false;
    state.tempRowLine = null;
    draw2D();
}

export function updateParamsFromInputs() {
    state.params.targetSpacing = parseFloat(dom.inputTargetSpacing.value) || 3.2;
    state.params.targetBurden = parseFloat(dom.inputTargetBurden.value) || 2.5;
    state.params.benchHeight = parseFloat(dom.inputBenchHeight.value) || 10.0;
    state.params.subdrill = parseFloat(dom.inputSubdrill.value) || 1.0;
    state.params.holeDiameter = parseFloat(dom.inputHoleDiameter.value) || 76;
    state.params.holeAngle = parseFloat(dom.inputHoleAngle.value) || 90;
    state.params.stemmingHeight = parseFloat(dom.inputStemmingHeight.value) || 2.2;
    state.params.explosiveDensity = parseFloat(dom.inputExplosiveDensity.value) || 1.15;
    state.params.rockDensity = parseFloat(dom.inputRockDensity.value) || 2.65;
    state.params.bsRatio = parseFloat(dom.inputBsRatio.value) || 1.25;
}

export function createDemoDesign() {
    state.holes = [];
    state.freeFace = [];
    state.freeFacePatterns = [];
    state.tempFreeFace = [];
    state.rows = {};
    state.nextRowIndex = 1;

    // Create 2 rows of simple demo holes centered around (0, 0) in meters
    const rowName1 = "Row 1";
    state.rows[rowName1] = [];
    for (let i = 0; i < 5; i++) {
        const id = `H-1-${i+1}`;
        const x = (i - 2) * 4.0; // 4m spacing
        const y = -3.0;          // Row 1 is at y = -3m
        state.holes.push({ id, x, y, rowName: rowName1, spacing: 4.0, burden: 3.0, ...createHoleChargeDefaults() });
        state.rows[rowName1].push(id);
    }

    const rowName2 = "Row 2";
    state.rows[rowName2] = [];
    for (let i = 0; i < 5; i++) {
        const id = `H-2-${i+1}`;
        const x = (i - 2) * 4.0 + 2.0; // staggered spacing
        const y = 0.0;                 // Row 2 is at y = 0m (Burden 3.0m)
        state.holes.push({ id, x, y, rowName: rowName2, spacing: 4.0, burden: 3.0, ...createHoleChargeDefaults() });
        state.rows[rowName2].push(id);
    }
    state.nextRowIndex = 3;

    // Draw a cliff/freeface line at y = -6m
    state.freeFace = [
        { x: -10, y: -6.0 },
        { x: 0, y: -6.0 },
        { x: 10, y: -6.0 }
    ];
}

export function handleMouseDown(e) {
    const mousePos = { x: e.clientX, y: e.clientY };
    const rect = dom.canvas.getBoundingClientRect();
    const sX = mousePos.x - rect.left;
    const sY = mousePos.y - rect.top;
    
    // Delete-hole tool: click on the hovered hole to delete it
    if (state.selectedTool === 'delete-hole' && e.button === 0 && state.hoveredHoleId) {
        deleteHole(state.hoveredHoleId);
        return;
    }

    // Move-hole tool: click and hold on the hovered hole to start dragging it
    if (state.selectedTool === 'move-hole' && e.button === 0 && state.hoveredHoleId) {
        history.save();
        state.draggingHoleId = state.hoveredHoleId;
        return;
    }

    // Check if left click on a hole in pan mode to select it and open the edit panel (or multi-select with Shift/Ctrl)
    if (state.selectedTool === 'pan' && e.button === 0 && state.hoveredHoleId) {
        if (e.shiftKey || e.ctrlKey) {
            const idx = state.selectedHoleIds.indexOf(state.hoveredHoleId);
            if (idx === -1) {
                state.selectedHoleIds.push(state.hoveredHoleId);
            } else {
                state.selectedHoleIds.splice(idx, 1);
            }
            renderHoleEditPanel();
            draw2D();
            return;
        }
        state.selectedHoleIds = [state.hoveredHoleId];
        renderHoleEditPanel();
        draw2D();
        return;
    }

    // Handle custom right-click map panning in any tool mode
    if (e.button === 2 && state.map && !state.canvasMode) {
        state.isRightClickPanning = true;
        state.startMapPanPixel = [e.clientX, e.clientY];
        state.startMapCenter = state.map.getView().getCenter();
        dom.canvas.style.cursor = 'grabbing';
        e.preventDefault();
        return;
    }

    // Shift+드래그: 빈 캔버스 위에서 사각형을 그려 안에 포함된 공을 한번에 다중 선택
    if (state.selectedTool === 'pan' && !state.hoveredHoleId && e.shiftKey) {
        const worldPos = screenToWorld(sX, sY);
        state.isBoxSelecting = true;
        state.tempSelectionBox = { start: worldPos, current: worldPos };
        return;
    }

    // Let standard panning work in pan mode on empty canvas
    if (state.selectedTool === 'pan' && !state.hoveredHoleId) {
        state.isPanning = true;
        state.startX = sX - state.panX;
        state.startY = sY - state.panY;
        dom.canvas.style.cursor = 'grabbing';
        return;
    }

    const worldPos = screenToWorld(sX, sY);

    if (state.selectedTool === 'calibrate') {
        state.isDrawing = true;
        state.tempScaleLine = { start: worldPos, end: worldPos };
    } else if (state.selectedTool === 'box-pattern') {
        state.isDrawing = true;
        state.tempBoxPattern = { start: worldPos, current: worldPos };
    } else if (state.selectedTool === 'ab-line') {
        state.isDrawing = true;
        state.tempABLine = { start: worldPos, end: worldPos };
    } else if (state.selectedTool === 'ws-pattern') {
        const rowName = `WS Row ${state.nextRowIndex}`;
        if (!state.activeWSPattern) {
            // First click (Hole 1)
            history.save();
            const h1Id = `H-WS-${state.nextRowIndex}-1`;
            const newHole = {
                id: h1Id,
                x: worldPos.x,
                y: worldPos.y,
                rowName: rowName,
                spacing: 0,
                burden: 0,
                ...createHoleChargeDefaults()
            };
            state.holes.push(newHole);
            state.rows[rowName] = [h1Id];
            state.activeWSPattern = {
                h1Id: h1Id,
                h1Pos: worldPos,
                currentPos: worldPos
            };
            draw2D();
        } else {
            // Second click (Hole 2)
            const active = state.activeWSPattern;
            const h1Id = active.h1Id;
            const h2Id = `H-WS-${state.nextRowIndex}-2`;
            const h3Id = `H-WS-${state.nextRowIndex}-3`;
            const h4Id = `H-WS-${state.nextRowIndex}-4`;
            
            const h2Pos = worldPos;
            const dx = h2Pos.x - active.h1Pos.x;
            const dy = h2Pos.y - active.h1Pos.y;
            const wLen = Math.sqrt(dx*dx + dy*dy);
            
            if (wLen > 0) {
                const px = -dy / wLen;
                const py = dx / wLen;
                const sDistPx = wLen * state.params.bsRatio;
                
                const h3Pos = { x: active.h1Pos.x + px * sDistPx, y: active.h1Pos.y + py * sDistPx };
                const h4Pos = { x: h2Pos.x + px * sDistPx, y: h2Pos.y + py * sDistPx };
                
                const h2 = { id: h2Id, x: h2Pos.x, y: h2Pos.y, rowName: rowName, spacing: 0, burden: 0, ...createHoleChargeDefaults() };
                const h3 = { id: h3Id, x: h3Pos.x, y: h3Pos.y, rowName: rowName, spacing: 0, burden: 0, ...createHoleChargeDefaults() };
                const h4 = { id: h4Id, x: h4Pos.x, y: h4Pos.y, rowName: rowName, spacing: 0, burden: 0, ...createHoleChargeDefaults() };
                
                state.holes.push(h2, h3, h4);
                state.rows[rowName].push(h2Id, h3Id, h4Id);
                
                state.autoPatterns.push({
                    id: `P-${Date.now()}`,
                    h1Id: h1Id,
                    h2Id: h2Id,
                    h3Id: h3Id,
                    h4Id: h4Id
                });
                
                state.nextRowIndex++;
                state.activeWSPattern = null;
                
                recalculateBurdenSpacing();
                updateDashboard();
                selectTool('pan');
                draw2D();
                if (state.three.active) update3DView();
                
                const distM = wLen * state.scaleFactor;
                const sM = distM * state.params.bsRatio;
                showToast(`W-S 자동 패턴 생성 완료 (저항선 W: ${distM.toFixed(1)}m, 공간격 S: ${sM.toFixed(1)}m)`, 'check-circle');
            }
        }
    } else if (state.selectedTool === 'add-hole') {
        // Place a manual hole in sequence
        history.save();
        const rowName = `Row ${state.nextRowIndex}`;
        const newHoleId = `H-${state.nextRowIndex}-${(state.rows[rowName]?.length || 0) + 1}`;
        
        const newHole = {
            id: newHoleId,
            x: worldPos.x,
            y: worldPos.y,
            rowName: rowName,
            spacing: 0,
            burden: 0,
            ...createHoleChargeDefaults()
        };

        state.holes.push(newHole);
        if (!state.rows[rowName]) {
            state.rows[rowName] = [];
        }
        state.rows[rowName].push(newHoleId);
        
        // Activate preview tracker from this new hole
        state.tempHolePreview = {
            fromHoleId: newHoleId,
            currentPos: worldPos
        };
        
        recalculateBurdenSpacing();
        updateDashboard();
        draw2D();
        if (state.three.active) update3DView();
    } else if (state.selectedTool === 'auto-row') {
        state.isDrawing = true;
        state.tempRowLine = { start: worldPos, end: worldPos };
    } else if (state.selectedTool === 'draw-face') {
        // 패턴 설정 모달이 열려 있으면(이미 확정된 자유면) 지도 클릭을 무시 — 실수로 새 점이 찍히지 않도록 함
        if (dom.faceModal && !dom.faceModal.classList.contains('hidden')) {
            return;
        }
        // Multi-click polyline: each click adds one vertex, does not start a drag gesture
        state.tempFreeFace.push(worldPos);
        draw2D();
    }
}

export function handleMouseMove(e) {
    const rect = dom.canvas.getBoundingClientRect();
    const sX = e.clientX - rect.left;
    const sY = e.clientY - rect.top;

    // Handle custom right-click map panning
    if (state.isRightClickPanning && state.map && state.startMapCenter) {
        const dx = e.clientX - state.startMapPanPixel[0];
        const dy = e.clientY - state.startMapPanPixel[1];
        const resolution = state.map.getView().getResolution();
        
        const deltaX = -dx * resolution;
        const deltaY = dy * resolution;
        
        state.map.getView().setCenter([
            state.startMapCenter[0] + deltaX,
            state.startMapCenter[1] + deltaY
        ]);
        
        draw2D();
        return;
    }

    if (state.isBoxSelecting) {
        state.tempSelectionBox.current = screenToWorld(sX, sY);
        draw2D();
        return;
    }

    if (state.isPanning) {
        state.panX = sX - state.startX;
        state.panY = sY - state.startY;
        draw2D();
        return;
    }

    const worldPos = screenToWorld(sX, sY);

    // Update real-time GPS coordinate display
    if (dom.gpsIndicator) {
        let lat, lon;
        if (state.map) {
            const lonLat = ol.proj.toLonLat([worldPos.x, worldPos.y], state.map.getView().getProjection());
            lon = lonLat[0];
            lat = lonLat[1];
            dom.gpsIndicator.textContent = `GPS (지도): 위도 ${lat.toFixed(6)}°N, 경도 ${lon.toFixed(6)}°E`;
        } else {
            const latAnchor = state.terrainOffset.y;
            const lonAnchor = state.terrainOffset.x;
            const latOffsetDeg = (worldPos.y * state.scaleFactor) / 111111;
            const lonOffsetDeg = (worldPos.x * state.scaleFactor) / (111111 * Math.cos(latAnchor * Math.PI / 180));
            lat = latAnchor + latOffsetDeg;
            lon = lonAnchor + lonOffsetDeg;
            dom.gpsIndicator.textContent = `GPS (보정): 위도 ${lat.toFixed(6)}°N, 경도 ${lon.toFixed(6)}°E`;
        }
    }

    // Active W-S pattern dragging preview
    if (state.selectedTool === 'ws-pattern' && state.activeWSPattern) {
        state.activeWSPattern.currentPos = worldPos;
        draw2D();
        return;
    }

    // Add-hole tool: highlight the nearest existing hole for visual feedback
    if (state.selectedTool === 'add-hole') {
        let nearestExistingHole = null;
        let minScreenDist = 15;
        state.holes.forEach(h => {
            const screenHole = worldToScreen(h.x, h.y);
            const dist = Math.sqrt((sX - screenHole.x) ** 2 + (sY - screenHole.y) ** 2);
            if (dist < minScreenDist) {
                minScreenDist = dist;
                nearestExistingHole = h;
            }
        });
        const newHoveredId = nearestExistingHole ? nearestExistingHole.id : null;
        if (state.hoveredHoleId !== newHoveredId) {
            state.hoveredHoleId = newHoveredId;
            draw2D();
        }
    }

    // Active manual hole preview tracking
    if (state.selectedTool === 'add-hole' && state.tempHolePreview) {
        state.tempHolePreview.currentPos = worldPos;
        draw2D();
        return;
    }

    // Active A-B Line dragging preview
    if (state.selectedTool === 'ab-line' && state.tempABLine && state.isDrawing) {
        state.tempABLine.end = worldPos;
        draw2D();
        return;
    }

    // Active box-pattern dragging preview
    if (state.selectedTool === 'box-pattern' && state.tempBoxPattern && state.isDrawing) {
        state.tempBoxPattern.current = worldPos;
        draw2D();
        return;
    }

    // Free-face polyline rubber-band preview (last clicked point -> current cursor)
    if (state.selectedTool === 'draw-face' && state.tempFreeFace.length > 0) {
        state.tempFreeFaceCursor = worldPos;
        draw2D();
        return;
    }

    // Active measurement dragging logic
    if (state.activeMeasurement) {
        state.activeMeasurement.currentPos = worldPos;
        
        // Find if snapping to another hole
        let nearestTarget = null;
        let minTargetDist = 20; // 20 pixels threshold to snap
        
        state.holes.forEach(h => {
            if (h.id === state.activeMeasurement.fromHoleId) return;
            const screenHole = worldToScreen(h.x, h.y);
            const dist = Math.sqrt((sX - screenHole.x)**2 + (sY - screenHole.y)**2);
            if (dist < minTargetDist) {
                minTargetDist = dist;
                nearestTarget = h;
            }
        });
        
        if (nearestTarget) {
            state.activeMeasurement.toHoleId = nearestTarget.id;
            state.activeMeasurement.currentPos = { x: nearestTarget.x, y: nearestTarget.y };
        } else {
            state.activeMeasurement.toHoleId = null;
        }
        
        draw2D();
        return;
    }

    // Hover detection on holes in pan mode
    if (state.selectedTool === 'pan') {
        let nearestHole = null;
        let minScreenDist = 15; // 15 pixels threshold

        state.holes.forEach(h => {
            const screenHole = worldToScreen(h.x, h.y);
            const dist = Math.sqrt((sX - screenHole.x)**2 + (sY - screenHole.y)**2);
            if (dist < minScreenDist) {
                minScreenDist = dist;
                nearestHole = h;
            }
        });

        if (nearestHole) {
            if (state.hoveredHoleId !== nearestHole.id) {
                state.hoveredHoleId = nearestHole.id;
                dom.canvas.style.cursor = 'pointer';
                draw2D();
            }
        } else {
            if (state.hoveredHoleId !== null) {
                state.hoveredHoleId = null;
                dom.canvas.style.cursor = 'grab';
                draw2D();
            }
        }
    }

    // Delete-hole tool: hover to target, click to delete
    if (state.selectedTool === 'delete-hole') {
        let nearestHole = null;
        let minScreenDist = 15; // 15 pixels threshold

        state.holes.forEach(h => {
            const screenHole = worldToScreen(h.x, h.y);
            const dist = Math.sqrt((sX - screenHole.x)**2 + (sY - screenHole.y)**2);
            if (dist < minScreenDist) {
                minScreenDist = dist;
                nearestHole = h;
            }
        });

        const newHoveredId = nearestHole ? nearestHole.id : null;
        if (state.hoveredHoleId !== newHoveredId) {
            state.hoveredHoleId = newHoveredId;
            draw2D();
        }
        dom.canvas.style.cursor = nearestHole ? 'not-allowed' : 'crosshair';
    }

    // Move-hole tool: drag the picked-up hole with the cursor, or hover to target one
    if (state.selectedTool === 'move-hole') {
        if (state.draggingHoleId) {
            const draggedHole = state.holes.find(h => h.id === state.draggingHoleId);
            if (draggedHole) {
                draggedHole.x = worldPos.x;
                draggedHole.y = worldPos.y;
                recalculateBurdenSpacing();
                draw2D();
            }
            dom.canvas.style.cursor = 'grabbing';
        } else {
            let nearestHole = null;
            let minScreenDist = 15;
            state.holes.forEach(h => {
                const screenHole = worldToScreen(h.x, h.y);
                const dist = Math.sqrt((sX - screenHole.x) ** 2 + (sY - screenHole.y) ** 2);
                if (dist < minScreenDist) {
                    minScreenDist = dist;
                    nearestHole = h;
                }
            });
            const newHoveredId = nearestHole ? nearestHole.id : null;
            if (state.hoveredHoleId !== newHoveredId) {
                state.hoveredHoleId = newHoveredId;
                draw2D();
            }
            dom.canvas.style.cursor = nearestHole ? 'grab' : 'crosshair';
        }
    }

    if (!state.isDrawing) return;

    if (state.selectedTool === 'calibrate' && state.tempScaleLine) {
        state.tempScaleLine.end = worldPos;
        draw2D();
    } else if (state.selectedTool === 'ab-line' && state.tempABLine) {
        state.tempABLine.end = worldPos;
        draw2D();
    }
}

export function handleMouseUp(e) {
    // Shift+드래그 박스 선택 확정: 사각형 안에 있는 공들을 기존 선택에 합쳐서 선택
    if (state.isBoxSelecting) {
        const box = state.tempSelectionBox;
        state.isBoxSelecting = false;
        state.tempSelectionBox = null;
        if (box) {
            const minX = Math.min(box.start.x, box.current.x);
            const maxX = Math.max(box.start.x, box.current.x);
            const minY = Math.min(box.start.y, box.current.y);
            const maxY = Math.max(box.start.y, box.current.y);
            const idsInBox = state.holes
                .filter(h => h.x >= minX && h.x <= maxX && h.y >= minY && h.y <= maxY)
                .map(h => h.id);
            state.selectedHoleIds = [...new Set([...state.selectedHoleIds, ...idsInBox])];
            renderHoleEditPanel();
        }
        draw2D();
        return;
    }

    // Reset custom right-click map panning
    if (state.isRightClickPanning) {
        state.isRightClickPanning = false;
        state.startMapPanPixel = null;
        state.startMapCenter = null;
        dom.canvas.style.cursor = 'default';
        return;
    }

    if (state.isPanning) {
        state.isPanning = false;
        dom.canvas.style.cursor = state.hoveredHoleId ? 'pointer' : 'grab';
        return;
    }

    if (state.draggingHoleId) {
        state.draggingHoleId = null;
        updateDashboard();
        renderLoadingSheetTable();
        if (state.three.active) update3DView();
        draw2D();
        return;
    }

    if (state.activeMeasurement) {
        const active = state.activeMeasurement;
        if (active.toHoleId) {
            // Check if this measurement already exists (either from-to or to-from)
            const exists = state.customMeasurements.some(m => 
                (m.fromHoleId === active.fromHoleId && m.toHoleId === active.toHoleId) ||
                (m.fromHoleId === active.toHoleId && m.toHoleId === active.fromHoleId)
            );
            
            if (!exists) {
                history.save(); // Save history before adding custom measurement line
                state.customMeasurements.push({
                    fromHoleId: active.fromHoleId,
                    toHoleId: active.toHoleId
                });
                
                // Calculate distance to display in toast
                const fromH = state.holes.find(h => h.id === active.fromHoleId);
                const toH = state.holes.find(h => h.id === active.toHoleId);
                const distM = getGeodesicDistance(fromH, toH);
                showToast(`측정선 연결 완료: ${fromH.id.split('-').pop()}번 ↔ ${toH.id.split('-').pop()}번 (${distM.toFixed(1)}m)`, 'ruler');
            }
        }
        state.activeMeasurement = null;
        draw2D();
        return;
    }

    if (!state.isDrawing) return;
    state.isDrawing = false;
    
    const rect = dom.canvas.getBoundingClientRect();
    const sX = e.clientX - rect.left;
    const sY = e.clientY - rect.top;
    const worldPos = screenToWorld(sX, sY);

    if (state.selectedTool === 'calibrate' && state.tempScaleLine) {
        state.tempScaleLine.end = worldPos;
        // Open scale dialog
        const dx = state.tempScaleLine.end.x - state.tempScaleLine.start.x;
        const dy = state.tempScaleLine.end.y - state.tempScaleLine.start.y;
        const pxDistance = Math.sqrt(dx*dx + dy*dy).toFixed(1);
        dom.scaleModal.classList.remove('hidden');
        dom.inputScaleDistance.focus();
    } else if (state.selectedTool === 'ab-line' && state.tempABLine) {
        state.tempABLine.end = worldPos;
        
        const lenM = getGeodesicDistance(state.tempABLine.start, state.tempABLine.end);
        
        if (lenM < 1.0) {
            state.tempABLine = null;
            draw2D();
            return;
        }
        
        // Open A-B Line Setup modal
        dom.abModal.classList.remove('hidden');
        dom.abInputBurden.focus();
        
        // Set default Spacing as 1.25 * Burden
        const burden = parseFloat(dom.abInputBurden.value) || 2.5;
        dom.abInputSpacing.value = (burden * 1.25).toFixed(3);

        updateABModalStats();
    } else if (state.selectedTool === 'box-pattern' && state.tempBoxPattern) {
        const start = state.tempBoxPattern.start;
        state.tempBoxPattern = null;
        const toReal = (state.map && !state.canvasMode) ? getMapCosLat(start) : state.scaleFactor;
        const wProj = Math.abs(worldPos.x - start.x) * toReal;
        const lProj = Math.abs(worldPos.y - start.y) * toReal;
        if (wProj < 0.5 || lProj < 0.5) {
            draw2D();
            return;
        }
        history.save();
        generateBoxPattern(start, worldPos);
        selectTool('pan');
        draw2D();
    }
}

export function handleCanvasWheel(e) {
    e.preventDefault();
    const rect = dom.canvas.getBoundingClientRect();
    const sX = e.clientX - rect.left;
    const sY = e.clientY - rect.top;
    
    const zoomFactor = 1.08;
    const oldZoom = state.zoom;
    let newZoom = oldZoom;

    if (e.deltaY < 0) {
        newZoom = Math.min(oldZoom * zoomFactor, 10.0);
    } else {
        newZoom = Math.max(oldZoom / zoomFactor, 0.2);
    }
    
    const wx = (sX - state.panX) / oldZoom;
    const wy = (sY - state.panY) / oldZoom;
    
    state.zoom = newZoom;
    state.panX = sX - wx * newZoom;
    state.panY = sY - wy * newZoom;
    
    draw2D();
}

// Commits the in-progress tempFreeFace polyline to state.freeFace and opens the pattern modal.
// Shared by the Enter-key shortcut and the double-click finish gesture.
function finalizeFreeFaceDrawing() {
    // The double-click that triggers this fires an extra mousedown right before it,
    // which pushes a duplicate point at (nearly) the same spot as the true last click — drop it.
    if (state.tempFreeFace.length > 2) {
        const last = state.tempFreeFace[state.tempFreeFace.length - 1];
        const prev = state.tempFreeFace[state.tempFreeFace.length - 2];
        if (Math.abs(last.x - prev.x) < 1e-6 && Math.abs(last.y - prev.y) < 1e-6) {
            state.tempFreeFace.pop();
        }
    }

    if (state.tempFreeFace.length < 2) {
        state.tempFreeFace = [];
        state.tempFreeFaceCursor = null;
        return;
    }

    history.save();
    state.freeFace = state.tempFreeFace.slice();
    state.tempFreeFace = [];
    state.tempFreeFaceCursor = null;

    dom.faceModal.classList.remove('hidden');
    dom.faceInputBurden.focus();
    faceSpacingManuallyEdited = false;

    // Auto-fill burden from the last Langefors calculation result if available
    // (B = 실제 저항선: B_max에서 천공오차 E를 뺀, 현장에서 실제 적용할 값)
    if (window.lastLangeforsResult && typeof window.lastLangeforsResult.B === 'number') {
        dom.faceInputBurden.value = window.lastLangeforsResult.B.toFixed(3);
        if (dom.faceBurdenAutoNote) dom.faceBurdenAutoNote.style.display = 'block';
    } else {
        dom.faceInputBurden.value = state.params.targetBurden.toFixed(3);
        if (dom.faceBurdenAutoNote) dom.faceBurdenAutoNote.style.display = 'none';
    }
    dom.faceInputSpacing.value = (parseFloat(dom.faceInputBurden.value) * 1.25).toFixed(3);

    updateFreeFaceModalStats();
    draw2D();
}

export function handleDoubleClick(e) {
    if (state.selectedTool === 'draw-face') {
        e.preventDefault();
        finalizeFreeFaceDrawing();
        return;
    }
    if (state.selectedTool === 'add-hole') {
        e.preventDefault();
        
        // Revert the second click of the double-click using undo
        history.undo();
        
        // Clear redo stack so the reverted extra hole cannot be redone
        history.redoStack = [];
        history.updateButtons();
        
        // Increment row index for the next manual row sequence
        state.nextRowIndex++;
        
        // Stop adding holes (switch to pan tool)
        selectTool('pan');
        
        // Show indicator toast message
        showToast(`수동 천공 배치 완료 (Row ${state.nextRowIndex - 1} 종료). 다음 배치는 Row ${state.nextRowIndex}로 시작합니다.`, 'check-circle');
    }
}

export function showToast(message, iconName = 'info') {
    const toast = document.getElementById('toast-container');
    const toastMsg = document.getElementById('toast-message');
    if (!toast || !toastMsg) return;
    
    toastMsg.textContent = message;
    
    // Update icon if needed
    const iconEl = toast.querySelector('.toast-icon');
    if (iconEl) {
        iconEl.outerHTML = `<i data-lucide="${iconName}" class="toast-icon"></i>`;
    }
    lucide.createIcons();
    
    toast.classList.add('show');
    
    // Clear previous timeout if any
    if (window.toastTimeout) clearTimeout(window.toastTimeout);
    
    window.toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}

export function updateDashboard() {
    renderBlastSimPanel();
    const numHoles = state.holes.length;
    dom.valTotalHoles.textContent = numHoles;
    
    if (numHoles === 0) {
        dom.valAvgSpacing.textContent = "0.00";
        dom.valAvgBurden.textContent = "0.00";
        dom.valTotalDrillLength.textContent = "0.0";
        dom.valTotalVolume.textContent = "0.0";
        dom.valTotalTonnage.textContent = "0.0";
        dom.valExplosivePerHole.textContent = "0.0";
        dom.valTotalExplosive.textContent = "0.0";
        dom.valPowderFactor.textContent = "0.00";
        dom.valPfStatus.textContent = "발파공을 배치하세요";
        dom.valPfStatus.style.color = 'var(--text-muted)';
        
        // Materials reset
        dom.matBulkExplosive.textContent = "0.0 kg";
        dom.matBooster.textContent = "0 EA";
        dom.matDetonator.textContent = "0 EA";
        dom.matTrunkline.textContent = "0.0 m";

        // Vibration card reset
        document.getElementById('val-wmax').textContent = "0.0";
        document.getElementById('val-wmax-delay').textContent = "—";
        document.getElementById('vibration-table-tbody').innerHTML = '<tr><td colspan="3" class="empty-row">발파공을 배치하세요</td></tr>';
        return;
    }

    // 1. Spacing and Burden Averages
    let totalSpacing = 0;
    let totalBurden = 0;
    state.holes.forEach(h => {
        totalSpacing += h.spacing;
        totalBurden += h.burden;
    });
    const avgSpacing = totalSpacing / numHoles;
    const avgBurden = totalBurden / numHoles;
    
    dom.valAvgSpacing.textContent = avgSpacing.toFixed(2);
    dom.valAvgBurden.textContent = avgBurden.toFixed(2);

    // 2. Drill length — 공별 실제 천공깊이(depth_H) 합산
    const totalDrillLength = state.holes.reduce((sum, h) => sum + h.depth_H, 0);
    dom.valTotalDrillLength.textContent = totalDrillLength.toFixed(1);

    // 3. Blast volume and tonnage
    // Individual hole volume = spacing * burden * benchHeight
    let totalVolume = 0;
    state.holes.forEach(h => {
        const v = h.spacing * h.burden * state.params.benchHeight;
        totalVolume += v;
    });
    
    // Tonnage = Volume * Rock Density
    const totalTonnage = totalVolume * state.params.rockDensity;
    
    dom.valTotalVolume.textContent = totalVolume.toFixed(1);
    dom.valTotalTonnage.textContent = totalTonnage.toFixed(1);

    // 4. Explosives mass calculations — 공별 ANFO+기폭약 장약량(calculateHoleCharge) 합산
    const totalExplosiveMass = state.holes.reduce((sum, h) => sum + calculateHoleCharge(h).totalWeight, 0);
    const explosiveMassPerHole = totalExplosiveMass / numHoles;

    dom.valExplosivePerHole.textContent = explosiveMassPerHole.toFixed(1);
    dom.valTotalExplosive.textContent = totalExplosiveMass.toFixed(1);

    // 5. Powder Factor (비장약량) = Explosives / Volume
    const pf = totalVolume > 0 ? (totalExplosiveMass / totalVolume) : 0;
    dom.valPowderFactor.textContent = pf.toFixed(2);
    
    // Powder Factor Status Evaluation
    let pfStatus = "";
    let pfColor = "";
    if (pf < 0.15) {
        pfStatus = "장약 부족 (소파쇄 불량 우려)";
        pfColor = "var(--accent-red)";
    } else if (pf >= 0.15 && pf < 0.25) {
        pfStatus = "약장약 (연암/보통암 적정)";
        pfColor = "#fbbf24";
    } else if (pf >= 0.25 && pf <= 0.45) {
        pfStatus = "적정 장약량 (보통암/경암 표준)";
        pfColor = "var(--accent-green)";
    } else if (pf > 0.45 && pf <= 0.65) {
        pfStatus = "과장약 (비산 및 안전 유의)";
        pfColor = "var(--accent-orange)";
    } else {
        pfStatus = "초과 장약량 (대폭 위험성 증가)";
        pfColor = "var(--accent-red)";
    }
    dom.valPfStatus.textContent = pfStatus;
    dom.valPfStatus.style.color = pfColor;

    // 6. Detonators and accessories checklist
    dom.matBulkExplosive.textContent = `${totalExplosiveMass.toFixed(1)} kg`;
    dom.matBooster.textContent = `${numHoles} EA`; // 1 booster per hole
    dom.matDetonator.textContent = `${numHoles} EA`; // 1 detonator per hole
    
    // Trunkline estimate: sum of spacings + some buffer
    const trunklineLength = (totalSpacing + (numHoles * 2)) * 1.1; // 10% buffer
    dom.matTrunkline.textContent = `${trunklineLength.toFixed(1)} m`;

    // 7. Update Hidden Print fields
    document.getElementById('print-p-burden').textContent = `${state.params.targetBurden.toFixed(1)} m`;
    document.getElementById('print-p-spacing').textContent = `${state.params.targetSpacing.toFixed(1)} m`;
    document.getElementById('print-p-bench').textContent = `${state.params.benchHeight.toFixed(1)} m`;
    document.getElementById('print-p-subdrill').textContent = `${state.params.subdrill.toFixed(1)} m`;
    document.getElementById('print-p-diameter').textContent = `${state.params.holeDiameter} mm`;
    document.getElementById('print-p-stemming').textContent = `${state.params.stemmingHeight.toFixed(1)} m`;

    document.getElementById('print-m-holes').textContent = `${numHoles} 공`;
    document.getElementById('print-m-burden').textContent = `${avgBurden.toFixed(2)} m`;
    document.getElementById('print-m-spacing').textContent = `${avgSpacing.toFixed(2)} m`;
    document.getElementById('print-m-drill-length').textContent = `${totalDrillLength.toFixed(1)} m`;
    document.getElementById('print-m-volume').textContent = `${totalVolume.toFixed(1)} m³`;
    document.getElementById('print-m-tonnage').textContent = `${totalTonnage.toFixed(1)} ton`;
    document.getElementById('print-m-explosive').textContent = `${totalExplosiveMass.toFixed(1)} kg`;
    document.getElementById('print-m-pf').textContent = `${pf.toFixed(2)} kg/m³`;

    // 8. 지발당 진동(PPV) 예측 카드
    const vibTable = buildVibrationTable(state.holes, undefined, state.vibrationConstants.K, state.vibrationConstants.n);
    document.getElementById('val-wmax').textContent = vibTable.wMax.toFixed(1);
    document.getElementById('val-wmax-delay').textContent = vibTable.wMaxDelayIndex || '—';
    document.getElementById('vibration-table-tbody').innerHTML = vibTable.rows.map(row => `
        <tr>
            <td>${row.D}</td>
            <td>${row.V.toFixed(3)}</td>
            <td style="color: ${row.safe ? 'var(--accent-green)' : 'var(--accent-red)'};">${row.safe ? '안전' : '주의/기준 초과'}</td>
        </tr>
    `).join('');
    // 임의 거리 입력창에 이미 값이 있으면 최신 W_max 기준으로 재계산해 동기화
    document.getElementById('input-custom-distance').dispatchEvent(new Event('input'));

    // 분석 도구 오버레이가 열려 있으면 그 안의 상세 화면도 실시간으로 함께 갱신 (별도 새로고침 불필요)
    refreshActiveAnalysisOverlay();
}

// 왼쪽 사이드바 "발파 시뮬레이션" 아코디언 — (a) MS 그룹 요약 표, (b) 선택된 공의 뇌관 시차 편집,
// (d) 타임라인 슬라이더 범위를 최신 상태로 갱신한다. updateDashboard()(공 목록 변경 시)와
// renderHoleEditPanel()(선택 변경 시) 양쪽에서 호출되어 항상 최신 상태를 반영한다.
export function renderBlastSimPanel() {
    const tbody = document.getElementById('blast-sim-groups-tbody');
    if (!tbody) return; // 아코디언 마크업이 아직 조립되지 않은 시점의 초기 호출 방어

    const groups = getDelayGroups();

    // (a) MS 그룹 요약
    tbody.innerHTML = groups.length
        ? groups.map(g => `<tr><td>${g.delayIndex}</td><td>${g.holeIds.length}</td><td>${g.totalWeight.toFixed(1)} kg</td></tr>`).join('')
        : '<tr><td colspan="3" class="empty-row">발파공을 배치하세요</td></tr>';

    // (b) 선택된 공의 뇌관 시차 편집 — 0개/1개/다중 선택에 따라 안내 문구 ↔ 입력창 전환
    const ids = state.selectedHoleIds;
    const hint = document.getElementById('blast-sim-select-hint');
    const editor = document.getElementById('blast-sim-delay-editor');
    const label = document.getElementById('blast-sim-delay-label');
    const input = document.getElementById('input-blast-sim-delay');
    if (ids.length === 0) {
        hint.style.display = '';
        editor.style.display = 'none';
    } else {
        hint.style.display = 'none';
        editor.style.display = '';
        if (ids.length === 1) {
            const hole = state.holes.find(h => h.id === ids[0]);
            label.textContent = '뇌관 시차 (MS/ms)';
            input.value = hole ? hole.delayIndex : '';
            input.placeholder = 'MS1';
        } else {
            label.textContent = `뇌관 시차 일괄 (${ids.length}개 공)`;
            input.value = '';
            input.placeholder = '변경 안함';
        }
    }

    // (d) 타임라인 슬라이더 범위 — 재생 중이 아닐 때만 max를 갱신(재생 중 갱신 시 사용자 드래그와 충돌 방지)
    const timeline = document.getElementById('input-blast-sim-timeline');
    if (timeline && !isSimPlaying()) {
        timeline.max = Math.max(0, groups.length - 1);
        timeline.value = Math.max(0, Math.min(state.simStepIndex, groups.length - 1));
    }
    syncSimTimelineUI();
}

// (d) 재생 버튼 아이콘/타임라인 라벨만 가볍게 갱신 — setSimStep()이 매 스텝(재생 중 stepMs마다)마다
// 호출하므로, groups 재계산을 포함하는 renderBlastSimPanel() 전체보다 훨씬 가벼워야 한다.
export function syncSimTimelineUI() {
    const timeline = document.getElementById('input-blast-sim-timeline');
    const timelineLabel = document.getElementById('blast-sim-timeline-label');
    const playLabel = document.getElementById('blast-sim-play-label');
    if (!timeline || !timelineLabel || !playLabel) return;

    const groups = getDelayGroups();
    const idx = Math.max(0, Math.min(state.simStepIndex, groups.length - 1));
    if (document.activeElement !== timeline) timeline.value = idx;
    timelineLabel.textContent = groups.length && state.simStepIndex >= 0
        ? `${groups[idx].delayIndex} (${idx + 1} / ${groups.length})`
        : '—';
    playLabel.textContent = isSimPlaying() ? '일시정지' : '재생';
}

export function deleteHole(holeId) {
    history.save();
    state.holes = state.holes.filter(h => h.id !== holeId);
    Object.keys(state.rows).forEach(rowName => {
        state.rows[rowName] = state.rows[rowName].filter(id => id !== holeId);
        if (state.rows[rowName].length === 0) delete state.rows[rowName];
    });
    state.hoveredHoleId = null;
    state.selectedHoleIds = state.selectedHoleIds.filter(id => id !== holeId);
    recalculateBurdenSpacing();
    updateDashboard();
    renderLoadingSheetTable();
    renderHoleEditPanel();
    draw2D();
    if (state.three.active) update3DView();
}

export function clearHoles() {
    if (confirm("모든 발파공 및 설계를 초기화하시겠습니까?")) {
        history.save(); // Save history before clearing
        state.holes = [];
        state.rows = {};
        state.freeFace = [];
        state.freeFacePatterns = []; // Clear free-face patterns
        state.tempFreeFace = [];
        state.customMeasurements = []; // Clear custom measurements
        state.autoPatterns = []; // Clear auto patterns
        state.nextRowIndex = 1;
        state.selectedHoleId = null;
        state.selectedHoleIds = [];
        recalculateBurdenSpacing();
        updateDashboard();
        renderLoadingSheetTable();
        renderHoleEditPanel();
        draw2D();
        if (state.three.active) update3DView();
    }
}

export function newProject() {
    if (confirm("새 프로젝트를 만드시겠습니까? 저장되지 않은 설계 데이터는 분실됩니다.")) {
        state.holes = [];
        state.rows = {};
        state.freeFace = [];
        state.freeFacePatterns = []; // Clear free-face patterns
        state.tempFreeFace = [];
        state.customMeasurements = []; // Clear custom measurements
        state.autoPatterns = []; // Clear auto patterns
        state.nextRowIndex = 1;
        state.selectedHoleId = null;
        state.selectedHoleIds = [];
        state.bgImage = null;
        state.imageLoaded = false;
        state.isScaleCalibrated = false;
        state.scaleFactor = 0.01;
        
        if (state.map && state.geoTiffLayer) {
            state.map.removeLayer(state.geoTiffLayer);
        }
        state.geoTiffLayer = null;
        state.currentTif = null;
        if (state.map && !state.canvasMode) {
            initMap();
        }
        
        dom.scaleIndicator.textContent = "스케일 미설정 (기본: 1px = 0.01m)";
        dom.scaleIndicator.parentElement.style.borderLeftColor = 'var(--accent-purple)';
        
        selectTool('pan');
        recalculateBurdenSpacing();
        updateDashboard();
        renderLoadingSheetTable();
        renderHoleEditPanel();
        draw2D();

        // Reset history stacks
        history.undoStack = [];
        history.redoStack = [];
        history.updateButtons();
    }
}

// =====================================================
// Accordion Toggle Logic (사이드바 접기/펼치기)
// =====================================================
document.querySelectorAll('.accordion-header').forEach(header => {
    header.addEventListener('click', () => {
        const section = header.closest('.accordion-section');
        section.classList.toggle('open');
    });
});

// =====================================================
// Header Dropdown Toggle Logic (파일/클라우드 드롭다운)
// =====================================================
document.querySelectorAll('.header-dropdown-wrapper').forEach(wrapper => {
    const trigger = wrapper.querySelector('.btn');
    const menu = wrapper.querySelector('.header-dropdown-menu');
    
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close all other dropdowns first
        document.querySelectorAll('.header-dropdown-menu.show').forEach(m => {
            if (m !== menu) m.classList.remove('show');
        });
        menu.classList.toggle('show');
    });
    
    // Close dropdown when clicking an item inside it
    menu.querySelectorAll('.btn').forEach(btn => {
        btn.addEventListener('click', () => {
            menu.classList.remove('show');
        });
    });
});

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.header-dropdown-wrapper')) {
        document.querySelectorAll('.header-dropdown-menu.show').forEach(m => {
            m.classList.remove('show');
        });
    }
});

// =====================================================
// Upload Card Click → File Picker Trigger
// =====================================================
document.querySelectorAll('.upload-card').forEach(card => {
    card.addEventListener('click', (e) => {
        // Don't trigger file picker if clicking the file input itself
        if (e.target.tagName === 'INPUT') return;
        const fileInput = card.querySelector('input[type="file"]');
        if (fileInput) fileInput.click();
    });
});

// =====================================================
// Right Sidebar Tab Switching
// =====================================================
// 탭 헤더 직속 버튼만 — 벤치 단면도 탭 안의 [설계 기준 | 선택 공] 토글도 .tab-btn 스타일을 쓰므로 제외
document.querySelectorAll('.right-sidebar > .tab-header .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        // Remove active class from all buttons and panes
        document.querySelectorAll('.right-sidebar > .tab-header .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.right-sidebar .tab-pane').forEach(p => p.classList.remove('active'));
        
        // Add active class to clicked button
        btn.classList.add('active');
        
        // Find corresponding pane and activate it
        const targetId = btn.id.replace('tab-', 'tab-content-');
        const targetPane = document.getElementById(targetId);
        if (targetPane) {
            targetPane.classList.add('active');
        }
        
        // If tab is bench-profile, trigger a redraw just in case
        if (targetId === 'tab-content-bench-profile') {
            renderBenchProfileView();
        }
    });
});

// =====================================================
// Langefors Engine Integration
// =====================================================

const lfExplosiveType = document.getElementById('lf-explosive-type');
const lfLbRow = document.getElementById('lf-lb-row');
const lfLbInput = document.getElementById('lf-charge-concentration');
const lfColumnRatioRow = document.getElementById('lf-column-ratio-row');
const lfPrimerRow = document.getElementById('lf-primer-row');
const lfPrimerLengthRow = document.getElementById('lf-primer-length-row');

// Handle Explosive Type Dropdown
if (lfExplosiveType) {
    lfExplosiveType.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'ANFO') {
            lfLbInput.value = 3.60;
            lfLbRow.style.display = 'none';
            lfColumnRatioRow.style.display = 'none';
            lfPrimerRow.style.display = 'flex';
            lfPrimerLengthRow.style.display = 'flex';
        } else if (val === 'EMULSION') {
            lfLbInput.value = 5.00;
            lfLbRow.style.display = 'none';
            lfColumnRatioRow.style.display = 'flex';
            lfPrimerRow.style.display = 'none';
            lfPrimerLengthRow.style.display = 'none';
        } else {
            // CUSTOM
            lfLbRow.style.display = 'flex';
            lfColumnRatioRow.style.display = 'flex';
            lfPrimerRow.style.display = 'flex';
            lfPrimerLengthRow.style.display = 'flex';
        }
    });
}

// 직전에 발파공에 반영했거나(또는 반영 여부를 물어본) Langefors 결과의 스냅샷.
// 같은 값으로 포커스만 옮겨 다녀도 반영 확인창이 반복해서 뜨지 않도록 비교 기준으로 쓴다.
let lastSyncedDesign = null;

/** Langefors 입력값을 읽어 계산하고, 결과 카드/단면도/제원표를 갱신한다(발파공 반영은 하지 않음). */
function runLangeforsCalculation() {
    if (typeof calculateBlastDesign !== 'function') return null;

    const K = parseFloat(document.getElementById('lf-bench-height').value);
    const d = parseFloat(document.getElementById('lf-hole-diameter').value);
    const w = parseFloat(document.getElementById('lf-blast-width').value);
    const theta = parseFloat(document.getElementById('lf-hole-angle').value);
    const c = parseFloat(document.getElementById('lf-rock-constant').value);
    const explosiveType = lfExplosiveType.value;
    const lb = parseFloat(lfLbInput.value);
    const columnChargeRatio = parseFloat(document.getElementById('lf-column-ratio').value);
    const primerWeight = parseFloat(document.getElementById('lf-primer-weight').value);
    const primerLength = parseFloat(document.getElementById('lf-primer-length').value);

    if ([K, d, w, theta, c, lb, columnChargeRatio, primerWeight, primerLength].some(v => isNaN(v))) return null;

    let chargeMode = 'dual';
    if (explosiveType === 'ANFO' || (explosiveType === 'CUSTOM' && lfColumnRatioRow.style.display === 'none')) {
        chargeMode = 'single';
    }

    const inputData = { K, d, lb, w, theta, c, chargeMode, columnChargeRatio, primerWeight, primerLength };

    const result = calculateBlastDesign(inputData);
    window.lastLangeforsResult = result;
    window.lastLangeforsInput = inputData;

    // Update Result Dashboard
    document.getElementById('lf-results-card').style.display = 'block';
    document.getElementById('lf-val-bmax').textContent = result.B_max.toFixed(2);
    document.getElementById('lf-val-b').textContent = result.B.toFixed(2);
    document.getElementById('lf-val-h').textContent = result.H.toFixed(2);
    document.getElementById('lf-val-s').textContent = result.S.toFixed(2);
    document.getElementById('lf-val-qtot').textContent = result.Q_tot.toFixed(2);
    document.getElementById('lf-val-q').textContent = result.q.toFixed(2);

    const bMetricEl = document.getElementById('lf-val-b-metric');
    if (bMetricEl) bMetricEl.textContent = result.b ? result.b.toFixed(3) : "—";

    // Render Warnings
    const warningsContainer = document.getElementById('lf-warnings');
    warningsContainer.innerHTML = '';
    if (result.warnings && result.warnings.length > 0) {
        result.warnings.forEach(w2 => {
            const el = document.createElement('div');
            el.style.color = 'var(--text-error)';
            el.style.fontSize = '12px';
            el.style.marginTop = '4px';
            el.textContent = w2;
            warningsContainer.appendChild(el);
        });
    }

    // Draw 2D Profile + Spec Table (이미 실시간 갱신되는 항목이라는 안내 문구가 있으므로 항상 최신 유지)
    renderBenchProfileView(); // 선택 공 보기 중이면 그 공 + 갱신된 설계 외곽선으로 다시 그림
    generateAndRenderSpecTable(inputData);

    return { result, inputData };
}

/**
 * Langefors 결과를 state.params(및 좌측 사이드바 표시값)에 반영하고, 필요하면 기존 발파공에도
 * 반영할지 확인창으로 물어본다. isModified(직접 수정) 공이 있으면 덮어쓸지 한 번 더 물어본다.
 */
function syncLangeforsToParamsAndHoles(result, inputData) {
    // 1. state.params 갱신 + 사이드바 미러링 (항상 실시간 반영)
    state.params.benchHeight = inputData.K;
    state.params.subdrill = result.U;
    state.params.holeDiameter = inputData.d;
    state.params.holeAngle = inputData.theta;
    state.params.targetBurden = result.B;
    state.params.targetSpacing = result.S;
    state.params.stemmingHeight = result.h_o;
    state.params.chargeConcentration = result.lb;
    state.params.chargeMode = inputData.chargeMode;
    state.params.columnChargeRatio = inputData.columnChargeRatio;
    state.params.designBMax = result.B_max;

    if (dom.inputBenchHeight) dom.inputBenchHeight.value = state.params.benchHeight;
    if (dom.inputSubdrill) dom.inputSubdrill.value = state.params.subdrill;
    if (dom.inputHoleDiameter) dom.inputHoleDiameter.value = state.params.holeDiameter;
    if (dom.inputHoleAngle) dom.inputHoleAngle.value = state.params.holeAngle;
    if (dom.inputTargetBurden) dom.inputTargetBurden.value = state.params.targetBurden;
    if (dom.inputTargetSpacing) dom.inputTargetSpacing.value = state.params.targetSpacing;
    if (dom.inputStemmingHeight) dom.inputStemmingHeight.value = state.params.stemmingHeight;

    recalculateAutoPatterns();
    updateDashboard();
    draw2D();
    if (state.three.active) update3DView();

    // 2. 실질적인 변화가 없으면 재질문하지 않음
    const snapshot = { H: result.H, h_o: result.h_o, lb: result.lb, B: result.B, S: result.S };
    const unchanged = lastSyncedDesign
        && lastSyncedDesign.H === snapshot.H
        && lastSyncedDesign.h_o === snapshot.h_o
        && lastSyncedDesign.lb === snapshot.lb
        && lastSyncedDesign.B === snapshot.B
        && lastSyncedDesign.S === snapshot.S;
    lastSyncedDesign = snapshot;
    if (unchanged) return;

    // 2-1. 저항선/공간격은 이미 생성된 A-B라인/자유면 패턴에 곧바로 반영한다(별도 확인 없이).
    // 단, 패턴 설정 칸에서 직접 수정한(자동 설계값과 다른) 저항선/공간격으로 생성된 패턴이 있으면
    // 덮어쓸지 한 번 확인한다 — syncPatternsToDesignBurdenSpacing() 내부에서 처리.
    if (state.abPatterns.length > 0 || state.freeFacePatterns.length > 0) {
        history.save();
        const patternSync = syncPatternsToDesignBurdenSpacing(result.B, result.S);
        if (patternSync.updated > 0) {
            renderLoadingSheetTable();
            renderHoleEditPanel();
            showToast(`저항선/공간격 설계 변경사항을 발파공 ${patternSync.updated}개 패턴에 반영했습니다.`, 'check-circle');
        }
    }

    // 3. 기존 발파공이 없으면 물어볼 대상이 없음
    if (state.holes.length === 0) return;

    if (!confirm(`Langefors 설계가 수정되었습니다 (전색 ${result.h_o}m / 천공장 ${result.H}m). 기존 발파공에도 반영하시겠습니까?`)) {
        return;
    }

    const modifiedHoles = state.holes.filter(h => h.isModified);
    let overwriteModified = true;
    if (modifiedHoles.length > 0) {
        overwriteModified = confirm(`직접 수정한 값이 있는 공이 ${modifiedHoles.length}개 있습니다. 이 값도 덮어쓰시겠습니까? (취소 시 직접 수정한 공은 그대로 유지됩니다)`);
    }

    history.save();
    state.holes.forEach(h => {
        if (h.isModified && !overwriteModified) return;
        h.depth_H = result.H;
        h.stemming_h0 = result.h_o;
        h.anfoDensity = result.lb;
        h.chargeMode = inputData.chargeMode;
        if (inputData.chargeMode === 'single') {
            h.primerWeight = inputData.primerWeight;
            h.primerLength = inputData.primerLength;
        } else {
            h.columnChargeRatio = inputData.columnChargeRatio;
            h.designBMax = result.B_max;
        }
        h.isModified = false;
    });

    recalculateBurdenSpacing();
    updateDashboard();
    renderLoadingSheetTable();
    renderHoleEditPanel();
    draw2D();
    if (state.three.active) update3DView();

    showToast("Langefors 설계 변경사항을 발파공에 반영했습니다.", "check-circle");
}

const lfInputElements = [
    document.getElementById('lf-bench-height'),
    document.getElementById('lf-hole-diameter'),
    document.getElementById('lf-blast-width'),
    document.getElementById('lf-rock-constant'),
    document.getElementById('lf-hole-angle'),
    lfExplosiveType,
    lfLbInput,
    document.getElementById('lf-column-ratio'),
    document.getElementById('lf-primer-weight'),
    document.getElementById('lf-primer-length')
].filter(Boolean);

lfInputElements.forEach(el => {
    // 타이핑 중(input): 미리보기(결과 카드/단면도/제원표)만 실시간 갱신 — 확인창 없음
    el.addEventListener('input', () => {
        runLangeforsCalculation();
    });
    // 입력칸을 벗어날 때(change): 값이 실제로 바뀌었으면 state.params/발파공 반영 여부를 확인
    el.addEventListener('change', () => {
        const calc = runLangeforsCalculation();
        if (calc) syncLangeforsToParamsAndHoles(calc.result, calc.inputData);
    });
});

const btnRunLangefors = document.getElementById('btn-run-langefors');
if (btnRunLangefors && typeof calculateBlastDesign === 'function') {
    btnRunLangefors.addEventListener('click', () => {
        const calc = runLangeforsCalculation();
        if (!calc) return;
        const { result, inputData } = calc;

        if (result.warnings && result.warnings.length > 0) {
            showToast("Langefors 설계 연산 완료. 경고 메시지를 확인하세요.", "alert-triangle");
        } else {
            showToast("Langefors 자동 설계가 성공적으로 완료되었습니다.", "check-circle");
        }

        // Switch to Bench Profile Tab
        document.getElementById('tab-bench-profile').click();

        syncLangeforsToParamsAndHoles(result, inputData);
    });
}
