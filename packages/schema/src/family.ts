/**
 * 逻辑族契约（Logic Family）—— 门接口规范的数据载体。
 *
 * 真实工业界：每个逻辑族（RTL/DTL/TTL/CMOS）都有成文的输入要求 / 输出保证规范，
 * 同一族内部互连可靠，跨族要电平转换。游戏把这个思想做成「玩家在新游戏时选定的
 * 工艺契约」：
 * - 契约决定工作台默认提供的元件集；
 * - 契约决定输出强度规范（推挽 = 高低都强；RTL 风格 = 高弱 1）；
 * - 生成模块时把契约标注在模块上，方便识别兼容性；
 * - 关卡判定按契约硬约束检查（功能 + 输出强度）。
 *
 * 成本口径与工业逻辑（见 units.ts）：CMOS（无电阻、2 MOS 成门）又便宜又是
 * 推挽强输出——这正是工业史上 CMOS 取代 RTL/DTL/TTL 的原因，教学叙事也顺。
 */

import type { Unit } from './units.js';

export const FAMILIES = ['rtl', 'dtl', 'ttl', 'cmos'] as const;
export type LogicFamily = (typeof FAMILIES)[number];

export interface FamilyContract {
  id: LogicFamily;
  /** 展示名 */
  name: string;
  /** 工作台默认元件集 */
  units: readonly Unit[];
  /**
   * 输出强度规范：
   * - 'weak-high'：高电平允许弱 1（RTL 风格，族内自洽，跨族要电平恢复）；
   * - 'strong'：推挽/轨到轨，高电平必须强 1（万能驱动，级联无忧）。
   */
  output: 'weak-high' | 'strong';
  /** 一句话说明（新游戏选择界面 / 模块标注用） */
  blurb: string;
  /** 教学知识点 */
  points: readonly string[];
}

export const FAMILY_CONTRACTS: Record<LogicFamily, FamilyContract> = {
  rtl: {
    id: 'rtl',
    name: 'RTL 电阻-三极管',
    units: ['npn', 'res'],
    output: 'weak-high',
    blurb:
      '最老式的门电路：三极管 + 上拉电阻。便宜、族内能自洽，但高电平是弱 1，级联到二极管门前要电平恢复。',
    points: [
      '输出高电平 = 弱 1（上拉电阻给的），低电平 = 强 0',
      'RTL 门之间能直接级联（基极只要弱 1 就能导通）',
      '弱 1 输出不能直驱二极管门（压不过下拉）——跨族要加射极跟随器',
    ],
  },
  dtl: {
    id: 'dtl',
    name: 'DTL 二极管逻辑',
    units: ['dio', 'res', 'npn'],
    output: 'weak-high',
    blurb: '用二极管做与/或门，输入需要强驱动（压过电阻网）。教学二极管单向导通的好舞台。',
    points: [
      '二极管门输入必须强信号（压过上下拉电阻）',
      '或门输出高强低弱、与门输出高弱低强——不对称，级联要小心',
    ],
  },
  ttl: {
    id: 'ttl',
    name: 'TTL 推挽输出',
    units: ['npn', 'res', 'dio'],
    output: 'strong',
    blurb: '输出级带射极跟随器 = 推挽：高、低都是强驱动。组装标准、级联无忧，成本略高。',
    points: [
      '输出推挽：高 = 强 1、低 = 强 0，能驱动任何输入',
      'TTL 风格输出是工业界解决「门互连可靠性」的标准答案',
    ],
  },
  cmos: {
    id: 'cmos',
    name: 'CMOS 互补 MOS',
    units: ['nmos', 'pmos'],
    output: 'strong',
    blurb: '上 pMOS 下 nMOS 互补对：无电阻、轨到轨强输出，又便宜又省电——现代芯片的绝对主流。',
    points: [
      'CMOS 门无电阻：上 pMOS 下 nMOS 互补，一个导通一个截止',
      '输出轨到轨：高 = 强 1、低 = 强 0，无静态功耗',
      'CMOS 取代 RTL/DTL/TTL：又便宜（无电阻）又是推挽',
    ],
  },
};

export function familyOf(id: string): FamilyContract {
  return FAMILY_CONTRACTS[id as LogicFamily] ?? FAMILY_CONTRACTS.rtl;
}
