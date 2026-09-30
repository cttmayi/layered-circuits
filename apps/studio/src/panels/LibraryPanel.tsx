/**
 * 组件库面板（M3-D / M3-E）：版本、溯源树、本地重挑战榜、存档导入导出。
 *
 * 这一块是「长线养成」的可见部分：
 *  - 版本：同名模块的每一版都留着（复古复用关只许用早期版本，覆盖掉就回不去了）；
 *  - 溯源：点一个模块就能看到它的血统（用了哪些下层模块、各版本成本）；
 *  - 重挑战榜：每关的历史最低成本与尝试次数，成本挑战关还标出「还能更省」；
 *  - 存档：整包导出/导入，方便换机器或备份。
 */

import type { Level } from '@lc/schema';
import { FAMILY_CONTRACTS, type LogicFamily } from '@lc/schema';
import { type ChangeEvent, useMemo, useRef, useState } from 'react';
import type { StoredModule } from '../editor/model';
import {
  compareVersions,
  familyOfModule,
  type TraceNode,
  traceOf,
  versionsOfName,
} from '../level/library';

function familyTag(family: LogicFamily): string {
  return FAMILY_CONTRACTS[family].name.split(' ')[0] as string;
}

import type { LeaderboardRow } from '../level/progress';

export interface LibraryPanelProps {
  library: readonly StoredModule[];
  rows: readonly LeaderboardRow[];
  onExport: () => void;
  onImport: (text: string) => void;
  onJumpToLevel?: (levelId: string) => void;
  currentLevelId?: string;
}

function TraceTree({ node }: { node: TraceNode }): React.JSX.Element {
  return (
    <li>
      <span className="trace-node">
        {node.name} v{node.version}
        <em>成本 {node.costHalf / 2}</em>
        {node.levelId && <span className="trace-src">来自 {node.levelId}</span>}
        {node.cyclic && <span className="trace-src">（检测到循环引用）</span>}
      </span>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <TraceTree key={`${child.hash}-${child.version}`} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function LibraryPanel({
  library,
  rows,
  onExport,
  onImport,
  onJumpToLevel,
  currentLevelId,
}: LibraryPanelProps): React.JSX.Element {
  const [expanded, setExpanded] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const names = useMemo(
    () => [...new Set(library.map((m) => m.name))].sort((a, b) => a.localeCompare(b)),
    [library],
  );
  const cleared = rows.filter((row) => row.cleared);

  const pickFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (!file) return;
    void file.text().then((text) => onImport(text));
    event.target.value = '';
  };

  return (
    <section className="panel library">
      <h3>组件库与成绩</h3>

      <h4>我的模块（{library.length}）</h4>
      {library.length === 0 && <p className="panel-empty">还没有封装过模块。</p>}
      {names.map((name) => {
        const versions = versionsOfName(library, name);
        const newest = versions[0] as StoredModule;
        const open = expanded === name;
        const trace = open ? traceOf(library, newest.hash) : null;
        return (
          <div key={name} className="library-group">
            <button
              type="button"
              className="library-row"
              onClick={() => setExpanded(open ? null : name)}
            >
              <span className="library-name">
                {name}
                <span className="library-family family-{familyTag(familyOfModule(newest))}">
                  {familyTag(familyOfModule(newest))}
                </span>
              </span>
              <span className="library-meta">
                {versions.length} 个版本 · 最新 v{newest.version} · 成本 {newest.costHalf / 2}
                {newest.isSequential ? ' · 时序' : ''}
              </span>
            </button>
            {open && (
              <div className="library-detail">
                <ul className="version-list">
                  {versions.map((mod) => (
                    <li key={mod.hash}>
                      v{mod.version}
                      <em>成本 {mod.costHalf / 2}</em>
                      {mod.levelId && <span className="trace-src">产出关卡 {mod.levelId}</span>}
                      {mod.version !== newest.version &&
                        compareVersions(mod.version, newest.version) < 0 &&
                        mod.stage <= 1 && <span className="trace-src">（复古关可用）</span>}
                    </li>
                  ))}
                </ul>
                <p className="library-sub">溯源树（这一版用了什么）</p>
                {trace ? (
                  <ul className="trace-tree">
                    <TraceTree node={trace} />
                  </ul>
                ) : (
                  <p className="panel-empty">这一版是用底层元件手搭的，没有下层模块。</p>
                )}
              </div>
            )}
          </div>
        );
      })}

      <h4>
        本地重挑战榜（{cleared.length}/{rows.length}）
      </h4>
      {cleared.length === 0 && <p className="panel-empty">还没有通关记录。</p>}
      {cleared.length > 0 && (
        <table className="board">
          <thead>
            <tr>
              <th>关卡</th>
              <th>最低成本</th>
              <th>满分线</th>
              <th>得分</th>
              <th>尝试</th>
            </tr>
          </thead>
          <tbody>
            {cleared.map((row) => {
              const level = row as LeaderboardRow;
              return (
                <tr
                  key={row.levelId}
                  className={row.levelId === currentLevelId ? 'current' : undefined}
                >
                  <td>
                    {onJumpToLevel ? (
                      <button
                        type="button"
                        className="link"
                        onClick={() => onJumpToLevel(row.levelId)}
                      >
                        {row.title}
                      </button>
                    ) : (
                      row.title
                    )}
                    {level.kind !== 'main' && (
                      <em className="board-kind">{kindLabel(level.kind)}</em>
                    )}
                  </td>
                  <td>
                    {row.bestCostHalf !== null ? row.bestCostHalf / 2 : '—'}
                    {row.atBestKnown ? (
                      <span className="board-best">已到最省</span>
                    ) : (
                      <span className="board-next">追赶 {row.bestKnownHalf / 2}</span>
                    )}
                  </td>
                  <td>{row.optimalHalf / 2}</td>
                  <td>{row.bestScore}</td>
                  <td>{row.attempts}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h4>存档</h4>
      <div className="library-actions">
        <button type="button" onClick={onExport}>
          导出存档
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          导入存档
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={pickFile}
        />
      </div>
      <p className="panel-note">
        存档包含进度、组件库（含各版本与溯源）与重挑战记录；导入会覆盖当前进度。
      </p>
    </section>
  );
}

function kindLabel(kind: Level['kind']): string {
  switch (kind) {
    case 'cost':
      return '成本挑战';
    case 'timing':
      return '时序挑战';
    case 'retro':
      return '复古复用';
    default:
      return '主线';
  }
}
