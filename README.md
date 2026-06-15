# 용정 만남의날 시간표 편성

정적 웹앱입니다. `python3 -m http.server 8000` 실행 후 `http://localhost:8000`에서 열 수 있습니다.

## Firebase 연결

기본 상태에서는 브라우저 로컬 저장소를 사용합니다. 여러 사람이 같은 강의 목록, 학생 목록, 배정 결과를 공유하려면 Firebase 설정을 넣으세요.

1. Firebase Console에서 프로젝트를 만듭니다.
2. Web App을 추가하고 SDK config 값을 복사합니다.
3. `firebase-config.local.example.js`를 참고해 `firebase-config.local.js`를 만들고 Firebase config를 넣습니다.
4. Firestore Database를 만들고 아래 규칙으로 시작합니다.

```txt
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /meetday/state {
      allow read, write: if true;
    }
  }
}
```

위 규칙은 링크를 아는 사람이 모두 수정할 수 있는 운영용 최소 설정입니다. 실제 행사 운영에서는 Firebase Authentication을 붙이고 관리자만 쓰기 가능하게 바꾸는 것을 권장합니다.

## 관리자 비밀번호

관리자 비밀번호는 `app.js`에 하드코딩하지 않고, Git에 올리지 않는 `firebase-config.local.js`에서 `window.MEETDAY_ADMIN_PASSWORD`로 넣습니다.

중요: 이 방식은 "레포에 비밀번호를 남기지 않는 것"에는 도움이 되지만, 정적 웹앱 특성상 브라우저로 내려가는 값이라 진짜 보안은 아닙니다. 실제 보호가 필요하면 Firebase Authentication 또는 서버 검증 방식으로 바꿔야 합니다.

앱은 Firestore의 `meetday/state` 문서에 강의 목록, 학생 목록, 배정 결과를 저장합니다. CSV 업로드 후 재학생 수정 표에서 바꾼 내용도 Firebase에 함께 저장됩니다.
