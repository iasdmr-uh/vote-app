## Decisions

- **Check inside the transaction.** `issueResumeCode` and `redeemResumeCode` lock the assembly row and count open rounds, as `RoomService` does for take-out. `openRound` takes the same lock, so a code cannot be issued or redeemed while a vote opens.
- **Refusal leaves the code.** A refused redemption keeps `resumeCodeHash` and `resumeExpiresAt`, so the code works after the vote. The expiry still applies.
- **409 Conflict** with a Spanish message, matching the other refusals during a vote.
- **Session token untouched.** Token authentication does not check for an open vote, so a phone that recovers its network keeps its session.
- **Entry QR included.** The secretary's entry QR is stored like a reconnection code, so the redeem check covers it. Adding the secretary needs a draft vote in an election that waits for its result, and base refuses to open any other vote in that state, so the add itself cannot run during an open vote.
