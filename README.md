# 💥 AeroBlast

**웹 기반 발파 설계 · 시뮬레이션 도구**
현장 엔지니어가 손과 엑셀로 하던 발파 설계를, 브라우저 하나로 자동화합니다.

[메인 화면 스크린샷 넣기]

---

## 🎯 해결하려는 문제

국내 터널·채석·토목 현장의 발파 설계는 아직도 대부분 **수작업 계산과 엑셀**에 의존합니다.

- 발파공 배치, 장약량 계산, 진동 검토를 사람이 일일이 계산 → **시간 소모**
- 계산 실수 하나가 **과다 진동·비석 사고**로 이어질 수 있음
- 설계 결과를 지도 위에서 직관적으로 확인할 방법이 없음

## ✨ 주요 기능

| 기능 | 설명 |
|---|---|
| 🧮 **발파 패턴 자동 설계** | Langefors 공식 기반으로 저항선·공간격·장약량 자동 계산 (암반계수·천공경사 보정 포함) |
| 📐 **자유면 추종 배치** | 꺾인 자유면 형상을 따라 목표 저항선을 유지하며 발파공 자동 배치 |
| ⏱ **뇌관 시차 시뮬레이션** | 지연 순서대로 기폭되는 과정을 애니메이션으로 재생 |
| 📉 **발파진동(PPV) 예측** | 지발당 최대 장약량 집계 → 거리별 진동 예측표 → 기준치 초과 시 자동 경고 |
| 🗺 **2D / 3D 시각화** | 위성지도 위 설계 확인, 3D 벤치 모델 및 단면 프로파일 |
| ✏️ **수동 보정** | 자동 배치된 발파공을 드래그로 이동, 다중선택 일괄 수정 |

[기능별 GIF 넣기 — 예: 발파 시뮬레이션 재생 장면]

## 🛠 기술 스택

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-000000?logo=threedotjs&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?logo=supabase&logoColor=white)

## 📌 상태

현재 개발 중입니다. 이 저장소에는 **UI 컴포넌트 · 2D/3D 렌더링 · 입출력 · 좌표 변환** 코드가 공개되어 있으며,
**발파 계산 엔진 · 패턴 배치 알고리즘 · 진동/파쇄도 엔진 · 백엔드**는 상용화 예정으로 비공개입니다.
(따라서 이 저장소 단독으로는 실행되지 않습니다.)

```
src/
├─ components/   # 화면 컴포넌트 (헤더, 사이드바, 작업공간, 인쇄 보고서)
├─ render/       # 2D Canvas 평면도·단면도, Three.js 3D 뷰어, 분석 뷰
├─ ui/           # 이벤트 바인딩, 분석 오버레이
├─ io/           # 프로젝트 JSON/CSV 입출력
├─ utils/        # GPS ↔ 좌표 변환
└─ core/state.js # 전역 상태
```

전체 코드 열람이나 데모가 필요하시면 아래로 연락 주세요.

📫 hyeonbin10022@gmail.com
