import { useState, type FormEvent } from "react";
import { ApiClientError } from "../api/client";
import Modal from "./Modal";

interface TextActionDialogProps {
  title: string;
  /** Short explanation shown above the field. */
  intro?: string;
  label: string;
  placeholder?: string;
  required: boolean;
  maxLength: number;
  submitLabel: string;
  busyLabel: string;
  /** Button style: "approve" | "reject" | "primary". */
  tone: "approve" | "reject" | "primary";
  onSubmit: (text: string) => Promise<void>;
  onClose: () => void;
}

/**
 * One dialog for "action + text": approve (optional comment), reject (required comment), withdraw (required reason).
 * Errors from the API are shown inside the dialog; the dialog stays open so nothing typed is lost.
 */
export default function TextActionDialog(p: TextActionDialogProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fieldId = `tad-${p.title.replace(/\W+/g, "-").toLowerCase()}`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (p.required && !value) return setError(`${p.label} is required.`);
    if (value.length > p.maxLength) return setError(`${p.label} is too long (max ${p.maxLength} characters).`);
    setBusy(true);
    setError("");
    try {
      await p.onSubmit(value);
    } catch (ex) {
      setError(ex instanceof ApiClientError || ex instanceof Error ? ex.message : "Something went wrong.");
      setBusy(false);
    }
  };

  const btnClass = p.tone === "approve" ? "btn btn-approve solid" : p.tone === "reject" ? "btn btn-reject" : "btn btn-primary";
  return (
    <Modal title={p.title} onClose={p.onClose} busy={busy}>
      <form onSubmit={submit} noValidate aria-busy={busy}>
        {p.intro && <p className="page-sub" style={{ marginBottom: 12 }}>{p.intro}</p>}
        <div className="field">
          <label htmlFor={fieldId}>
            {p.label} {p.required ? <span className="req">*</span> : <span className="cell-sub">(optional)</span>}
          </label>
          <textarea id={fieldId} className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder={p.placeholder}
            maxLength={p.maxLength} disabled={busy} aria-required={p.required} aria-invalid={!!error} />
          <small className="cell-sub">{text.trim().length}/{p.maxLength}</small>
        </div>
        {error && <p role="alert" className="notice error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-outline" onClick={p.onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={btnClass} disabled={busy}>{busy ? p.busyLabel : p.submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}
