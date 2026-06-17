export const migrationPlaceholder = {
  status: "pending_pr_002",
  message: "Database migrations are introduced in PR-002."
} as const;

console.log(migrationPlaceholder.message);
