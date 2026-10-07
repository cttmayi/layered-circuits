/**
 * **判定侧与画布侧共用的三个界限值 —— 单一出处。**
 *
 * 为什么要单独一个文件：这三个数字原来在三个地方各写了一份
 * （`harness.ts` 的 `defaultSettlePs` / `maxEventsPerVector`、`gate-delay.ts` 的
 * `DEFAULT_WINDOW_PS` / `DEFAULT_MAX_EVENTS`、`apps/studio/src/sim/handle.ts` 的
 * `GATE_CANVAS_WINDOW_PS` / `GATE_CANVAS_MAX_EVENTS`），只是**注释**里写着"与 X 同量级"。
 * 注释不是约束：哪天有人改了一处、忘了另一处，画布与判定的口径就会**悄悄分叉**，
 * 而这种分叉在测试里表现为"逐网差异"，排查成本极高。
 *
 * 所以：值定义在这里，其它地方**必须**引用（`apps/studio/test/gate-canvas-same-caliber.test.ts`
 * 里有一条等式断言，任何一处又写死数字都会变红）。
 *
 * ⚠️ 改这里的值 = 改判定口径 ⇒ 任何一关的 pass/错行/行数都可能变，
 * 属于"必须停下回报"的改动（见 `apps/studio/test/gate-delay-levels.test.ts` 的钉住表）。
 */

/** 时序模式默认等待（ps）：施加激励后等多久采样 —— `harness.ts` 的 `defaultSettlePs` 默认值 */
export const SETTLE_PS_DEFAULT = 100_000;

/**
 * 门级引擎默认时间窗（ps）= 1µs。
 * 带延迟的电路要留够慢路径走完的时间；关卡向量自带 `settlePs` 时以它为准，
 * 而**所有关卡向量的 settlePs 都 ≤ 这个值**（有断言钉住）。
 */
export const GATE_WINDOW_PS = 1_000_000;

/** 门级引擎默认事件上限 —— 撞上它记 `capped`（判定侧记为 unstable，画布侧回落）*/
export const GATE_MAX_EVENTS = 500_000;
