import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, CalendarDays, UploadCloud, FilePlus2 } from "lucide-react";
import { Topbar } from "../components/Layout";
import { config } from "../config";
import { ApiClientError } from "../api/client";
import { ACCEPT_ATTR, checkFile, createRequest, getReferenceData, uploadAttachment, type ApiPriority } from "../api/requests";

const tips = [
  "Provide a clear and concise title",
  "Include the purpose and details",
  "Select the appropriate category",
  "Add any relevant attachments",
];

// Used in mock mode, and as a fallback if GET /reference-data fails.
const FALLBACK_CATEGORIES = ["Equipment", "Facilities", "IT", "Office", "HVAC"];
const PRIORITIES: { label: string; value: ApiPriority }[] = [
  { label: "High", value: "HIGH" },
  { label: "Medium", value: "MEDIUM" },
  { label: "Low", value: "LOW" },
];

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function NewRequest() {
  const nav = useNavigate();
  const [err, setErr] = useState<{ message: string; details: string[] } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [categories, setCategories] = useState(FALLBACK_CATEGORIES);
  const [files, setFiles] = useState<File[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!config.apiEnabled) return;
    const ac = new AbortController();
    getReferenceData(ac.signal).then(
      (r) => r.categories.length && setCategories(r.categories),
      () => {}, // keep the fallback list; the form must stay usable
    );
    return () => ac.abort();
  }, []);

  const addFiles = (incoming: FileList | File[]) => {
    const ok: File[] = [];
    const bad: string[] = [];
    for (const f of Array.from(incoming)) {
      const problem = checkFile(f);
      if (problem) bad.push(problem);
      else if (!files.some((x) => x.name === f.name && x.size === f.size)) ok.push(f);
    }
    setFileErrors(bad);
    if (ok.length) setFiles((cur) => [...cur, ...ok]);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    const f = new FormData(e.currentTarget);
    for (const k of ["title", "description", "category", "priority", "target"]) {
      if (!String(f.get(k) ?? "").trim()) return setErr({ message: "Please fill in all required fields.", details: [] });
    }
    setErr(null);

    if (!config.apiEnabled) {
      nav("/requests"); // mock mode: original behaviour
      return;
    }

    setSubmitting(true);
    let created: { id: string; requestNo: string };
    try {
      created = await createRequest({
        title: String(f.get("title")).trim(),
        description: String(f.get("description")).trim(),
        category: String(f.get("category")),
        priority: String(f.get("priority")) as ApiPriority,
        // The form has one "Target Date"; it is saved as the start of the schedule (local midnight).
        schedule: { start: new Date(`${String(f.get("target"))}T00:00:00`).toISOString() },
      });
    } catch (ex) {
      const details = ex instanceof ApiClientError ? ex.details.map((d) => `${d.field ?? "field"}: ${d.issue}`) : [];
      setErr({ message: ex instanceof Error ? ex.message : "The request could not be created.", details });
      setSubmitting(false);
      return;
    }

    // The request exists now. Upload files one by one; a failed file must not hide the created request.
    const failures: string[] = [];
    for (const file of files) {
      try {
        await uploadAttachment(created.id, file);
      } catch (ex) {
        failures.push(ex instanceof Error ? ex.message : `${file.name}: upload failed.`);
      }
    }
    nav("/requests", {
      state: {
        created: created.requestNo,
        warning: failures.length ? `The request was created, but ${failures.length} attachment(s) failed to upload: ${failures.join(" ")}` : undefined,
      },
    });
  };

  return (
    <>
      <Topbar crumbs="Requests > New Request" title="Create Maintenance Request" subtitle="Submit a new request and provide the details." />
      <div className="form-layout">
        <form className="card" onSubmit={submit} noValidate aria-busy={submitting}>
          <div className="field"><label htmlFor="title">Title <span className="req">*</span></label>
            <input id="title" name="title" className="input" placeholder="Enter request title" maxLength={200} disabled={submitting} /></div>
          <div className="field"><label htmlFor="description">Description <span className="req">*</span></label>
            <textarea id="description" name="description" className="textarea" placeholder="Describe the request, goals, and expected outcome..." maxLength={5000} disabled={submitting} /></div>
          <div className="row3">
            <div className="field"><label htmlFor="category">Category <span className="req">*</span></label>
              <select id="category" name="category" className="select" defaultValue="" disabled={submitting}>
                <option value="" disabled>Select category</option>
                {categories.map((c) => <option key={c}>{c}</option>)}
              </select></div>
            <div className="field"><label htmlFor="priority">Priority <span className="req">*</span></label>
              <select id="priority" name="priority" className="select" defaultValue="" disabled={submitting}>
                <option value="" disabled>Select priority</option>
                {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select></div>
            <div className="field"><label htmlFor="target">Target Date <span className="req">*</span></label>
              <input id="target" name="target" type="date" className="input" aria-label="Target date" disabled={submitting} /></div>
          </div>
          <div className="field"><label htmlFor="files">Attachments (Optional)</label>
            <div
              className="drop"
              style={dragging ? { borderColor: "var(--c-primary)" } : undefined}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <UploadCloud size={28} color="var(--c-primary)" />
              <div>
                Drag and drop files here, or <u role="button" tabIndex={0} onClick={() => fileInput.current?.click()}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}>browse</u><br />
                <small>PDF, DOC, XLS, PNG (Max 10 MB)</small>
              </div>
              <input ref={fileInput} id="files" type="file" multiple accept={ACCEPT_ATTR} className="sr-only" tabIndex={-1}
                onChange={(e) => { addFiles(e.target.files ?? []); e.target.value = ""; }} disabled={submitting} />
            </div>
            {fileErrors.length > 0 && (
              <div role="alert" className="notice error" style={{ marginTop: 8 }}>
                <ul>{fileErrors.map((m) => <li key={m}>{m}</li>)}</ul>
              </div>
            )}
            {files.length > 0 && (
              <ul className="file-list" aria-label="Selected files">
                {files.map((file) => (
                  <li key={`${file.name}-${file.size}`}>
                    <span>{file.name} <small>({kb(file.size)})</small></span>
                    <button type="button" onClick={() => setFiles((cur) => cur.filter((x) => x !== file))} disabled={submitting} aria-label={`Remove ${file.name}`}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {err && (
            <div role="alert" className="notice error">
              <div>
                {err.message}
                {err.details.length > 0 && <ul>{err.details.map((d) => <li key={d}>{d}</li>)}</ul>}
              </div>
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => nav("/requests")} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? (files.length ? "Submitting and uploading…" : "Submitting…") : "Submit Request"}
            </button>
          </div>
        </form>
        <aside className="card guide">
          <FilePlus2 size={64} color="var(--c-primary)" />
          <h2 className="card-title">Request Guidelines</h2>
          <ul>{tips.map((t) => <li key={t}><CheckCircle2 size={18} />{t}</li>)}</ul>
          <CalendarDays size={0} />
        </aside>
      </div>
    </>
  );
}
