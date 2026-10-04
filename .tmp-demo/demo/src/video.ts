import { defineVideo } from "@videoos/dsl";

// VideoOS project entry — edit this file, then:
//   videoos compile   (DSL → VIR, diagnostics in .video/)
//   videoos test      (visual QA below in tests/video.test.ts)
export default defineVideo(
  {
    title: ".tmp-demo/demo",
    width: 1920,
    height: 1080,
    fps: 30,
    background: "#0a0a12",
    seed: 42,
  },
  (v) => {
    v.scene("intro", { duration: 3.5, background: "#0a0a12" }, (s) => {
      s.beat("title-enter", { at: 0.2, description: "Main title blur-up entrance" });
      s.beat("subtitle-enter", { at: 0.8, description: "Subtitle fade-in" });

      s.text("title", "Hello VideoOS", {
        size: 120,
        weight: 700,
        color: "#ffffff",
        at: { x: "50%", y: "42%" },
        enter: { effect: "blur-up", duration: 0.8 },
      });

      s.text("subtitle", "Programmable Video Runtime", {
        size: 42,
        color: "#8b8ba7",
        at: { x: "50%", y: "56%" },
        enter: { effect: "fade", duration: 0.6, delay: 0.4 },
      });

      s.camera("push-in", { from: 1.0, to: 1.08 });
    });

    v.scene("outro", { duration: 3 }, (s) => {
      s.beat("repo-show", { at: 0.3, description: "Show repository url" });

      s.text("repo", "github.com/AceGuru-mjh/VideoOS", {
        size: 48,
        color: "#ffffff",
        at: { x: "50%", y: "50%" },
        enter: { effect: "fade", duration: 0.8 },
      });
    });

    // intro (3.5s) + outro (3s) − crossfade overlap (0.5s) = 6s @ 30fps, no audio
    v.transition("crossfade", { duration: 0.5, between: ["intro", "outro"] });
  },
);
