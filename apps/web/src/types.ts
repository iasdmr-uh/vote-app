/** Computed by the API's results engine; ids are the round's ballot options. */
export type Outcome = { seats: number; base: number; threshold: number; elected: string[]; runoff: string[]; openSeats: number }

export type PublicState = {
  assembly?: { id?: string; name?: string; status?: string; completedAt?: string | null; lobbyStatus?: string }
  assemblyCompletedAt?: string | null
  status?: string
  lobbyStatus?: string
  participants?: Array<{ id?: string; firstName: string; lastName: string; voted?: boolean; votingDisabled?: boolean }>
  attendanceRound?: { roundId: string; status: string; votedCount: number; eligibleCount?: number } | null
  leftParticipants?: Array<{ id: string; firstName: string; lastName: string }>
  participantCount?: number
  recordedCount?: number
  eligibleCount?: number
  participationStatus?: 'pending' | 'recorded'
  votingDisabled?: boolean
  currentRound?: { id: string; title: string; status: string; format?: string; category?: 'office' | 'committee'; memberCount?: number | null; electionSeats?: number | null; voteNumber?: number; runoff?: boolean; options?: Array<{ id: string; label: string }>; participationCount?: number; recordedCount?: number; eligibleCount?: number; annulReason?: string | null }
  results?: Array<{ optionId?: string; label: string; count: number }>
  outcome?: Outcome
  officialResult?: { elected: Array<{ optionId: string; label: string }>; note: string | null; declaredAt: string }
  joinUrl?: string
  publicAppUrl?: string
  rounds?: Array<{
    id: string; title: string; status: string; format?: string; category?: 'office' | 'committee'; memberCount?: number | null; committeeRootRoundId?: string | null; electionSeats?: number | null; voteNumber?: number; runoff?: boolean; runoffSourceRoundId?: string | null; annulledAt?: string | null; annulReason?: string | null; participationCount?: number; recordedCount?: number; eligibleCount?: number; options: Array<{ id: string; label: string }>
    results?: Array<{ optionId: string; label: string; count: number }>
    privateResults?: Array<{ optionId: string; label: string; count: number }>
    outcome?: Outcome
    officialResult?: { elected: Array<{ optionId: string; label: string }>; note: string | null; declaredBy: string; declaredAt: string; publishedAt: string | null } | null
    secrecyCleanupPending?: boolean
  }>
}

export type RoundRecord = NonNullable<PublicState['rounds']>[number]
