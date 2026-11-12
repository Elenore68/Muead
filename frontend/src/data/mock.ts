// Mock data for UI development only. Values mirror the design reference samples.
export type Status = "Pending" | "In Progress" | "Completed" | "Rejected";
export type Priority = "High" | "Medium" | "Low";

export interface RequestItem {
  id: string;
  title: string;
  description: string;
  category: string;
  requestedBy: string;
  assignedTo: string;
  priority: Priority;
  status: Status;
  created: string;
  targetDate: string;
}

export const team = [
  { name: "Sara", av: 0, initials: "S" },
  { name: "Shahad", av: 1, initials: "Sh" },
  { name: "Amal", av: 2, initials: "A" },
];

// Known demo users keep their colour; real users get a stable colour derived from the name.
export const avatarIndex = (name: string) =>
  team.find((t) => t.name === name)?.av ?? [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 3;
export const initialsOf = (name: string) => team.find((t) => t.name === name)?.initials ?? name[0];

export const requests: RequestItem[] = [
  { id: "REQ-0142", title: "Fix Meeting Room Projector", description: "Projector shows no signal.", category: "Equipment", requestedBy: "Sara", assignedTo: "Amal", priority: "High", status: "In Progress", created: "Nov 10, 2026", targetDate: "Nov 15, 2026" },
  { id: "REQ-0141", title: "AC Not Cooling", description: "Office AC not cooling properly.", category: "Facilities", requestedBy: "Shahad", assignedTo: "Sara", priority: "Medium", status: "Pending", created: "Nov 9, 2026", targetDate: "Nov 16, 2026" },
  { id: "REQ-0140", title: "Wi-Fi Connectivity Issue", description: "Intermittent Wi-Fi drops.", category: "IT", requestedBy: "Amal", assignedTo: "Shahad", priority: "High", status: "In Progress", created: "Nov 9, 2026", targetDate: "Nov 14, 2026" },
  { id: "REQ-0139", title: "Replace Broken Office Chair", description: "Chair base is cracked.", category: "Office", requestedBy: "Sara", assignedTo: "Amal", priority: "Low", status: "Completed", created: "Nov 8, 2026", targetDate: "Nov 12, 2026" },
  { id: "REQ-0138", title: "Lighting Repair in Lounge", description: "Two lights flicker.", category: "Facilities", requestedBy: "Shahad", assignedTo: "Sara", priority: "Medium", status: "Pending", created: "Nov 7, 2026", targetDate: "Nov 13, 2026" },
];

export interface Approval {
  id: string;
  title: string;
  description: string;
  requestedBy: string;
  category: string;
  priority: Priority;
  requestedOn: string;
}

export const approvals: Approval[] = [
  { id: "REQ-0048", title: "Office Printer Maintenance", description: "Routine check and parts replacement.", requestedBy: "Sara", category: "Facilities", priority: "High", requestedOn: "Nov 10, 2026 10:24 AM" },
  { id: "REQ-0047", title: "Conference Room AV Check", description: "Inspect and test the meeting room's equipment.", requestedBy: "Shahad", category: "Equipment", priority: "Medium", requestedOn: "Nov 9, 2026 4:15 PM" },
  { id: "REQ-0046", title: "Network Switch Replacement", description: "Replace the faulty switch in Building A.", requestedBy: "Amal", category: "IT", priority: "High", requestedOn: "Nov 9, 2026 11:02 AM" },
  { id: "REQ-0045", title: "Air Conditioning Service", description: "Scheduled service for the 3rd floor.", requestedBy: "Sara", category: "HVAC", priority: "Low", requestedOn: "Nov 8, 2026 3:30 PM" },
];

export const schedule = [
  { title: "System Update", when: "Nov 12, 2026 · 10:00 AM", color: "var(--c-primary)" },
  { title: "Application Upgrade", when: "Nov 15, 2026 · 2:00 PM", color: "var(--c-pink)" },
  { title: "Database Backup", when: "Nov 18, 2026 · 9:00 AM", color: "var(--c-amber)" },
];

export const overTime = [1.2, 2.8, 3.1, 4.1, 3.3, 4.5, 5.2, 5.0, 6.7];
export const overTimeLabels = ["Oct 25", "Oct 27", "Oct 29", "Oct 31", "Nov 2", "Nov 4", "Nov 6", "Nov 8", "Nov 10"];

export const byCategory = [
  { name: "System", n: 4, color: "var(--c-primary)" },
  { name: "Application", n: 3, color: "var(--c-pink)" },
  { name: "Infrastructure", n: 3, color: "var(--c-amber)" },
  { name: "Other", n: 2, color: "#d9bff7" },
];
