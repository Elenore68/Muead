import { useState } from "react";
import Modal from "./Modal";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  busyLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

/** Yes/no confirmation (used for removing a member). API errors stay inside the dialog. */
export default function ConfirmDialog(p: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await p.onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  };
  return (
    <Modal title={p.title} onClose={p.onClose} busy={busy}>
      <p className="page-sub" style={{ marginBottom: 16 }}>{p.message}</p>
      {error && <p role="alert" className="notice error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn btn-outline" onClick={p.onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-reject" onClick={confirm} disabled={busy}>{busy ? p.busyLabel : p.confirmLabel}</button>
      </div>
    </Modal>
  );
}
