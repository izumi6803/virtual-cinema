import { useEffect, useRef } from 'react';

export default function Dialog({ open, title, onClose, children, sheet = false }) {
  const ref = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  function onPointerDown(event) {
    if (!sheet) return;
    if (event.target.closest?.('button, a, input, textarea, label')) return;
    dragRef.current = event.clientY;
  }

  function onPointerUp(event) {
    if (!sheet || dragRef.current == null) return;
    const delta = event.clientY - dragRef.current;
    dragRef.current = null;
    if (delta > 90) onClose();
  }

  return (
    <dialog
      ref={ref}
      className={`dialog ${sheet ? 'dialog--sheet' : ''}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <div className="dialog__body">
        {sheet ? <span className="dialog__handle" aria-hidden="true" /> : null}
        <h2>{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
