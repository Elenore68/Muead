import type { RequestFieldsInput } from "../api/requests";

/*
 * TASK 06: the SOW request fields (environment, platform, type, scope, affected systems, links), shared by the
 * New Request form and the Edit dialog. Live mode only: mock mode keeps the original form unchanged.
 */
export interface RequestFormValues {
  title: string;
  description: string;
  category: string;
  priority: string;
  environment: string;
  cloudPlatform: string;
  maintenanceType: string;
  scope: string;
  /** Comma-separated. */
  affectedSystems: string;
  /** One URL per line. */
  links: string;
  /** yyyy-mm-dd */
  start: string;
  end: string;
}

export const EMPTY_VALUES: RequestFormValues = {
  title: "", description: "", category: "", priority: "", environment: "", cloudPlatform: "", maintenanceType: "",
  scope: "", affectedSystems: "", links: "", start: "", end: "",
};

/** Same lists as the backend (lib/lifecycle.ts). Used until GET /reference-data answers, or if it fails. */
export const FALLBACK_LISTS = {
  environments: ["Development", "Testing", "Staging", "Production", "Disaster Recovery"],
  cloudPlatforms: ["AWS", "Azure", "Google Cloud", "Hybrid", "Other"],
  maintenanceTypes: ["Planned Maintenance", "Emergency Maintenance", "Preventive Maintenance", "Corrective Maintenance", "Upgrade", "Patching"],
};
export type Lists = typeof FALLBACK_LISTS;

export const parseSystems = (text: string): string[] =>
  text.split(",").map((s) => s.trim()).filter(Boolean);

/** One URL per line; the backend accepts only http(s). Returns an error message for the first bad line. */
export const parseLinks = (text: string): { links: { label: string; url: string }[]; error?: string } => {
  const links: { label: string; url: string }[] = [];
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    let u: URL;
    try {
      u = new URL(line);
    } catch {
      return { links, error: `"${line}" is not a valid link. Use full addresses such as https://example.com.` };
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") return { links, error: `"${line}" must start with http:// or https://.` };
    links.push({ label: line, url: line });
  }
  return { links };
};

const startOfDay = (d: string) => new Date(`${d}T00:00:00`).toISOString();
const endOfDay = (d: string) => new Date(`${d}T23:59:00`).toISOString();

/**
 * Converts form values to the API body. Returns an error message instead of a body when something is invalid.
 * `requireSchedule`: the New Request form has always required a target date.
 */
export const toFieldsInput = (v: RequestFormValues): { input?: RequestFieldsInput; error?: string } => {
  const { links, error } = parseLinks(v.links);
  if (error) return { error };
  if (v.end && !v.start) return { error: "Choose a start date before an end date." };
  if (v.start && v.end && endOfDay(v.end) <= startOfDay(v.start)) return { error: "The end date must be after the start date." };
  const input: RequestFieldsInput = {
    title: v.title.trim(),
    description: v.description.trim(),
    ...(v.category ? { category: v.category } : {}),
    ...(v.priority ? { priority: v.priority as RequestFieldsInput["priority"] } : {}),
    ...(v.environment ? { environment: v.environment } : {}),
    ...(v.cloudPlatform ? { cloudPlatform: v.cloudPlatform } : {}),
    ...(v.maintenanceType ? { maintenanceType: v.maintenanceType } : {}),
    scope: v.scope.trim(),
    affectedSystems: parseSystems(v.affectedSystems),
    links,
    ...(v.start ? { schedule: { start: startOfDay(v.start), ...(v.end ? { end: endOfDay(v.end) } : {}) } } : {}),
  };
  return { input };
};

interface Props {
  values: RequestFormValues;
  onChange: (patch: Partial<RequestFormValues>) => void;
  lists: Lists;
  disabled?: boolean;
  /** Prefix for element ids (two instances never share a page, but ids stay unique anyway). */
  idPrefix?: string;
}

/** The six SOW fields. Environment, platform and maintenance type are required before a request can be submitted. */
export default function RequestFields({ values, onChange, lists, disabled, idPrefix = "rf" }: Props) {
  const id = (n: string) => `${idPrefix}-${n}`;
  const select = (name: "environment" | "cloudPlatform" | "maintenanceType", label: string, options: string[]) => (
    <div className="field">
      <label htmlFor={id(name)}>{label} <span className="req">*</span></label>
      <select id={id(name)} className="select" value={values[name]} disabled={disabled} onChange={(e) => onChange({ [name]: e.target.value })}>
        <option value="" disabled>Select {label.toLowerCase()}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
  return (
    <>
      <div className="row3">
        {select("environment", "Environment", lists.environments)}
        {select("cloudPlatform", "Cloud Platform", lists.cloudPlatforms)}
        {select("maintenanceType", "Maintenance Type", lists.maintenanceTypes)}
      </div>
      <div className="field">
        <label htmlFor={id("scope")}>Scope</label>
        <textarea id={id("scope")} className="textarea" value={values.scope} maxLength={5000} disabled={disabled}
          placeholder="What is included in this maintenance, and what is not?" onChange={(e) => onChange({ scope: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor={id("systems")}>Affected Systems</label>
        <input id={id("systems")} className="input" value={values.affectedSystems} disabled={disabled}
          placeholder="Separate with commas, e.g. orders-db, payments-api" onChange={(e) => onChange({ affectedSystems: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor={id("links")}>Links</label>
        <textarea id={id("links")} className="textarea" value={values.links} disabled={disabled}
          placeholder={"One link per line, e.g. https://wiki.example.com/runbook"} onChange={(e) => onChange({ links: e.target.value })} />
      </div>
    </>
  );
}
