export type PublicState = {
  assembly?: { id?: string; name?: string; status?: string; completedAt?: string | null; lobbyStatus?: string }
  assemblyCompletedAt?: string | null
  status?: string
  lobbyStatus?: string
  participants?: Array<{ id?: string; firstName: string; lastName: string; voted?: boolean }>
  attendanceRound?: { roundId: string; status: string; votedCount: number; eligibleCount?: number } | null
  leftParticipants?: Array<{ id: string; firstName: string; lastName: string }>
  participantCount?: number
  recordedCount?: number
  eligibleCount?: number
  participationStatus?: 'pending' | 'recorded'
  currentRound?: { id: string; title: string; status: string; format?: string; category?: 'office' | 'committee'; memberCount?: number | null; electionSeats?: number | null; options?: Array<{ id: string; label: string }>; participationCount?: number; recordedCount?: number; eligibleCount?: number; annulReason?: string | null }
  results?: Array<{ label: string; count: number }>
  officialResult?: { elected: Array<{ optionId: string; label: string }>; note: string | null; declaredAt: string }
  joinUrl?: string
  publicAppUrl?: string
  rounds?: Array<{
    id: string; title: string; status: string; format?: string; category?: 'office' | 'committee'; memberCount?: number | null; committeeRootRoundId?: string | null; electionSeats?: number | null; annulledAt?: string | null; annulReason?: string | null; participationCount?: number; recordedCount?: number; eligibleCount?: number; options: Array<{ id: string; label: string }>
    results?: Array<{ optionId: string; label: string; count: number }>
    privateResults?: Array<{ optionId: string; label: string; count: number }>
    officialResult?: { elected: Array<{ optionId: string; label: string }>; note: string | null; declaredBy: string; declaredAt: string; publishedAt: string | null } | null
    secrecyCleanupPending?: boolean
  }>
}

export type RoundRecord = NonNullable<PublicState['rounds']>[number]
