// expect(subject)：把 FrameSubject / SceneSubject 绑定为对应断言对象（SPEC §5.1 测试 API）
import { createFrameAssertions, createSceneAssertions } from "./assertions";
import type { FrameAssertion, FrameSubject, SceneAssertion, SceneSubject } from "./types";

export function expect(actual: FrameSubject): FrameAssertion;
export function expect(actual: SceneSubject): SceneAssertion;
export function expect(actual: FrameSubject | SceneSubject): FrameAssertion | SceneAssertion {
  return actual.kind === "frame" ? createFrameAssertions(actual) : createSceneAssertions(actual);
}
