import { startStudioServer } from "@videoos/server";
const handle = await startStudioServer({ port: 4748, projectRoot: "/home/z/VideoOS/.tmp-demo/demo", studioDistDir: "/home/z/VideoOS/apps/studio/dist" });
console.log(`studio ready on http://127.0.0.1:${handle.port}`);
setInterval(() => {}, 1 << 30);
