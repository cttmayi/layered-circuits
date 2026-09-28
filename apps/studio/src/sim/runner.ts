/**
 * 仿真执行通道。
 *
 * 首选 Web Worker（保证编辑画布永远不卡，这是 Tech-Plan 的第一条铁律），
 * 但 Worker 在两种情况下不可用：① 单文件 demo 用 file:// 打开（Chrome 禁止 blob/file worker）、
 * ② 个别嵌入式 WebView。此时自动回退到主线程，功能完全一致，只是大电路会略卡。
 */

import { handleRequest } from './handle';
import type { StudioRequest, StudioRequestInput, StudioResponse } from './protocol';

export interface Runner {
  readonly kind: 'worker' | 'main-thread';
  send(request: StudioRequestInput): Promise<StudioResponse>;
}

interface Pending {
  resolve: (value: StudioResponse) => void;
  reject: (error: Error) => void;
}

function fallbackRunner(): Runner {
  let nextId = 1;
  return {
    kind: 'main-thread',
    send(request) {
      const id = nextId++;
      const full = { ...request, id } as StudioRequest;
      return new Promise<StudioResponse>((resolve, reject) => {
        // 让出一帧，避免连续编辑时主线程完全没有响应
        setTimeout(() => {
          try {
            resolve(handleRequest(full));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        }, 0);
      });
    },
  };
}

export function createRunner(): Runner {
  try {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
      name: 'lc-sim',
    });
    const pending = new Map<number, Pending>();
    let nextId = 1;
    let broken = false;

    worker.onmessage = (event: MessageEvent<StudioResponse>) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      entry.resolve(event.data);
    };
    worker.onerror = () => {
      broken = true;
      for (const [, entry] of pending) entry.reject(new Error('仿真 Worker 异常'));
      pending.clear();
    };

    const runner: Runner = {
      kind: 'worker',
      send(request) {
        if (broken) return fallbackRunner().send(request);
        const id = nextId++;
        const full = { ...request, id } as StudioRequest;
        return new Promise<StudioResponse>((resolve, reject) => {
          pending.set(id, { resolve, reject });
          try {
            worker.postMessage(full);
          } catch (error) {
            pending.delete(id);
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      },
    };

    // 单文件/file:// 场景下 worker 脚本加载失败时不抛异常而是触发 onerror，
    // 这里用一个空请求做握手探测：超时就永久切到主线程。
    let alive = false;
    const probe = runner.send({
      type: 'simulate',
      design: { schemaVersion: 1, id: 'probe', name: 'probe', instances: [], nets: [], ports: [] },
      library: [],
      mode: 'logic',
      inputs: {},
    });
    const timer = setTimeout(() => {
      if (!alive) broken = true;
    }, 1500);
    probe
      .then(() => {
        alive = true;
        clearTimeout(timer);
      })
      .catch(() => {
        broken = true;
        clearTimeout(timer);
      });

    return runner;
  } catch {
    return fallbackRunner();
  }
}
