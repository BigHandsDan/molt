// Support agent policies
// Support agents can read tickets and write responses

// Allow all verified agents to read support tickets
permit(
  principal is Agent,
  action == MoltPermit::Action::"read",
  resource
)
when {
  principal.verificationTier == "moltcaptcha" ||
  principal.verificationTier == "blockchain" ||
  principal.verificationTier == "reputation"
};

// Allow verified agents to write (respond to) tickets
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

// Deny unverified agents entirely
forbid(
  principal is Agent,
  action == MoltPermit::Action::"read",
  resource
)
when {
  principal.verificationTier == "unverified"
};
