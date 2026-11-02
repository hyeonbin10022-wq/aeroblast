// 작업공간 조립: 뷰토글 버튼(정적) + canvas2d/canvas3d 2개 + editTools(편집 도구) 플로팅바를 순서대로 합친다.
// 주의: canvas2d와 canvas3d 사이의 여분 </div> 하나(구 holeEditorPopup 마크업 끝에 있던 것 — 팝업은 왼쪽
// 사이드바 "발파공 편집" 아코디언으로 이전)가 workspace-area를 조기에 닫아버려서(브라우저 파서 기준)
// canvas3d가 실제로는 workspace-area의 자식이 아니라 <main> 아래 형제로 렌더링된다.
// 리빌딩 이전부터 있던 동작이라 그대로 보존한다.

import canvas2dHtml from './canvas2d(2D캔버스)/canvas2d(2D캔버스).html?raw';
import canvas3dHtml from './canvas3d(3D캔버스)/canvas3d(3D캔버스).html?raw';
import editToolsHtml from '../editTools(편집도구)/editTools(편집도구).html?raw';

// 편집 도구 html은 "플로팅 아이콘바 + @overlay 마커 + 모달 2개" 한 파일이지만,
// 모달 div는 .workspace-area(backdrop-filter로 인해 fixed/absolute 포지셔닝 containing block이
// 깨짐) 밖에 있어야 하므로 마커 기준으로 잘라 아이콘바는 workspace-area 안에, 모달은 밖에 둔다.
const [editToolsBar, editToolsModals] = editToolsHtml.split('<!-- @overlay -->');

export default `
        <div class="workspace-area">
            <div class="view-toggles view-toggles-floating">
                <button id="toggle-2d" class="btn btn-toggle btn-icon-only active" title="2D 평면도">
                    <i data-lucide="map"></i>
                </button>
                <button id="toggle-3d" class="btn btn-toggle btn-icon-only" title="3D 뷰어">
                    <i data-lucide="box"></i>
                </button>
            </div>
${editToolsBar}
${canvas2dHtml}

            </div>

${canvas3dHtml}
        </div>

    ${editToolsModals}
`;
