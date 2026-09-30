// @vitest-environment jsdom
/** 共享的界面导航 helper：新流程 = 主菜单 → 关卡模式 → 点关节点 → 工作台 */
import { fireEvent, screen } from '@testing-library/react';

/** 主菜单 → 关卡模式 → 点某关节点进入工作台（已通关/进行中的关不会弹委托） */
export function goToLevel(title: string): void {
  fireEvent.click(screen.getByText('关卡模式'));
  fireEvent.click(screen.getByText(title));
}

/** 完整开工：进第 X 关即开工（进关不再弹「新委托」，直接进工作台） */
export function startJob(title: string): void {
  goToLevel(title);
}
