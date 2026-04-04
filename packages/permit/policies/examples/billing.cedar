// Billing agent policies
// Agents with billing role can read invoices and process refunds

// Allow verified billing agents to read invoices
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

// Allow blockchain-verified agents to process refunds (write)
permit(
  principal is Agent,
  action == MoltPermit::Action::"write",
  resource
)
when {
  principal.verificationTier == "blockchain" ||
  principal.verificationTier == "reputation"
};

// Deny any agent from deleting billing records
forbid(
  principal is Agent,
  action == MoltPermit::Action::"delete",
  resource
);
