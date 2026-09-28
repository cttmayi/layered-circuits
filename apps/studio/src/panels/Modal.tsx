/**
 * 通用居中对话框：把「接单 / 图纸解开 / 验收结算」这些流程时刻顶到画面中央。
 * 遮罩点击、ESC 都能关；组件用 port 渲染到 body，避免被布局裁切。
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Modal({ title, onClose, children, footer }: ModalProps): React.JSX.Element | null {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop">
      <button
        type="button"
        className="modal-dismiss"
        aria-label="关闭对话框"
        onClick={onClose}
        tabIndex={-1}
      />
      <div className="modal-box" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="modal-x" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
