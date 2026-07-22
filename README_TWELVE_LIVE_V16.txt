SOXL V4 방어형 v16 · Twelve Data 실시간/선택일 직접 조회

이번 버전은 로컬 CSV, close-history.json, latest-close.json을 시세 원천으로 사용하지 않습니다.
버튼을 누르는 순간 Twelve Data REST API를 호출합니다.

동작
- 과거 거래일: /eod?symbol=SOXL&date=YYYY-MM-DD → 선택일 확정 종가
- 오늘(뉴욕 16:10 이전): /price?symbol=SOXL → 실시간/최신 현재가, 종가 미확정 안내
- 오늘(뉴욕 16:10 이후): /eod?symbol=SOXL&date=오늘 → 확정 종가
- 주말/휴장일: 선택 날짜와 응답 날짜가 다르면 입력하지 않음
- 미래 날짜: 조회 거부

가장 간단한 설정
1. Twelve Data에서 API Key를 발급합니다.
2. 계산기 설정을 열어 “Twelve Data API Key”에 입력합니다.
3. 설정 적용 후 오늘 기록에서 날짜를 선택하고 “선택일 시세 불러오기”를 누릅니다.
4. Key는 이 브라우저 localStorage에만 저장되며 전략 백업 JSON에는 포함되지 않습니다.

보안 권장 설정
공개 GitHub Pages에서 API Key를 브라우저에 두고 싶지 않으면 cloudflare-worker/twelvedata-proxy.js를 Worker에 배포합니다.
- Worker secret: TWELVE_DATA_API_KEY
- Worker variable: ALLOWED_ORIGIN=https://사용자명.github.io
- 배포된 workers.dev URL을 계산기 설정의 “보안 프록시 URL”에 입력
- 프록시 URL이 있으면 브라우저 API Key보다 우선 사용

레거시 파일
v16은 아래 파일을 사용하지 않습니다. 저장소에서 삭제해도 됩니다.
- .github/workflows/update-close.yml
- scripts/update_close.py
- data/latest-close.json
- data/close-history.json

주의
Twelve Data 공식 문서는 API Key를 공개 저장소나 클라이언트 코드에 하드코딩하지 말 것을 권장합니다.
직접 연결은 개인 브라우저 저장 방식이고, 더 안전한 운영은 포함된 Cloudflare Worker 프록시 방식입니다.
