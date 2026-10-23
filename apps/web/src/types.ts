export type PublicState = {
  assembly?: { id?: string; name?: string; status?: string; completedAt?: string | null; lobbyStatus?: string }
  assemblyCompletedAt?: string | null
  status?: string
  lobbyStatus?: string
  /** `voted` comes only to the mesa, for the latest opened ballot: whether the person voted, never for whom. */
  participants?: Array<{ id?: string; firstName: string; lastName: string; voted?: boolean }>
  attendanceRound?: { roundId: string; status: string; votedCount: number } | null
  participantCount?: number
  recordedCount?: number
  eligibleCount?: number
  participationStatus?: 'pending' | 'recorded'
  currentRound?: { id: string; title: string; status: string; format?: string; category?: 'office' | 'committee'; memberCount?: number | null; electionSeats?: number | null; options?: Array<{ id: string; label: string }>; participationCount?: number; annulReason?: string | null }
  results?: Array<{ label: string; count: number }>
  officialResult?: { elected: Array<{ optionId: string; label: string }>; note: string | null; declaredAt: string }
  joinUrl?: string
  publicAppUrl?: string
  rounds?: Array<{
    id: string; title: string; status: string; format?: string; category?: 'office' | 'committee'; memberCount?: number | null; committeeRootRoundId?: string | null; electionSeats?: number | null; annulledAt?: string | null; annulReason?: string | null; participationCount?: number; options: Array<{ id: string; label: string }>
    results?: Array<{ optionId: string; label: string; count: number }>
    /** Counts of a closed, unpublished ballot; only the moderator state carries them. */
    privateResults?: Array<{ optionId: string; label: string; count: number }>
    officialResult?: { elected: Array<{ optionId: string; label: string }>; note: string | null; declaredBy: string; declaredAt: string; publishedAt: string | null } | null
    secrecyCleanupPending?: boolean
  }>
}

/** A ballot as the moderator state lists it, with its counts and declaration. */
export type RoundRecord = NonNullable<PublicState['rounds']>[number]
