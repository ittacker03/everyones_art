const app = require("./app");
const { port } = require("./config");
const { ensureStorage } = require("./storage");

ensureStorage()
  .then(() =>
    app.listen(port, () => {
      console.log(
        `모두의 아트 서버가 http://localhost:${port} 에서 실행 중입니다.`,
      );
    }),
  )
  .catch((error) => {
    console.error("저장소를 초기화하지 못했습니다.", error);
    process.exitCode = 1;
  });
