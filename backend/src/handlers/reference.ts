import { json, router } from "../lib/http";
import { CLOUD_PLATFORMS, ENVIRONMENTS, MAINTENANCE_TYPES } from "../lib/lifecycle";

/**
 * GET /reference-data
 * Only values that are actually known are returned:
 *  - categories and priorities come from the UI reference screens,
 *  - teams and checklist groups come from the SOW (2, 4.6).
 * Environments, cloud platforms and maintenance types are the values confirmed by the project owner
 * (PROJECT-HANDOVER.md 14.1); the request API rejects anything else.
 */
export const handler = router({
  "GET /reference-data": async () =>
    json(200, {
      categories: ["Equipment", "Facilities", "IT", "Office", "HVAC"],
      priorities: ["HIGH", "MEDIUM", "LOW"],
      environments: [...ENVIRONMENTS],
      cloudPlatforms: [...CLOUD_PLATFORMS],
      maintenanceTypes: [...MAINTENANCE_TYPES],
      teams: ["Cloud", "Database", "Application", "OS", "SecurityNetwork"],
      checklistGroups: ["BACKUP", "ACCESS", "FIREWALL_CONNECTIVITY", "TEAM_AVAILABILITY", "APP_DEPENDENCIES", "DOCUMENTATION"],
    }),
});
