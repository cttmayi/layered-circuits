/**
 * 委托（commission）：把「关卡规格说明书」换成「客户的一单活儿」。
 *
 * 世界观（写实工业风）：你是街道维修铺的年轻师傅，从给街坊修收音机开始，
 * 一路做到研究所、通信站 —— 每一关都是一张委托单：谁要、要什么、给多少钱、有什么禁忌。
 *
 * 数据上刻意**不进 Level schema**：委托纯属叙事包装，缺省时用 brief 兜底，
 * 这样关卡内容与叙事文案可以分开维护（加文案不用动关卡校验）。
 */

import type { Level } from '@lc/schema';

export interface Commission {
  /** 委托方 */
  client: string;
  /** 委托方的一句话（人话需求） */
  note: string;
  /** 款项用途说明（默认按起订价/加急费自动生成） */
  terms?: string;
}

const COMMISSIONS: Record<string, Commission> = {
  's1-npn': {
    client: '修表铺 · 老周',
    note: '客人踩上门口脚垫铃就响，脚一抬铃停。',
  },
  's1-dio': {
    client: '五金店 · 王嫂',
    note: '单向门铃，只认客人进门的方向。',
  },
  's1-float': {
    client: '传达室 · 老李',
    note: '弹簧门没人推时自己关着（默认是关的），把没人接的线用电阻钉稳。',
  },
  's1-not': {
    client: '修表铺 · 老周',
    note: '收音机的指示灯接反了：送 1 进去灯灭、送 0 进去灯亮。给我做个「反的」，五块钱以内。',
  },
  's1-and': {
    client: '五金店 · 王嫂',
    note: '保险箱要两把钥匙同时插进去才通电。少插一把就不能开，做得到吗？',
  },
  's1-or': {
    client: '传达室 · 老李',
    note: '前后门各一个开门按钮，按哪个都得开 —— 我这腿脚，可不想绕一圈。',
  },
  's1-nand': {
    client: '厂里电工 · 老赵',
    note: '这块「不都是 1 才出 0」的积木最好用，先给我做一箱，以后别的图纸全靠它拼。',
  },
  's1-nor': {
    client: '修表铺 · 老周',
    note: '又是一个「反过来的或」。上回那版太贵了，这回挑最省的做。',
  },
  's1-xor': {
    client: '研究所实习生 · 小陈',
    note: '楼梯双控灯：楼下楼上都能开关同一盏灯。图纸上有要求 —— 只能用三极管和电阻，积木只许用你以前做的非门、与非门。',
  },
  's1-xor-retro': {
    client: '老档案室',
    note: '照 1968 年的老图纸重做一遍双控灯。老规矩：当年还没有你后来封装的那种顺手积木，只能用当时的手段。',
  },
  's1-xnor': {
    client: '火车站 · 信号员',
    note: '两条轨道状态一致才放行，不一致必须拦住。这活儿要紧，别糊弄。',
  },
  's2-sr-latch': {
    client: '车间 · 刘主任',
    note: '一个按钮启动、一个按钮停。手松开也得记住刚才按的是哪个 —— 上回那台机器自己又转起来了，吓死人。',
  },
  's2-d-latch': {
    client: '钟表铺 · 老板娘',
    note: '整点那一下才准搬数据，平时数据怎么变都别理它。',
  },
  's2-dff': {
    client: '研究所 · 时序组',
    note: '要在时钟的「上升沿」那一下搬数据，而且时钟高电平期间数据乱跳也不能影响输出（这叫无空翻）。波形我们要看。',
  },
  's2-dff-cost': {
    client: '研究所 · 采购科',
    note: '同样的触发器，不限预算，但我们要最省的那一版 —— 一台上千个，省一个元件就是一笔钱。',
  },
  's2-dff-fast': {
    client: '通信站 · 值班台',
    note: '20 兆时钟，一帧都不能丢。这单是加急：延迟必须压得住，硬核验收，别抱侥幸。',
  },
};

const FALLBACK: Commission = {
  client: '街道维修铺',
  note: '客户送来一张图纸，按要求把这件东西做出来。',
};

export function commissionOf(level: Level): Commission {
  return COMMISSIONS[level.id] ?? { ...FALLBACK, note: level.brief || FALLBACK.note };
}

/** 合同条款：款项 / 交期 / 素材禁忌 —— 全部由关卡现有字段推导，叙事不引入新规则 */
export function contractOf(level: Level): { pay: string; deadline: string; taboo: string } {
  const pay =
    level.kind === 'cost'
      ? '不限预算，按最省结算'
      : `${level.budgetHalf / 2} 元（材料费自负，省下的算你的）`;
  const deadline =
    level.timingBudgetPs !== undefined
      ? `关键路径 ≤ ${(level.timingBudgetPs / 1000).toFixed(2)} ns`
      : level.mode === 'timing'
        ? '按硬核时序验收'
        : '交期不紧';
  const taboo =
    level.allowedUnits.length < 4
      ? `只许用${level.allowedUnits.map(unitName).join('、')}`
      : '不限制元件';
  return { pay, deadline, taboo };
}

function unitName(unit: string): string {
  return { npn: '三极管', res: '电阻', dio: '二极管', cap: '电容' }[unit] ?? unit;
}
