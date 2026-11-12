import { json, router } from "../lib/http";

/**
 * GET /reference-data
 * Only values that are actually known are returned:
 *  - categories and priorities come from the UI reference screens,
 *  - teams and checklist groups come from the SOW (2, 4.6).
 * Environments, cloud platforms and maintenance types are NOT defined anywhere yet (open question 8),
 * so they are empty and the field accepts free text until the lists are approved.
 */
export const handler = router({
  "GET /reference-data": async () =>
    json(200, {
      categories: ["Equipment", "Facilities", "IT", "Office", "HVAC"],
      priorities: ["HIGH", "MEDIUM", "LOW"],
      environments: [],
      cloudPlatforms: [],
      maintenanceTypes: [],
      teams: ["Cloud", "Database", "Application", "OS", "SecurityNetwork"],
      checklistGroups: ["BACKUP", "ACCESS", "FIREWALL_CONNECTIVITY", "TEAM_AVAILABILITY", "APP_DEPENDENCIES", "DOCUMENTATION"],
    }),
});
