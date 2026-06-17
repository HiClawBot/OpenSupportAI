export const seedPlaceholder = {
  status: "pending_pr_002",
  message: "Database seed data is introduced in PR-002."
} as const;

console.log(seedPlaceholder.message);
