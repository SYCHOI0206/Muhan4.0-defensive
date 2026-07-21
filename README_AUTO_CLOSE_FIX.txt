종가 자동조회 CORS 수정 안내
============================

원인
----
기존 앱은 GitHub Pages 브라우저에서 Stooq 또는 Yahoo 같은 외부 도메인을 직접 fetch했습니다.
외부 서버가 CORS를 허용하지 않거나, 프록시가 중단되면 브라우저가 응답을 읽지 못합니다.
또한 2026년 Stooq 다운로드 정책 변경으로 API 키가 필요한 경우가 있습니다.

수정 구조
---------
1. GitHub Actions가 미국장 마감 후 SOXL 일봉을 서버 측에서 조회합니다.
2. 결과를 data/latest-close.json으로 저장하고 저장소에 자동 커밋합니다.
3. 계산기는 같은 GitHub Pages 출처의 JSON만 읽으므로 CORS 오류가 발생하지 않습니다.
4. 같은 출처 JSON이 없을 때만 Yahoo/프록시를 보조적으로 시도합니다.

최초 배포 절차
--------------
1. 이 압축파일의 모든 내용을 저장소 루트에 업로드합니다.
   특히 숨김 폴더 .github/workflows/update-close.yml도 반드시 포함해야 합니다.
2. GitHub 저장소의 Actions 탭을 엽니다.
3. 왼쪽에서 "Update latest close"를 선택합니다.
4. "Run workflow"를 한 번 실행합니다.
5. 완료 후 GitHub Pages를 새로고침하고 "종가 자동 불러오기"를 누릅니다.

자동 실행
---------
워크플로는 미국 뉴욕 시간 평일 오후 6시 30분에 실행됩니다.
시장 휴일에는 직전 거래일 값이 유지될 수 있습니다.

선택 사항: Stooq 보조키
----------------------
Yahoo 조회가 모두 실패할 때 Stooq를 보조 공급자로 사용할 수 있습니다.
Stooq 키가 있다면 저장소 Settings > Secrets and variables > Actions에서
STOOQ_API_KEY라는 Repository secret으로 등록합니다. 키가 없어도 Yahoo 공급자를 먼저 사용합니다.

주의
----
- Actions가 저장소에 커밋할 수 있도록 Settings > Actions > General의 Workflow permissions가
  Read and write permissions로 허용되어야 합니다. workflow 파일에도 contents: write가 포함되어 있습니다.
- 공개 저장소가 60일 이상 비활성 상태이면 예약 워크플로가 자동 중지될 수 있습니다.
  그 경우 Actions 탭에서 워크플로를 다시 활성화하거나 수동 실행합니다.
- PWA가 구버전 화면을 보이면 앱을 완전히 종료 후 다시 열거나 브라우저 사이트 데이터를 갱신하세요.
  서비스워커 캐시는 v2로 변경했습니다.
