// Read-only agent policies
// Only permit read actions, deny everything else

// Allow all agents to read
permit(
  principal is Agent,
  action == MoltPermit::Action::"read",
  resource
);

// Explicitly deny write, execute, delete, and admin for all agents
forbid(
  principal is Agent,
  action == MoltPermit::Action::"write",
  resource
);

forbid(
  principal is Agent,
  action == MoltPermit::Action::"execute",
  resource
);

forbid(
  principal is Agent,
  action == MoltPermit::Action::"delete",
  resource
);

forbid(
  principal is Agent,
  action == MoltPermit::Action::"admin",
  resource
);
