import { useCallback } from "react";
import { config } from "../config";
import { getApprovalHistory } from "../api/approvals";
import { listMembers } from "../api/members";
import { listTasks } from "../api/tasks";
import { getReadiness } from "../api/readiness";
import { getActivity } from "../api/activity";
import { getReport, getValidation } from "../api/validation";
import { useResource } from "./useResource";

/** Members of a request (live mode only; mock mode has no membership data). */
export function useMembers(requestId: string) {
  const load = useCallback((signal: AbortSignal) => listMembers(requestId, signal), [requestId]);
  return useResource(load, config.apiEnabled);
}

/** Approval rounds of a request. Also used to decide whether the caller sees decision controls. */
export function useApprovalHistory(requestId: string) {
  const load = useCallback((signal: AbortSignal) => getApprovalHistory(requestId, signal), [requestId]);
  return useResource(load, config.apiEnabled);
}

/** Tasks of a request (live mode only). */
export function useTasks(requestId: string, enabled = true) {
  const load = useCallback((signal: AbortSignal) => listTasks(requestId, signal), [requestId]);
  return useResource(load, config.apiEnabled && enabled);
}

/** Readiness checklist of a request (live mode only). */
export function useReadiness(requestId: string, enabled = true) {
  const load = useCallback((signal: AbortSignal) => getReadiness(requestId, signal), [requestId]);
  return useResource(load, config.apiEnabled && enabled);
}

/** Activity log (notes and issues) of a request (live mode only). */
export function useActivityLog(requestId: string, enabled = true) {
  const load = useCallback((signal: AbortSignal) => getActivity(requestId, signal), [requestId]);
  return useResource(load, config.apiEnabled && enabled);
}

/** Post-maintenance validation results (live mode only). */
export function useValidation(requestId: string, enabled = true) {
  const load = useCallback((signal: AbortSignal) => getValidation(requestId, signal), [requestId]);
  return useResource(load, config.apiEnabled && enabled);
}

/** Final report (live mode only). The API answers 404 until the request is completed. */
export function useReport(requestId: string, enabled = true) {
  const load = useCallback((signal: AbortSignal) => getReport(requestId, signal), [requestId]);
  return useResource(load, config.apiEnabled && enabled);
}
