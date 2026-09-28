/**
 * 任务墙（关卡地图）：把「13 个下拉选项」变成看得见进度的章节表。
 *
 * 一章 = 一个阶段；每个节点显示：状态（未解锁 / 可接单 / 已交付）、星级（★☆）、
 * 类型（主线 / 成本挑战 / 时序挑战 / 复古复用）。点节点直接接单。
 */

import { ALL_LEVELS } from '@lc/content';
import {
  isLevelUnlocked,
  MAX_STARS_PER_LEVEL,
  type Progress,
  reconCount,
  sideJobCount,
} from '../level/progress';

export interface LevelMapProps {
  progress: Progress;
  currentLevelId: string;
  onPick: (levelId: string) => void;
}

const KIND_LABEL: Record<string, string> = {
  main: '',
  cost: '成本挑战',
  timing: '时序挑战',
  retro: '复古复用',
};

const STAGE_TITLE: Record<number, string> = {
  1: '第一章 · 街道维修铺（逻辑门）',
  2: '第二章 · 研究所（时序单元）',
  3: '第三章 · 数字模块',
  4: '第四章 · 存储器与总线',
  5: '第五章 · 处理器',
  6: '第六章 · 整机',
};

export function LevelMap({ progress, currentLevelId, onPick }: LevelMapProps): React.JSX.Element {
  const stages = [...new Set(ALL_LEVELS.map((level) => level.stage))].sort((a, b) => a - b);
  const earned = ALL_LEVELS.reduce(
    (sum, level) => sum + (progress.cleared[level.id]?.stars ?? 0),
    0,
  );

  return (
    <section className="panel level-map">
      <h3>任务墙</h3>
      <p className="panel-note">
        已交付 {Object.keys(progress.cleared).length}/{ALL_LEVELS.length} · 星 {earned}/
        {ALL_LEVELS.length * MAX_STARS_PER_LEVEL} · 自主测绘 {reconCount(progress)} · 支线{' '}
        {sideJobCount(progress)}
      </p>
      {stages.map((stage) => {
        const levels = ALL_LEVELS.filter((level) => level.stage === stage);
        return (
          <div key={stage} className="map-stage">
            <h4>{STAGE_TITLE[stage] ?? `第 ${stage} 章`}</h4>
            <ul className="map-nodes">
              {levels.map((level) => {
                const record = progress.cleared[level.id];
                const unlocked = isLevelUnlocked(progress, level.id);
                const cleared = (record?.clearedAt ?? 0) > 0;
                const stars = record?.stars ?? 0;
                const state = cleared ? 'cleared' : unlocked ? 'open' : 'locked';
                return (
                  <li key={level.id} className={`map-node ${state}`}>
                    <button
                      type="button"
                      disabled={!unlocked}
                      className={level.id === currentLevelId ? 'active' : ''}
                      onClick={() => onPick(level.id)}
                      title={unlocked ? level.title : '前一单交付后才解锁'}
                    >
                      <span className="map-title">{level.title}</span>
                      {KIND_LABEL[level.kind] ? (
                        <span className="map-kind">{KIND_LABEL[level.kind]}</span>
                      ) : null}
                      {Object.keys(progress.sideJobs).some((id) =>
                        id.startsWith(`${level.id}:`),
                      ) && (
                        <span className="map-recon map-side" title="这张单接了支线">
                          支线
                        </span>
                      )}
                      {progress.recon[level.id] === 'measured' && (
                        <span className="map-recon" title="这张图纸是你自己测出来的">
                          测绘
                        </span>
                      )}
                      <span className={`map-stars ${state}`}>
                        {cleared
                          ? `${'★'.repeat(stars)}${'☆'.repeat(MAX_STARS_PER_LEVEL - stars)}`
                          : unlocked
                            ? '未开工'
                            : '未解锁'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
