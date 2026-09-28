/** Web Worker 入口：只做消息搬运，逻辑全在 handleRequest 里（便于在主线程复用/测试） */

import { handleRequest } from './handle';
import type { StudioRequest, StudioResponse } from './protocol';

self.onmessage = (event: MessageEvent<StudioRequest>): void => {
  const response: StudioResponse = handleRequest(event.data);
  (self as unknown as Worker).postMessage(response);
};
