// ModelRuntime 单例（pi 0.84.2 起 authStorage + modelRegistry 两个选项合并成它一个）
// 顶层 await → 全进程只创建一次，server.js / worker-session.js 共用，避免每开一个 worker 会话重建一遍目录。
// create() 默认不走网络（refreshOnCreate 为 false），只恢复本地缓存目录。
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export const modelRuntime = await ModelRuntime.create();
