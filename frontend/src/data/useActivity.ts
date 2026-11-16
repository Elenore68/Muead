import { useCallback } from "react";
import { config } from "../config";
import { getApprovalHistory } from "../api/approvals";
import { listMembers } from "../api/members";
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
