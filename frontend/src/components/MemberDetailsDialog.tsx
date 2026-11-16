import { useState, type FormEvent } from "react";
import { updateMember, SPECIALTIES, type Member } from "../api/members";
import { specialtyLabel } from "../api/labels";
import Modal from "./Modal";

const MAX = 1000;

interface Props {
  requestId: string;
  member: Member;
  onSaved: () => void;
  onClose: () => void;
}

/** Owner or admin edits a member's specialty and responsibilities (PATCH /requests/{id}/members/{userId}). */
export default function MemberDetailsDialog({ requestId, member, onSaved, onClose }: Props) {
  const [specialty, setSpecialty] = useState(member.specialty ?? "");
  const [responsibilities, setResponsibilities] = useState(member.responsibilities ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (responsibilities.trim().length > MAX) return setError(`Responsibilities are too long (max ${MAX} characters).`);
    setBusy(true);
    setError("");
    try {
      await updateMember(requestId, member.userId, { specialty: specialty || null, responsibilities: responsibilities.trim() || null });
      onSaved();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "The member could not be updated.");
      setBusy(false);
    }
  };

  return (
    <Modal title={`Edit ${member.displayName}`} onClose={onClose} busy={busy}>
      <form onSubmit={save} noValidate aria-busy={busy}>
        <div className="field">
          <label htmlFor="md-specialty">Specialty</label>
          <select id="md-specialty" className="select" value={specialty} disabled={busy} onChange={(e) => setSpecialty(e.target.value)}>
            <option value="">—</option>
            {SPECIALTIES.map((s) => <option key={s} value={s}>{specialtyLabel(s)}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="md-resp">Responsibilities</label>
          <textarea id="md-resp" className="textarea" value={responsibilities} maxLength={MAX} disabled={busy} onChange={(e) => setResponsibilities(e.target.value)} />
        </div>
        {error && <p role="alert" className="notice error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}
