# 🗣️ 쉽게 말해줘

어려운 낱말을 입력하면 **네이버 백과사전**에서 검색하고, 그 내용을 **Google Gemini**가
초등학생 학년 수준(3단계)에 맞게 쉽게 풀어서 설명해 주는 웹앱입니다.

- 난이도 3단계: 초등학교 1~2학년 / 3~4학년 / 5~6학년
- 네이버 검색 → Gemini 요약/순화 → 화면 표시
- API 키는 서버(`.env`)에서만 사용 → 브라우저에 노출되지 않음
- 무료 한도(429) 초과 시 다음 Gemini 모델로 자동 폴백 + 결과 캐싱

---

## 1. 준비물

### Node.js (18 이상)
```bash
node -v   # v18 이상이면 OK
npm -v
```
설치가 안 되어 있으면 https://nodejs.org 에서 LTS 버전을 설치하세요.

### API 키 발급
1. **네이버 검색 API** — https://developers.naver.com/apps
   - 애플리케이션 등록 → 사용 API에서 **검색** 선택
   - `Client ID`, `Client Secret` 발급
2. **Gemini API 키** — https://aistudio.google.com/apikey

---

## 2. 로컬 실행

```bash
# 1) 의존성 설치
npm install

# 2) 환경변수 파일 생성 후 키 입력
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
#   .env 를 열어 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET / GEMINI_API_KEY 채우기

# 3) 실행
npm start
```

브라우저에서 http://localhost:3000 접속.

---

## 3. 배포 (Render / Railway 등)

이 앱은 Node 서버 + 정적 파일 구조라 일반적인 Node 호스팅에 바로 올라갑니다.

1. 이 저장소를 GitHub에 푸시 (아래 4번 참고).
2. [Render](https://render.com) 또는 [Railway](https://railway.app)에서 **New Web Service → GitHub 저장소 연결**.
3. 빌드/실행 설정:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`  (또는 포함된 `Procfile` 사용)
4. **환경변수(Environment Variables)** 를 호스팅 대시보드에 등록 — `.env`는 깃에 올리지 않으므로 여기서 직접 넣어야 합니다:
   | 키 | 값 |
   |---|---|
   | `NAVER_CLIENT_ID` | 네이버 Client ID |
   | `NAVER_CLIENT_SECRET` | 네이버 Client Secret |
   | `GEMINI_API_KEY` | Gemini API 키 |
   | `GEMINI_MODEL` | (선택) `gemini-2.5-flash-lite,gemini-2.5-flash,gemini-2.0-flash` |

   > 포트는 호스팅이 주입하는 `PORT` 환경변수를 자동으로 사용합니다(코드에서 `process.env.PORT` 처리).
5. **네이버 API 등록 도메인**: 네이버 개발자센터 애플리케이션의 "웹 서비스 URL"에 배포된 도메인을 추가해야 검색이 정상 동작할 수 있습니다.

> ⚠️ **보안**: `.env`와 실제 키는 절대 커밋하지 마세요. `.gitignore`에 이미 제외되어 있습니다.
> 키가 외부에 노출됐다면 네이버/Google 콘솔에서 즉시 재발급(회전)하세요.

---

## 4. GitHub에 올리기

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<사용자명>/<저장소명>.git
git push -u origin main
```

푸시 전 `git status`로 **`.env`가 목록에 없는지** 반드시 확인하세요.

---

## 폴더 구조

```
.
├── server.js          # Express 서버 (네이버 + Gemini API 연동, 폴백/캐시)
├── package.json
├── package-lock.json
├── Procfile           # 배포용 실행 명령 (web: node server.js)
├── .env.example       # 환경변수 예시 (복사해서 .env 작성)
├── .gitignore
├── public/
│   ├── index.html     # 화면
│   ├── style.css      # 디자인
│   └── app.js         # 프론트엔드 로직
└── README.md
```

## 참고
- 기본 Gemini 모델 순서: `gemini-2.5-flash-lite → gemini-2.5-flash → gemini-2.0-flash` (`.env`의 `GEMINI_MODEL`로 변경 가능, 쉼표로 폴백 목록 지정).
- 네이버 검색 결과가 없어도 Gemini가 자체 지식으로 설명을 시도합니다.
- 같은 낱말+난이도는 메모리에 캐싱되어 API 호출을 아낍니다(서버 재시작 시 초기화).
