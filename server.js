const express = require('express');
const path = require('path');

// 이 앱은 완전한 정적 사이트다. public/jikanClient.js가 브라우저에서 직접
// Jikan API(https://api.jikan.moe)를 호출하므로(CORS 전면 허용 확인됨), 이 서버는
// 로컬에서 미리 보기 위한 정적 파일 서버일 뿐 배포에 필수는 아니다. GitHub Pages,
// Netlify, Vercel(정적) 등 어떤 정적 호스팅에 public/ 폴더만 올려도 동일하게 동작한다.
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`정적 파일 미리보기 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
