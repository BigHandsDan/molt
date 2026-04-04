// MoltPermit Default Policy Pack
// Trust-tier based access control for AI agents

// Allow all agents to perform read actions
permit(
  principal is Agent,
  action == MoltPermit::Action::"read",
  resource
);

// Allow verified agents (moltcaptcha+) to perform write actions
permit(
  principal is Agent,
  action == MoltPermit::Action::"write",
  resource
)
when {
  principal.verificationTier == "moltcaptcha" ||
  principal.verificationTier == "blockchain" ||
  principal.verificationTier == "reputation"
};

// Allow blockchain-verified and reputation-backed agents to execute actions
permit(
  principal is Agent,
  action == MoltPermit::Action::"execute",
  resource
)
when {
  principal.verificationTier == "blockchain" ||
  principal.verificationTier == "reputation"
};

// Only reputation-backed agents with high scores can perform admin actions
permit(
  principal is Agent,
  action == MoltPermit::Action::"admin",
  resource
)
when {
  principal.verificationTier == "reputation" &&
  principal.reputationScore >= 4
};

// Deny unverified agents from write operations
forbid(
  principal is Agent,
  action == MoltPermit::Action::"write",
  resource
)
when {
  principal.verificationTier == "unverified"
};

// Deny delete on high-sensitivity resources unless reputation-backed
forbid(
  principal is Agent,
  action == MoltPermit::Action::"delete",
  resource
)
when {
  resource.sensitivity == "high" &&
  principal.verificationTier != "reputation"
};
