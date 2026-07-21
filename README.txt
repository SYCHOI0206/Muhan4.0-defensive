무한매수법 V4.0 방어형 계산기 업데이트
========================================

배포 파일
- index.html
- v40_defensive_core.js
- v40_defensive_patch.js
- sw.js
- manifest.webmanifest

GitHub 적용 방법
1. 저장소 루트의 index.html, sw.js, manifest.webmanifest를 이 파일로 교체합니다.
2. v40_defensive_core.js와 v40_defensive_patch.js를 저장소 루트에 추가합니다.
3. 기존 icons/icon-192.png, icons/icon-512.png는 그대로 유지합니다.
4. GitHub Pages 반영 후 설치형 앱은 완전히 종료한 뒤 다시 실행합니다.
5. 이전 캐시가 남으면 브라우저 사이트 데이터 또는 설치 앱을 한 번 삭제 후 재설치합니다.

반영한 방어형 규칙
- 원문 22% 별지점, 22% 전량목표, 쿼터 1/3 유지
- 당일 시작 T/현금/평단으로 전반·후반, 별지점, 1회매수금 고정
- 종가 일간수익률 -22.5% 이하인 날 정상매수가 체결되면 다음 거래일 0.25T LOC 예약
- 다음 거래일에는 원문 정상매수를 0.25T 단일 LOC로 대체
  · 전반: 별지점 LOC와 평단가 LOC 중 높은 값
  · 후반: 별지점 LOC
  · 미체결 주문은 당일 소멸
  · 전량매도/리버스 진입 시 예약 취소
- 리버스 신규매수
  · 200거래일 미만: 현금 25%
  · 종가 >= 당일 포함 MA200: 현금 15%
  · MA200의 85% 이상: 현금 10%
  · MA200의 85% 미만: 현금 5%
- 모든 매수는 실제 현금으로 수량 상한 적용

검증
v40_defensive_core.js를 SOXL-history.csv(2010-03-11~2026-06-18)에 실행한 결과가
backtest_v40_defensive_loc_followup.py의 updated_defensive_loc 결과와 부동소수점 오차 범위에서 일치했습니다.
- 최종평가액: 2,251,208.69
- CAGR: 39.500829%
- 일별 MDD: -46.711630%

주의
- 자동 처리로 기록해야 한 날의 복합 순서(예: 쿼터 판정 후 방어 주문 등)가 정확히 재생됩니다.
- 직접 선택은 실제 체결을 수동 보정하는 기능이며, 선택한 단일 거래만 반영합니다.
- 자동 종가 및 CNN 지표는 외부 데이터 제공처/CORS 상태에 따라 실패할 수 있습니다.

[2026-07-20 자동 종가 조회 수정]
- 외부 CORS 의존을 제거하기 위해 GitHub Actions + data/latest-close.json 구조를 추가했습니다.
- 자세한 설치법은 README_AUTO_CLOSE_FIX.txt를 확인하세요.
