export type RoundCategory = 'office' | 'committee' | 'decision'
/** Decision only: A favor / En contra, or options written by the mesa. */
export type DecisionFormat = 'boolean' | 'options'
/** 'simple': more than half of the habilitados; 'three_quarters': at least 3/4. */
export type ApprovalRule = 'simple' | 'three_quarters'

/** Computed by the API's results engine; ids are the round's ballot options. Decisions add `rule` and `approved`. */
export type Outcome = { seats: number; base: number; threshold: number; elected: string[]; runoff: string[]; openSeats: number; rule?: ApprovalRule; approved?: boolean }

export type PositionGroup = 'board' | 'department'
/** A box of the org chart. `elected`: the mesa sees closed or published results; phones and projector only published. */
export type Position = { id: string; group: PositionGroup; label: string; sortOrder: number; custom: boolean; elected: { label: string; roundId: string } | null }

/** «Presentar oficiales» on the projector: 0 cover, 1 Junta directiva, 2 Departamentos. */
export type PresentationSlide = 0 | 1 | 2
export type Presentation = { active: boolean; slide: PresentationSlide }

export type PublicState = {
  /** Public and projector state. */
  assemblyName?: string
  period?: string | null
  positions?: Position[]
  assembly?: { id?: string; name?: string; status?: string; completedAt?: string | null; lobbyStatus?: string }
  presentation?: Presentation
  assemblyCompletedAt?: string | null
  status?: string
  lobbyStatus?: string
  participants?: Array<{ id?: string; firstName: string; lastName: string; voted?: boolean; votingDisabled?: boolean }>
  /** Mesa only. Votes secretly in the rounds marked `regionalSecretaryVotes` and stays out of `participants`. */
  regionalSecretary?: { id: string; firstName: string; lastName: string; voted?: boolean } | null
  attendanceRound?: { roundId: string; status: string; votedCount: number; eligibleCount?: number } | null
  leftParticipants?: Array<{ id: string; firstName: string; lastName: string }>
  participantCount?: number
  recordedCount?: number
  eligibleCount?: number
  participationStatus?: 'pending' | 'recorded'
  votingDisabled?: boolean
  currentRound?: { id: string; title: string; status: string; positionId?: string | null; format?: string; category?: RoundCategory; decisionFormat?: DecisionFormat | null; approvalRule?: ApprovalRule | null; memberCount?: number | null; electionSeats?: number | null; voteNumber?: number; runoff?: boolean; regionalSecretaryVotes?: boolean; options?: Array<{ id: string; label: string }>; participationCount?: number; recordedCount?: number; eligibleCount?: number; annulReason?: string | null }
  results?: Array<{ optionId?: string; label: string; count: number }>
  outcome?: Outcome
  officialResult?: { elected: Array<{ optionId: string; label: string }>; note: string | null; declaredAt: string }
  joinUrl?: string
  publicAppUrl?: string
  rounds?: Array<{
    id: string; title: string; status: string; positionId?: string | null; format?: string; category?: RoundCategory; decisionFormat?: DecisionFormat | null; approvalRule?: ApprovalRule | null; memberCount?: number | null; committeeRootRoundId?: string | null; electionSeats?: number | null; regionalSecretaryVotes?: boolean; voteNumber?: number; runoff?: boolean; runoffSourceRoundId?: string | null; annulledAt?: string | null; annulReason?: string | null; participationCount?: number; recordedCount?: number; eligibleCount?: number; options: Array<{ id: string; label: string; isNew?: boolean }>
    results?: Array<{ optionId: string; label: string; count: number }>
    privateResults?: Array<{ optionId: string; label: string; count: number }>
    outcome?: Outcome
    officialResult?: { elected: Array<{ optionId: string; label: string }>; note: string | null; declaredBy: string; declaredAt: string; publishedAt: string | null } | null
    secrecyCleanupPending?: boolean
  }>
}

export type RoundRecord = NonNullable<PublicState['rounds']>[number]
