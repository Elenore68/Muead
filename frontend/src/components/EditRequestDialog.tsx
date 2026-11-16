import { useEffect, useState, type FormEvent } from "react";
import { ApiClientError } from "../api/client";
import { getReferenceData, updateRequest } from "../api/requests";
import Modal from "./Modal";
import RequestFields, { FALLBACK_LISTS, toFieldsInput, type Lists, type RequestFormValues } from "./RequestFields";

const PRIORITIES = [
  { label: "High", value: "HIGH" },
  { label: "Medium", value: "MEDIUM" },
  { label: "Low", value: "LOW" },
];

interface Props {
  requestId: string;
  version: number;
  initial: RequestFormValues;
  onSaved: () => void;
  onClose: () => void;
  /** Called when the backend reports a newer version, so the page can reload. */
  onConflict: () => void;
}

/** Edit a DRAFT / REJECTED request. Saving a partial draft is allowed; the required SOW fields are checked at submit. */
export default function EditRequestDialog({ requestId, version, initial, onSaved, onClose, onConflict }: Props) {
  const [v, setV] = useState<RequestFormValues>(initial);
  const [categories, setCategories] = useState<string[]>(initial.category ? [initial.category] : []);
  const [lists, setLists] = useState<Lists>(FALLBACK_LISTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const ac = new AbortController();
    getReferenceData(ac.signal).then(
      (r) => {
        if (r.categories.length) setCategories(r.categories.includes(initial.category) || !initial.category ? r.categories : [initial.category, ...r.categories]);
        setLists({
          environments: r.environments?.length ? r.environments : FALLBACK_LISTS.environments,
          cloudPlatforms: r.cloudPlatforms?.length ? r.cloudPlatforms : FALLBACK_LISTS.cloudPlatforms,
          maintenanceTypes: r.maintenanceTypes?.length ? r.maintenanceTypes : FALLBACK_LISTS.maintenanceTypes,
        });
      },
      () => {},
    );
    return () => ac.abort();
  }, [initial.category]);

  const patch = (p: Partial<RequestFormValues>) => setV((cur) => ({ ...cur, ...p }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.title.trim() || !v.description.trim()) return setError("Title and description are required.");
    const { input, error: problem } = toFieldsInput(v);
    if (!input) return setError(problem ?? "Check the form and try again.");
    setBusy(true);
    setError("");
    try {
      await updateRequest(requestId, version, input);
      onSaved();
    } catch (ex) {
      if (ex instanceof ApiClientError && ex.status === 409) onConflict();
      const details = ex instanceof ApiClientError && ex.details.length ? ` (${ex.details.map((d) => `${d.field ?? "field"}: ${d.issue}`).join(", ")})` : "";
      setError(`${ex instanceof Error ? ex.message : "The request could not be saved."}${details}`);
      setBusy(false);
    }
  };

  return (
    <Modal title="Edit request" onClose={onClose} busy={busy}>
      <form onSubmit={save} noValidate aria-busy={busy}>
        <div className="field"><label htmlFor="edit-title">Title <span className="req">*</span></label>
          <input id="edit-title" className="input" value={v.title} maxLength={200} disabled={busy} onChange={(e) => patch({ title: e.target.value })} /></div>
        <div className="field"><label htmlFor="edit-description">Description <span className="req">*</span></label>
          <textarea id="edit-description" className="textarea" value={v.description} maxLength={5000} disabled={busy} onChange={(e) => patch({ description: e.target.value })} /></div>
        <div className="row3">
          <div className="field"><label htmlFor="edit-category">Category</label>
            <select id="edit-category" className="select" value={v.category} disabled={busy} onChange={(e) => patch({ category: e.target.value })}>
              <option value="">—</option>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select></div>
          <div className="field"><label htmlFor="edit-priority">Priority</label>
            <select id="edit-priority" className="select" value={v.priority} disabled={busy} onChange={(e) => patch({ priority: e.target.value })}>
              <option value="">—</option>
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select></div>
          <div className="field"><label htmlFor="edit-start">Start date</label>
            <input id="edit-start" type="date" className="input" value={v.start} disabled={busy} onChange={(e) => patch({ start: e.target.value })} /></div>
        </div>
        <div className="field"><label htmlFor="edit-end">End date</label>
          <input id="edit-end" type="date" className="input" value={v.end} disabled={busy} onChange={(e) => patch({ end: e.target.value })} /></div>
        <RequestFields idPrefix="edit" values={v} lists={lists} disabled={busy} onChange={patch} />
        {error && <p role="alert" className="notice error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </Modal>
  );
}
