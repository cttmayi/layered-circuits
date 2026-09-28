# 关卡编辑器（内容基建）

一句话：**写一份 spec，产出一个能被自动验收的关卡**（GDD 4.x 的「30 分钟产出一关」）。

```bash
# 1) 写 spec（真值表 + 素材范围，通常 20~30 行）
$EDITOR tools/level-editor/specs/s1-majority.json

# 2) 生成关卡源码（含参考解），文件可直接 import 进 apps/content
pnpm lc-level tools/level-editor/specs/s1-majority.json /tmp/s3-majority.ts

# 3) 看一遍结论（满分线 / 预算 / 用了哪条路径）
pnpm lc-level tools/level-editor/specs/s1-majority.json
```

## 工具替你做了什么

| 步骤 | 说明 |
| --- | --- |
| 向量 | 按 `inputs` 顺序把 `truth` 展开成全组合向量（行数不对 / key 位数不对直接报错） |
| 参考解 | 1~2 输入：交给 `@lc/opt-solver`（门目录组合空间内的**最省解**）；3 输入以上：SOP 综合兜底 |
| 满分线与预算 | 满分线 = 参考解成本；预算 = 满分线 × (1 + `overhead`)；成本挑战关不设预算 |
| 已知最省 | 求解器搜到过更省解时写进 `bestKnownHalf`（重挑战榜的追赶目标），不动满分线 |
| 验收 | 生成过程中**真跑一遍 `judgeDesign`**（含硬核时序）：不过关就抛错，坏关卡进不了内容包 |

实测耗时（本仓库里的一次真实产出）：写 spec ≈ 5 分钟，工具跑完 + 判定 ≈ 2 秒；
剩下的时间是「手写更优参考解」和「改教学文案」。

## 踩过的坑：二极管级联会衰减驱动能力

SOP 兜底最初用二极管与门 / 或门（便宜），结果「二极管与门 → 二极管或门」在**两个最小项**的用例上
输出 X —— 弱 1 经过二极管后与或门的下拉电阻打平（电阻平局）。
换成「与非门 + 反相器」的可恢复实现后 8 组输入全对。
所以 `synthesizeSop` 默认 `implementation: 'restoring'`，二极管实现只在确定无级联时才用。

这条经验也已经写进 `docs/sim-semantics.md`（驱动能力衰减）。
